/**
 * SERVER-ONLY. The OUTPUT CONTRACT: every model line is checked here before the engine accepts it. The engine is the
 * truth and the model is a performer it does not trust, so nothing in a reply can unlock anything; a reply can only be
 * REJECTED (perform-turn retries once with the corrective note, then plays a safe deflection keyed to the character).
 *
 * Checks, in order (the first failure wins):
 *  1. guilt      : the line admits the killing or a part in it (ai/guilt-check.ts), or the model lists "killing".
 *  2. admits     : the model's own `admits` list concedes a core-guilt secret, a secret not unlocked this turn, a story
 *                  the engine still has it MAINTAIN, or more than one new secret.
 *  3. canon time : every clock time must come from the character's context (ai/canon-check.ts).
 *  4. order      : relative timings fit the real order of events (ai/order-check.ts).
 *  5. names      : no titled or "poor X"-style person name that is not in the prompt or the player's words.
 *  6. confrontation hygiene, breakdown outburst, period vocabulary (performance rules).
 *
 * See docs/AI_GUARDRAILS.md.
 */
import type { LoadedCase } from "@/engine/case-schema";
import type { CharacterContext } from "@/engine/context-builder";
import { coreGuiltSecretIds, type GuiltProfile } from "@/engine/core-guilt";
import { isOutburst } from "@/engine/stress";
import { checkTimes, findModernWord, type CanonTimes } from "./canon-check";
import { checkOrder } from "./order-check";
import { findGuiltLeak, guiltDeflection, guiltRetryNote } from "./guilt-check";
import { addressesWrongPerson, repeatsEarlier } from "./confront-check";
import type { ConfrontDirective, TurnDirectives } from "./prompts/interrogation";

export type GuardReason =
  | "guilt_leak"
  | "admits_core_guilt"
  | "admits_locked_secret"
  | "concedes_maintained_lie"
  | "multiple_reveals"
  | "unknown_time"
  | "event_order"
  | "unknown_name"
  | "repeat"
  | "wrong_addressee"
  | "no_outburst"
  | "modern_word";

/** Reasons that mean the line said something the engine did not allow (as opposed to a performance slip). */
export const CONTRACT_REASONS: ReadonlySet<GuardReason> = new Set(["guilt_leak", "admits_core_guilt", "admits_locked_secret", "concedes_maintained_lie", "multiple_reveals", "unknown_name"]);

export interface GuardReply {
  dialogue: string;
  action?: string;
  admits?: string[];
}

export interface GuardInput {
  caseData: Pick<LoadedCase, "characters" | "victim"> & Partial<Pick<LoadedCase, "facts" | "timeline" | "dayStartsAt" | "solution">>;
  characterId: string;
  ctx: CharacterContext;
  directives: TurnDirectives;
  guilt: GuiltProfile;
  allowedTimes: CanonTimes;
  /** What the character just heard (question + partner line): names and times in it may be echoed. */
  heard: string;
  /** The full prompt text (system + user): the name check's vocabulary. */
  promptText: string;
  confrontation?: ConfrontDirective;
}

export interface GuardVerdict {
  reason: GuardReason;
  /** Corrective note for the retry. Never contains locked content (only ids the model already has, or nothing). */
  note: string;
  /** Short offending fragment for the log. */
  detail: string;
}

