/**
 * SERVER-ONLY. One character's turn, engine first: plan (engine effects +
 * reveal decision) -> scoped context -> prompt with engine directives -> Grok
 * (canon/era/breakdown post-checks, one retry) or the in-character fallback ->
 * engine commit. Shared by /api/interrogate and /api/confront so both follow
 * exactly the same rules. Mutates `game`.
 */
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext, type CharacterContext } from "@/engine/context-builder";
import { guiltProfile } from "@/engine/core-guilt";
import { commitTurn, planTurn, type PresentMove, type TurnPlan } from "@/engine/interrogation";
import { isOutburst, stressBand, type StressReading } from "@/engine/stress";
import { publicTestimonies } from "@/engine/testimony";
import type { GameState } from "@/engine/types";
import { cannedCharacterResponse } from "./canned-responses";
import { fixArticles } from "./text-fixes";
import { canonTimes, checkTimes, findModernWord } from "./canon-check";
import { checkOrder } from "./order-check";
import { findGuiltLeak, guiltDeflection, guiltRetryNote } from "./guilt-check";
import { addressesWrongPerson, repeatsEarlier, variedConfrontationFallback } from "./confront-check";
import { callGrok, isModelDown, isQuotaFailure, type GrokFailure, type GrokResult } from "./grok";
import type { ModelDownKind } from "./model-down";
import type { Contradiction } from "./interrogate-schema";
import { buildSystemPrompt, buildUserMessage, type ConfrontDirective, type TurnDirectives } from "./prompts/interrogation";
import type { CharacterResponse } from "./schemas";

type Env = Record<string, string | undefined>;

export interface TurnInput {
  caseData: LoadedCase;
  game: GameState;
  characterId: string;
  /** What the detective said (for the prompt and the canon check). */
  question: string;
  move?: PresentMove;
  /** Confrontation staging (who else is in the room, what they just said). */
  confrontation?: ConfrontDirective;
  /** Text recorded in the character's memory for the player's side (defaults to `question`). */
  memoryText?: string;
  /** Custom user message (confrontation); defaults to buildUserMessage(ctx, question). */
  userMessage?: (ctx: CharacterContext) => string;
  env?: Env;
  onPrompt?: (p: { system: string; user: string }) => void;
  /** Do not call the model; treat it as this failure (the cost gate's daily cap or kill switch). */
  skipModel?: GrokFailure;
}

export interface TurnOutput {
  response: CharacterResponse;
  source: "model" | "fallback";
  grok: GrokResult;
  plan: TurnPlan;
  revealed: boolean;
  stress: StressReading;
  contradiction?: Contradiction;
}

/** The model could not answer. Nothing was committed: the caller must return the state it was given. */
export interface TurnUnavailable {
  unavailable: true;
  kind: ModelDownKind;
  reason: GrokFailure;
  grok: GrokResult;
}

export const isTurnUnavailable = (o: TurnOutput | TurnUnavailable): o is TurnUnavailable => "unavailable" in o;

