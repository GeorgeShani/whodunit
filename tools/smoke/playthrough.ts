/**
 * Phase 8 (6.3): the offline smoke run. Plays the simulator's plan (engine/progression-validation.ts fastestPlan)
 * through the real route handlers, with fetch replaced by a canned model that never leaves the process (zero live
 * calls: any request to another URL throws), and checks the server-side rules a published case depends on:
 *   - ACCUSE is refused (403 accuse_locked) until the plan has opened the gate;
 *   - every planned reveal commits (the secret is in the signed state after its step);
 *   - the winning accusation wins, and each single wrong field (suspect, weapon, motive) loses;
 *   - a replayed accusation gets the original verdict back; the state token stays under its cap.
 * Used by tests/tooling/smoke-run.test.ts and scripts/validate-case.ts --strict.
 */
import { handleConfront } from "@/ai/confront-handler";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { handleAccuse, type AccusedStore } from "@/engine/accuse-handler";
import { citeCaps } from "@/engine/accusation";
import type { LoadedCase } from "@/engine/case-schema";
import { handleInvestigate } from "@/engine/investigate-handler";
import { fastestPlan, type PlanStep } from "@/engine/progression-validation";
import { restoreSession } from "@/engine/session";
import type { Accusation, GameState } from "@/engine/types";

const ENV = { XAI_API_KEY: "smoke-key-not-real-0123456789", GAME_STATE_SECRET: "smoke-state-secret-0123456789" };
const MODEL_URL = /^https:\/\/api\.x\.ai\//;
const MAX_TOKEN_CHARS = 60_000;

export interface SmokeResult {
  ok: boolean;
  actions: number;
  exact: boolean;
  modelCalls: number;
  tokenChars: number;
  /** Early accusations refused with accuse_locked (exact plans only). */
  lockedChecks: number;
  failures: string[];
}

/** Distinct, harmless lines (a reply that repeats a recent one is rejected by the delivery guard). */
const LINES = [
  "I have told you what I know, and I will not say it twice.",
  "You are very thorough, I suppose that is your trade.",
  "Ask what you like, my answer stays the same.",
  "Very well, since you insist, I shall tell you plainly.",
  "The evening was long and I was tired by the end of it.",
  "I barely noticed the clock until much later on.",
  "Nobody asked my opinion then, and nobody listens now.",
  "If you must write it down, write it down correctly.",
  "My memory of that hour is clearer than you think.",
  "Perhaps you should spend less time on me.",
  "There was a great deal of noise from the other rooms.",
  "I kept to myself for most of the night.",
  "Your questions are sharper than the last fellow's.",
  "I would rather not repeat gossip to a stranger.",
  "Some people in this house talk far too freely.",
  "I did what anyone would do in my position.",
  "Frankly, I expected you sooner.",
  "Go on, then, ask the next one.",
  "Forgive me, my nerves are not what they were.",
  "Honesty has never cost me anything before tonight.",
  "Think what you please, detective, I have nothing to hide there.",
  "That is a fair question and it deserves a fair answer.",
  "The weather turned foul just after supper.",
  "I wish the whole affair had never happened.",
  "Others saw more of that evening than I did.",
  "You have a way of making a person uneasy.",
  "Let me think for a moment before I answer.",
  "I am not in the habit of lying to policemen.",
  "Every word of it is true, whether you like it or not.",
  "Write that down and underline it twice.",
  "I have said more to you than to anyone else.",
  "If that is all, I should like to sit down.",
];

/** A canned in-character reply; `admits` carries the planned reveal so the engine commits it like a model turn. */
function cannedReply(n: number, admits: string[]) {
  return {
    dialogue: LINES[n % LINES.length],
    emotion: "nervous",
    intensity: 0.5,
    action: ["looks away", "folds both hands", "glances at the door", "straightens a cuff", "sighs heavily", "taps the table"][n % 6],
    evidenceReactions: [],
    wantsToLeave: false,
    stressDelta: 2,
    trustDelta: 0,
    admits,
  };
}

/** Swap global fetch for the canned model while `run` executes; restores it afterwards. */
async function withCannedModel<T>(admits: () => string[], run: (calls: () => number) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!MODEL_URL.test(url)) throw new Error(`smoke run: unexpected fetch to ${url}`);
    const content = JSON.stringify(cannedReply(calls++, admits()));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return await run(() => calls);
  } finally {
    globalThis.fetch = real;
  }
}

const memoryAccused = (): AccusedStore => {
  const m = new Map<string, Accusation>();
  return { get: async (id) => m.get(id) ?? null, put: async (id, a) => void m.set(id, a) };
};

/** The winning accusation from what the player holds: the solution's three, then held key clues and revealed key testimony. */
export function winningAccusation(c: LoadedCase, g: GameState): Accusation {
  const s = c.solution;
  const caps = citeCaps(s);
  const held = s.keyEvidenceIds.filter((id) => g.discoveredEvidenceIds.includes(id));
  const revealed = (id: string) => g.revealedSecretIds.includes(id);
  const fromGroups = (s.keyTestimonyGroups ?? []).map((grp) => grp.find(revealed)).filter((x): x is string => !!x);
  const testimony = [...new Set([...fromGroups, ...(s.keyTestimonyIds ?? []).filter(revealed)])];
  return {
    murdererId: s.murdererId,
    ...(s.accompliceId ? { accompliceId: s.accompliceId } : c.accuse?.askHelper ? { accompliceId: null } : {}),
    weaponId: s.weaponId,
    motiveId: s.motiveId,
    keyEvidenceIds: held.slice(0, caps.evidence),
    ...(s.keyTestimonyIds?.length ? { keyTestimonyIds: testimony.slice(0, caps.testimony) } : {}),
  };
}