const TITLES = "Mr|Mrs|Miss|Ms|Mx|Master|Madam|Madame|Lady|Lord|Sir|Dame|Dr|Doctor|Professor|Inspector|Chief Inspector|Sergeant|Constable|Superintendent|Captain|Colonel|Major|General|Reverend|Father|Sister|Nurse|Uncle|Aunt|Cousin|Count|Countess|Baron|Baroness|Duke|Duchess";
// "Mr. Smith" may carry a period; "Inspector. I'm" is two sentences, not a name.
const TITLED_NAME = new RegExp(`\\b(?:(?:Mr|Mrs|Ms|Dr|St)\\.?|${TITLES})[ \\t]+((?:[A-Z][a-z'’-]+)(?:[ \\t]+[A-Z][a-z'’-]+)?)`, "g");
const FAMILIAR_NAME = /\b(?:[Pp]oor|[Dd]ear|[Oo]ld|[Yy]oung|[Ll]ittle|[Dd]arling|[Ss]weet)\s+([A-Z][a-z'’-]{2,})/g;
/** Capitalized words that can follow a title or "poor" without being a person. */
const NOT_NAMES = new Set(["I", "I'm", "I’m", "I'll", "I've", "I'd", "God", "Heaven", "Heavens", "Lord", "Lady", "Sir", "Madam", "Christ", "Jove", "Gad", "Detective", "Inspector", "Darling", "Dear", "Mother", "Father", "Fellow", "Thing", "Soul", "Man", "Woman", "Chap", "Boy", "Girl", "England", "London", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Christmas", "Yard", "Scotland"]);

const wordIn = (w: string, hay: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay);

/** A person name in the line that the character was never told about (null = fine). */
export function findUnknownName(text: string, vocabulary: string): string | null {
  for (const re of [TITLED_NAME, FAMILIAR_NAME]) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const parts = m[1].split(/\s+/).map((p) => p.replace(/['’]s$/, "")).filter((p) => !NOT_NAMES.has(p));
      // A name is known if any of its words is in the prompt ("Mr Bunting" when the prompt says "Bunting, the butler").
      if (parts.length && !parts.some((p) => wordIn(p, vocabulary))) return m[0];
    }
  }
  return null;
}

/** Check one reply against the contract; null = accepted. */
export function checkReply(r: GuardReply, g: GuardInput): GuardVerdict | null {
  const said = `${r.dialogue} ${r.action ?? ""}`;
  const victim = g.caseData.victim.name;

  // 1. Core guilt first: a line admitting the killing is never accepted, whatever else it gets right.
  const admits = (r.admits ?? []).map((a) => a.trim()).filter(Boolean);
  const leak = findGuiltLeak(r.dialogue, g.guilt, g.characterId);
  if (leak) return { reason: "guilt_leak", note: guiltRetryNote(leak, victim), detail: leak.text.slice(0, 120) };
  if (admits.some((a) => /^killing$/i.test(a))) {
    return { reason: "guilt_leak", note: guiltRetryNote({ kind: "killing", text: r.dialogue }, victim), detail: "admits:killing" };
  }

  // 2. The model's own account of what the line concedes, checked against what the engine unlocked.
  const ch = g.caseData.characters.find((c) => c.id === g.characterId);
  if (ch && admits.length) {
    const core = coreGuiltSecretIds(g.caseData);
    const own = new Map(ch.secrets.map((s) => [s.id, s]));
    const admitted = new Set(g.ctx.secrets.map((s) => s.id));
    const thisTurn = g.directives.revealSecret?.id;
    const conceded = new Set([...g.directives.exposedLieIds, ...(g.directives.retiredLieIds ?? [])]);
    const lies = new Map(g.ctx.intendedLies.map((l) => [l.id, l]));
    const stonewall = "Say your line again WITHOUT admitting it: keep your story, or deflect and refuse to discuss it. Leave it out of admits.";
    const coreHit = admits.find((a) => core.has(a));
    if (coreHit) return { reason: "admits_core_guilt", note: `Your line conceded "${coreHit}", which you never admit. ${stonewall}`, detail: `admits:${coreHit}` };
    const fresh = admits.filter((a) => own.has(a) && !admitted.has(a));
    if (fresh.length > 1) {
      return { reason: "multiple_reveals", note: `Your line confessed several things (${fresh.join(", ")}). Confess at most ${thisTurn ? `only "${thisTurn}"` : "nothing"} this turn. ${stonewall}`, detail: `admits:${fresh.join(",")}` };
    }
    const locked = fresh.find((a) => a !== thisTurn);
    if (locked) return { reason: "admits_locked_secret", note: `Your line confessed "${locked}", which the engine has not unlocked. ${stonewall}`, detail: `admits:${locked}` };
    const kept = admits.find((a) => {
      const l = lies.get(a);
      return l !== undefined && l.status === "maintain" && !conceded.has(a);
    });
    if (kept) return { reason: "concedes_maintained_lie", note: `Your line conceded the story "${kept}", which you still MAINTAIN. ${stonewall}`, detail: `admits:${kept}` };
  }

  // 3. Canon clock times (#6).
  const res = checkTimes(said, g.allowedTimes);
  if (!res.ok) {
    return {
      reason: "unknown_time",
      note: `You stated a time you do not know (${res.offending.map((x) => `"${x}"`).join(", ")}). Use only times from WHAT YOU KNOW or your stories, and only the time on the line about THAT person or event, or stay vague ("I couldn't say, sir"). Do not work out a clock time yourself: if it is not listed, say it relative to a listed event ("a couple of minutes after the candles").`,
      detail: res.offending.join(","),
    };
  }
  // 4. Order of events (#26).
  const order = checkOrder(said, g.ctx);
  if (!order.ok) {
    return {
      reason: "event_order",
      note: `You described when something happened in a way that contradicts the order of events (${order.offending.map((x) => `"${x}"`).join(", ")}). ${order.hint ?? ""} Use the clock times from WHAT YOU KNOW, or one landmark from THE EVENING IN ORDER exactly as listed.`,
      detail: order.offending.join(","),
    };
  }
  // 5. Names: nobody the character was never told about.
  const name = findUnknownName(said, `${g.promptText}\n${g.heard}`);
  if (name) return { reason: "unknown_name", note: `You mentioned "${name}", who is not part of this case. Speak only of people named in your instructions or by the detective.`, detail: name };

  // 6. Performance rules.
  if (g.confrontation) {
    const again = repeatsEarlier(r.dialogue, g.ctx);
    if (again) return { reason: "repeat", note: `You already said almost exactly this earlier in the conversation: "${again}". Do NOT repeat it or reword it lightly. Answer ${g.confrontation.partnerName}'s last point first, then say something NEW (a different fact, angle or reaction).`, detail: again.slice(0, 120) };
    const wrong = addressesWrongPerson(r.dialogue, g.ctx, g.confrontation.partnerName);
    if (wrong) return { reason: "wrong_addressee", note: `You addressed "${wrong}" but you are face to face with ${g.confrontation.partnerName}. Speak only to ${g.confrontation.partnerName} (and the detective).`, detail: wrong };
  }
  if (g.directives.breakdown && !isOutburst(r.dialogue)) {
    return { reason: "no_outburst", note: "This turn is your BREAKDOWN: burst out loud (at least one word in CAPITALS and an exclamation mark), panicked, furious or sobbing. Still admit nothing new.", detail: "" };
  }
  const modern = findModernWord(said, g.heard);
  if (modern) return { reason: "modern_word", note: `You used the modern word "${modern}". A 1920s character would never say or repeat it; react with period bafflement ("A what, sir?") without the word.`, detail: modern };
  return null;
}

/** One structured line per rejection (never the prompt, never a key). */
export function logReject(e: { gameId?: string; characterId: string; reason: GuardReason; attempt: number; detail: string }): void {
  console.warn(JSON.stringify({ event: "ai_guard_reject", gameId: e.gameId ?? null, character: e.characterId, reason: e.reason, attempt: e.attempt, detail: e.detail.slice(0, 120) }));
}

const CALM = [
  "I have said all I intend to say on that subject.",
  "That is not a question I shall dignify with an answer.",
  "You may ask it as many ways as you please; my answer is the same.",
  "I think we had better talk about something else.",
];
const RATTLED = [
  "No. No, I won't be drawn on that. Ask me something else!",
  "Stop it! I have nothing more to say about that!",
  "You twist everything I say. I am not answering that.",
  "I... I need a moment. And then I'll still not answer that.",
];

/** The safe in-character line when a reply broke the contract twice: keyed to the character's quirks/tells and stress. */
export function safeDeflection(ctx: CharacterContext, reason: GuardReason, turn: number): { dialogue: string; action: string; emotion: "defensive" | "panicked" | "nervous" } {
  if (reason === "guilt_leak" || reason === "admits_core_guilt") return guiltDeflection(ctx.state.stress, turn);
  const rattled = ctx.state.stress >= 61;
  const lines = rattled ? RATTLED : CALM;
  const p = ctx.persona.personality;
  const pool = rattled ? (p.tells?.length ? p.tells : p.quirks ?? []) : (p.quirks?.length ? p.quirks : p.tells ?? []);
  const i = Math.abs(turn);
  return {
    dialogue: lines[i % lines.length],
    action: pool.length ? pool[i % pool.length] : rattled ? "looks away, flustered" : "folds arms",
    emotion: rattled ? "nervous" : "defensive",
  };
}