export async function performTurn(t: TurnInput): Promise<TurnOutput | TurnUnavailable> {
  const { caseData, game, characterId, question, move = {}, env } = t;
  const { presentedEvidenceId, presentedTestimonyId } = move;
  const plan = planTurn(caseData, game, characterId, { ...move, playerText: question, addressed: t.confrontation?.role !== "reacting" });
  const ch = caseData.characters.find((c) => c.id === characterId)!;
  const ev = presentedEvidenceId ? caseData.evidence.find((e) => e.id === presentedEvidenceId) : undefined;
  const secret = plan.revealSecretId ? ch.secrets.find((s) => s.id === plan.revealSecretId) : undefined;
  const testimony = presentedTestimonyId ? publicTestimonies(caseData, game).find((x) => x.id === presentedTestimonyId) : undefined;
  const directives: TurnDirectives = {
    exposedLieIds: plan.exposedLieIds,
    ...(plan.retiredLieIds.length ? { retiredLieIds: plan.retiredLieIds } : {}),
    ...(plan.breakdown ? { breakdown: true } : {}),
    ...(secret ? { revealSecret: { id: secret.id, description: secret.description } } : {}),
    ...(ev ? { presentedEvidence: { id: ev.id, name: ev.name, description: ev.description } } : {}),
    ...(testimony ? { presentedTestimony: { id: testimony.id, characterName: testimony.characterName, summary: testimony.summary } } : {}),
    ...(t.confrontation ? { confrontation: t.confrontation } : {}),
  };

  const ctx = buildCharacterContext({ caseData, game }, characterId);
  // Guilt-leak check (ai/guilt-check.ts): nobody confesses the murder before the accusation. A token from before this
  // rule may still hold such a line in the conversation; it is not replayed to the model.
  const guilt = guiltProfile(caseData);
  const scrub = <T extends { text: string }>(m: T): T => (findGuiltLeak(m.text, guilt, characterId) ? { ...m, text: "(I have nothing more to say about that.)" } : m);
  ctx.memory = ctx.memory.map((m) => (m.speaker === "character" ? scrub(m) : m));
  ctx.statements = ctx.statements.map(scrub);
  const system = buildSystemPrompt(ctx, directives);
  const user = t.userMessage ? t.userMessage(ctx) : buildUserMessage(ctx, question, t.confrontation ? { partnerName: t.confrontation.partnerName } : {});
  if (!t.skipModel) t.onPrompt?.({ system, user });
  // Canon post-check (#6): every clock time must come from this character's context (or what was just said to them).
  const heard = [question, t.confrontation?.partnerLine ?? ""].join(" ");
  const allowed = canonTimes(ctx, directives, heard);
  let guiltRejected = false;
  const validate = (r: { dialogue: string; action?: string; admitsKilling?: boolean }) => {
    const said = `${r.dialogue} ${r.action ?? ""}`;
    // Core guilt first (Agatha's rule): a line admitting the killing is never accepted, whatever else it gets right.
    const leak = findGuiltLeak(r.dialogue, guilt, characterId) ?? (r.admitsKilling === true ? { kind: "killing" as const, text: r.dialogue } : null);
    guiltRejected = leak !== null;
    if (leak) return guiltRetryNote(leak, caseData.victim.name);
    const res = checkTimes(said, allowed);
    if (!res.ok) {
      return `You stated a time you do not know (${res.offending.map((x) => `"${x}"`).join(", ")}). Use only times from WHAT YOU KNOW or your stories, and only the time on the line about THAT person or event, or stay vague ("I couldn't say, sir"). Do not work out a clock time yourself: if it is not listed, say it relative to a listed event ("a couple of minutes after the candles").`;
    }
    // Order of events (#26): "from after the lights went out till the candles" must fit when this person really moved.
    const order = checkOrder(said, ctx);
    if (!order.ok) {
      return `You described when something happened in a way that contradicts the order of events (${order.offending.map((x) => `"${x}"`).join(", ")}). ${order.hint ?? ""} Use the clock times from WHAT YOU KNOW, or one landmark from THE EVENING IN ORDER exactly as listed.`;
    }
    // Confrontation hygiene (#27): no repeated sentences, and nobody but the partner is addressed.
    if (t.confrontation) {
      const again = repeatsEarlier(r.dialogue, ctx);
      if (again) return `You already said almost exactly this earlier in the conversation: "${again}". Do NOT repeat it or reword it lightly. Answer ${t.confrontation.partnerName}'s last point first, then say something NEW (a different fact, angle or reaction).`;
      const wrong = addressesWrongPerson(r.dialogue, ctx, t.confrontation.partnerName);
      if (wrong) return `You addressed "${wrong}" but you are face to face with ${t.confrontation.partnerName}. Speak only to ${t.confrontation.partnerName} (and the detective).`;
    }
    // Breakdown turns must actually read as an outburst (performance only; the engine already decided it).
    if (directives.breakdown && !isOutburst(r.dialogue)) {
      return "This turn is your BREAKDOWN: burst out loud (at least one word in CAPITALS and an exclamation mark), panicked, furious or sobbing. Still admit nothing new.";
    }
    const modern = findModernWord(said, heard);
    return modern
      ? `You used the modern word "${modern}". A 1920s character would never say or repeat it; react with period bafflement ("A what, sir?") without the word.`
      : null;
  };
  // skipModel: the cost gate (ai/model-gate.ts) has the model switched off; behave exactly as if the call had failed.
  const grok: GrokResult = t.skipModel
    ? { ok: false, reason: t.skipModel, model: "none", attempts: 0, latencyMs: 0, skipped: true }
    : await callGrok({ system, user, env, validate });

  let response: CharacterResponse;
  let source: "model" | "fallback";
  if (grok.ok) {
    source = "model";
    // The model may only react to the clue shown THIS turn.
    const { admitsKilling: _flag, ...reply } = grok.response;
    void _flag;
    response = { ...reply, dialogue: fixArticles(grok.response.dialogue), ...(grok.response.action ? { action: fixArticles(grok.response.action) } : {}), evidenceReactions: grok.response.evidenceReactions.filter((r) => r.evidenceId === presentedEvidenceId).slice(0, 1) };
  } else if (isModelDown(grok.reason) && !(plan.newlyExposedLieIds.length > 0 && (presentedEvidenceId || presentedTestimonyId))) {
    // Model out of reach: no improvised line, nothing committed (stress, trust, turn count, reveals all stay as they were).
    console.warn(`[turn] unavailable reason=${grok.reason}${grok.status ? ` status=${grok.status}` : ""}${grok.skipped ? " (breaker)" : ""} model=${grok.model} attempts=${grok.attempts} ms=${grok.latencyMs}`);
    return { unavailable: true, kind: isQuotaFailure(grok.reason) ? "quiet" : "busy", reason: grok.reason, grok };
  } else {
    // Either the model answered but broke the canon rules twice (the engine's own wording stands in), or the player held up
    // a clue/testimony that the ENGINE has just proved a lie: that contradiction beat does not need the model, so it is shown.
    source = "fallback";
    response = cannedCharacterResponse(ctx, question, presentedEvidenceId, game.turn);
    if (!grok.ok && grok.reason === "canon_check_failed" && guiltRejected) {
      // The model leaked the murder twice: a stonewall in character, no third call.
      const d = guiltDeflection(ctx.state.stress, game.turn);
      response = { ...response, dialogue: d.dialogue, action: d.action, emotion: d.emotion, intensity: 0.6 };
      console.warn(`[turn] guilt leak rejected twice character=${characterId}`);
    } else if (t.confrontation && !presentedEvidenceId) {
      // Face to face the generic one-on-one lines read oddly and repeat: pick a varied line aimed at the partner (#27).
      const v = variedConfrontationFallback(ctx, t.confrontation.partnerName, game.turn);
      response = { ...response, dialogue: v.dialogue, action: v.action, emotion: "defensive", intensity: 0.5 };
    }
    console.warn(`[turn] fallback reason=${grok.reason}${grok.status ? ` status=${grok.status}` : ""} model=${grok.model} attempts=${grok.attempts} ms=${grok.latencyMs}`);
  }

  const applied = commitTurn(
    game,
    plan,
    {
      playerText: t.memoryText ?? question,
      dialogue: response.dialogue,
      emotion: response.emotion,
      intensity: response.intensity,
      stressDelta: response.stressDelta,
      trustDelta: response.trustDelta,
      performed: source === "model",
    },
    t.confrontation ? "confrontation" : "interrogation",
  );
  // Report what the engine applied, never the raw suggestion, and the emotion after the stress floor.
  response = { ...response, emotion: applied.emotion, stressDelta: applied.stressDelta, trustDelta: applied.trustDelta };
  const stress: StressReading = { value: applied.stress, band: stressBand(applied.stress), breakdown: applied.brokeDown };
  // Deterministic verdict from the engine's plan (independent of the model's performance).
  const contradiction: Contradiction | undefined =
    plan.newlyExposedLieIds.length > 0 && (presentedEvidenceId || presentedTestimonyId)
      ? {
          characterId,
          characterName: ch.name,
          item: presentedEvidenceId ? { kind: "evidence", id: presentedEvidenceId } : { kind: "testimony", id: presentedTestimonyId! },
          lieCount: plan.newlyExposedLieIds.length,
        }
      : undefined;
  return { response, source, grok, plan, revealed: applied.revealed, stress, ...(contradiction ? { contradiction } : {}) };
}