export async function smokeRun(c: LoadedCase): Promise<SmokeResult> {
  const failures: string[] = [];
  const plan = fastestPlan(c);
  if (!plan) return { ok: false, actions: 0, exact: false, modelCalls: 0, tokenChars: 0, lockedChecks: 0, failures: ["the simulator found no winning plan"] };
  const deps = { caseData: c, env: ENV };
  let token: string | undefined;
  let admits: string[] = [];
  let lockedChecks = 0;
  const game = () => restoreSession(c, token, ENV).game;
  const accuse = (accusation: Accusation, stateToken: string, accused = memoryAccused()) => handleAccuse({ caseId: c.id, accusation, stateToken }, { ...deps, accused, closed: null });

  return withCannedModel(
    () => admits,
    async (modelCalls) => {
      const steps: PlanStep[] = plan.steps;
      for (const [i, step] of steps.entries()) {
        const at = `step ${i + 1} (${step.kind})`;
        admits = "secretId" in step ? [step.secretId] : [];
        let r: { status: number; body: { stateToken?: string; error?: string } };
        if (step.kind === "search") r = handleInvestigate({ caseId: c.id, locationId: step.locationId, ...(token ? { stateToken: token } : {}) }, deps);
        else if (step.kind === "confront")
          r = await handleConfront({ caseId: c.id, characterIds: [step.characterId, step.partnerId], question: "Tell me again, both of you.", ...(token ? { stateToken: token } : {}) }, deps);
        else {
          const show = step.kind === "show" ? { ...(step.evidenceId ? { presentedEvidenceId: step.evidenceId } : {}), ...(step.testimonyId ? { presentedTestimonyId: step.testimonyId } : {}) } : {};
          r = await handleInterrogate({ caseId: c.id, characterId: step.characterId, question: "Where were you that evening?", ...show, ...(token ? { stateToken: token } : {}) }, deps);
        }
        if (r.status !== 200 || !r.body.stateToken) {
          failures.push(`${at}: status ${r.status}${r.body.error ? ` ${r.body.error}` : ""}`);
          break;
        }
        token = r.body.stateToken;
        if ("secretId" in step && !game().revealedSecretIds.includes(step.secretId)) failures.push(`${at}: the reveal of "${step.secretId}" did not commit`);
        // ACCUSE stays shut until the last step (the plan is fastest, or at least a valid greedy route).
        if (plan.exact && i < steps.length - 1 && c.accuseGate) {
          const now = game();
          const early = winningAccusation(c, now);
          // The form needs one cited clue; before any is found ACCUSE cannot be sent at all.
          if (!early.keyEvidenceIds.length && now.discoveredEvidenceIds.length) early.keyEvidenceIds = [now.discoveredEvidenceIds[0]];
          if (!early.keyEvidenceIds.length) continue;
          if (early.keyTestimonyIds && !early.keyTestimonyIds.length) delete early.keyTestimonyIds;
          const r = await accuse(early, token);
          lockedChecks++;
          if (r.status !== 403 || r.body.error !== "accuse_locked") failures.push(`${at}: ACCUSE was not locked before the plan finished (status ${r.status} ${r.body.error ?? ""})`);
        }
      }
      if (failures.length || !token) return { ok: false, actions: plan.actions, exact: plan.exact, modelCalls: modelCalls(), tokenChars: token?.length ?? 0, lockedChecks, failures };
      const finalToken = token;
      const g = game();
      const win = winningAccusation(c, g);
      const store = memoryAccused();
      const won = await accuse(win, finalToken, store);
      if (won.status !== 200 || won.body.outcome !== "won") failures.push(`the winning accusation did not win (status ${won.status}, ${won.body.outcome ?? won.body.error})`);
      const replay = await accuse({ ...win, motiveId: c.motives.find((m) => m.id !== win.motiveId)?.id ?? win.motiveId }, finalToken, store);
      if (replay.body.outcome !== "won") failures.push(`a replayed accusation did not get the original verdict (${replay.body.outcome ?? replay.body.error})`);
      const mutations: [string, Partial<Accusation>][] = [
        ["suspect", { murdererId: c.characters.find((ch) => ch.id !== win.murdererId && ch.id !== win.accompliceId)?.id }],
        ["weapon", { weaponId: g.discoveredEvidenceIds.find((id) => id !== win.weaponId) }],
        ["motive", { motiveId: c.motives.find((m) => m.id !== win.motiveId)?.id }],
      ];
      for (const [field, change] of mutations) {
        if (Object.values(change)[0] === undefined) continue;
        const lost = await accuse({ ...win, ...change }, finalToken);
        if (lost.body.outcome !== "lost") failures.push(`a wrong ${field} did not lose (${lost.body.outcome ?? lost.body.error})`);
      }
      if (finalToken.length > MAX_TOKEN_CHARS) failures.push(`the state token is ${finalToken.length} chars, over ${MAX_TOKEN_CHARS}`);
      return { ok: failures.length === 0, actions: plan.actions, exact: plan.exact, modelCalls: modelCalls(), tokenChars: finalToken.length, lockedChecks, failures };
    },
  );
}
