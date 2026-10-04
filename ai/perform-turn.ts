/**
 * SERVER-ONLY. One character's turn, engine first: plan (engine effects +
 * reveal decision) -> scoped context -> prompt with engine directives -> Grok
 * (canon/era/breakdown post-checks, one retry) or the in-character fallback ->
 * engine commit. Shared by /api/interrogate and /api/confront so both follow
 * exactly the same rules. Mutates `game`.
 */
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext, type CharacterContext } from "@/engine/context-builder";
import { commitTurn, planTurn, type PresentMove, type TurnPlan } from "@/engine/interrogation";
import { isOutburst, stressBand, type StressReading } from "@/engine/stress";
import { publicTestimonies } from "@/engine/testimony";
import type { GameState } from "@/engine/types";
import { cannedCharacterResponse } from "./canned-responses";
import { fixArticles } from "./text-fixes";
import { canonTimes, checkTimes, findModernWord } from "./canon-check";
import { checkOrder } from "./order-check";
import { callGrok, type GrokResult } from "./grok";
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

export async function performTurn(t: TurnInput): Promise<TurnOutput> {
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
  const system = buildSystemPrompt(ctx, directives);
  const user = t.userMessage ? t.userMessage(ctx) : buildUserMessage(ctx, question);
  t.onPrompt?.({ system, user });
  // Canon post-check (#6): every clock time must come from this character's context (or what was just said to them).
  const heard = [question, t.confrontation?.partnerLine ?? ""].join(" ");
  const allowed = canonTimes(ctx, directives, heard);
  const validate = (r: { dialogue: string; action?: string }) => {
    const said = `${r.dialogue} ${r.action ?? ""}`;
    const res = checkTimes(said, allowed);
    if (!res.ok) {
      return `You stated a time you do not know (${res.offending.map((x) => `"${x}"`).join(", ")}). Use only times from WHAT YOU KNOW or your stories, and only the time on the line about THAT person or event, or stay vague ("I couldn't say, sir").`;
    }
    // Order of events (#26): "from after the lights went out till the candles" must fit when this person really moved.
    const order = checkOrder(said, ctx);
    if (!order.ok) {
      return `You described when something happened in a way that contradicts the order of events (${order.offending.map((x) => `"${x}"`).join(", ")}). ${order.hint ?? ""} Use the clock times from WHAT YOU KNOW, or one landmark from THE EVENING IN ORDER exactly as listed.`;
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
  const grok = await callGrok({ system, user, env, validate });

  let response: CharacterResponse;
  let source: "model" | "fallback";
  if (grok.ok) {
    source = "model";
    // The model may only react to the clue shown THIS turn.
    response = { ...grok.response, dialogue: fixArticles(grok.response.dialogue), ...(grok.response.action ? { action: fixArticles(grok.response.action) } : {}), evidenceReactions: grok.response.evidenceReactions.filter((r) => r.evidenceId === presentedEvidenceId).slice(0, 1) };
  } else {
    source = "fallback";
    response = cannedCharacterResponse(ctx, question, presentedEvidenceId, game.turn);
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
