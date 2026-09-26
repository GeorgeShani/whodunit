/**
 * Engine side of one interrogation exchange. Pure and deterministic.
 *
 * 1. planTurn(): BEFORE the model is called, apply the engine effects of the
 *    player's move (presented evidence raises stress by fixed rules), work out
 *    which intended lies are now exposed, and decide (via secrets.ts) whether a
 *    secret is revealed this turn. The model is then TOLD what it may perform.
 * 2. commitTurn(): AFTER the performance, commit the planned reveal (only if
 *    the model actually performed it), apply the model's suggested
 *    stress/trust deltas CLAMPED to +/-MAX_MODEL_DELTA, and record memory and
 *    the statement. The model can never reveal a secret, touch evidence, or
 *    move stress/trust by more than the clamp.
 */
import type { LoadedCase } from "./case-schema";
import { secretsToReveal } from "./secrets";
import type { CharacterRuntimeState, EmotionalState, Emotion, GameState } from "./types";

/** Fixed stress rules for presenting evidence (first time a clue is shown to this character). */
export const STRESS_RULES = {
  /** Per intended lie the clue breaks. */
  lieBroken: 15,
  /** Clue is named in one of the character's secret reveal conditions. */
  secretEvidence: 10,
  /** Clue is linked to the character (relatedCharacters). */
  relatedEvidence: 5,
  /** Showing the same clue again. */
  repeatEvidence: 2,
  /** Cap on engine stress gained from one presentation. */
  maxPerPresentation: 30,
} as const;

/** Largest stress/trust change a single model reply may suggest (applied after clamping). */
export const MAX_MODEL_DELTA = 10;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Clamp a model-suggested delta to an integer in [-MAX_MODEL_DELTA, MAX_MODEL_DELTA]; junk -> 0. */
export function clampDelta(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.round(clamp(n, -MAX_MODEL_DELTA, MAX_MODEL_DELTA));
}

export interface TurnPlan {
  characterId: string;
  presentedEvidenceId?: string;
  /** Stress added by the engine rules this turn. */
  engineStressDelta: number;
  /** Secret the engine allows (and asks) the character to confess this turn. */
  revealSecretId: string | null;
  /** Intended lies that shown evidence has exposed (the character can no longer maintain them). */
  exposedLieIds: string[];
  /** Lies exposed for the first time by this turn's evidence. */
  newlyExposedLieIds: string[];
}

function exposedLies(caseData: LoadedCase, characterId: string, shown: readonly string[]): string[] {
  const ch = caseData.characters.find((c) => c.id === characterId);
  return (ch?.intendedLies ?? [])
    .filter((l) => l.brokenByEvidenceIds.some((id) => shown.includes(id)))
    .map((l) => l.id);
}

/**
 * Apply the engine effects of the player's move to `game` (mutates the
 * character's evidenceShownIds and stress) and decide the reveal.
 * Caller must already have checked that the character exists and the evidence
 * was discovered.
 */
export function planTurn(
  caseData: LoadedCase,
  game: GameState,
  characterId: string,
  presentedEvidenceId?: string,
): TurnPlan {
  const ch = caseData.characters.find((c) => c.id === characterId);
  const rt = game.characters[characterId];
  if (!ch || !rt) throw new Error(`planTurn: unknown character "${characterId}"`);

  const before = exposedLies(caseData, characterId, rt.evidenceShownIds);
  let engineStressDelta = 0;

  if (presentedEvidenceId) {
    if (rt.evidenceShownIds.includes(presentedEvidenceId)) {
      engineStressDelta = STRESS_RULES.repeatEvidence;
    } else {
      rt.evidenceShownIds.push(presentedEvidenceId);
      const ev = caseData.evidence.find((e) => e.id === presentedEvidenceId);
      const breaks = ch.intendedLies.filter((l) => l.brokenByEvidenceIds.includes(presentedEvidenceId)).length;
      const pressures = ch.secrets.some((s) => s.revealConditions?.evidenceIds.includes(presentedEvidenceId));
      const related = ev?.relatedCharacters.includes(characterId) ?? false;
      engineStressDelta =
        breaks * STRESS_RULES.lieBroken +
        (pressures ? STRESS_RULES.secretEvidence : 0) +
        (related && !breaks && !pressures ? STRESS_RULES.relatedEvidence : 0);
      engineStressDelta = Math.min(engineStressDelta, STRESS_RULES.maxPerPresentation);
    }
    rt.stress = clamp(rt.stress + engineStressDelta, 0, 100);
  }

  const exposedLieIds = exposedLies(caseData, characterId, rt.evidenceShownIds);
  // At most ONE new reveal per exchange (authored order, prerequisites respected): no cascades, no loops.
  const revealSecretId = secretsToReveal(ch.secrets, rt)[0] ?? null;

  return {
    characterId,
    ...(presentedEvidenceId ? { presentedEvidenceId } : {}),
    engineStressDelta,
    revealSecretId,
    exposedLieIds,
    newlyExposedLieIds: exposedLieIds.filter((id) => !before.includes(id)),
  };
}

export interface PerformanceOutcome {
  playerText: string;
  dialogue: string;
  emotion: Emotion;
  intensity: number;
  stressDelta: unknown;
  trustDelta: unknown;
  /** Did a validated model reply perform this turn (vs the in-character fallback)? */
  performed: boolean;
}

const MEMORY_CAP = 12;
const STATEMENT_CAP = 8;

/** Commit the exchange. Mutates `game`. Returns the clamped deltas that were applied. */
export function commitTurn(game: GameState, plan: TurnPlan, out: PerformanceOutcome) {
  const rt = game.characters[plan.characterId] as CharacterRuntimeState;
  game.turn += 1;
  rt.interrogationCount += 1;

  // The engine decided the reveal; it is committed once it has actually been performed.
  // (On a fallback turn it stays pending and the engine offers it again next turn.)
  const revealed = plan.revealSecretId !== null && out.performed;
  if (revealed && !rt.revealedSecretIds.includes(plan.revealSecretId as string)) {
    rt.revealedSecretIds.push(plan.revealSecretId as string);
  }

  const stressDelta = out.performed ? clampDelta(out.stressDelta) : 0;
  const trustDelta = out.performed ? clampDelta(out.trustDelta) : 0;
  rt.stress = clamp(rt.stress + stressDelta, 0, 100);
  rt.trust = clamp(rt.trust + trustDelta, 0, 100);

  const emotion: EmotionalState = {
    emotion: out.emotion,
    intensity: clamp(out.intensity, 0, 1),
    composure: clamp(1 - rt.stress / 100, 0, 1),
  };
  rt.emotion = emotion;

  rt.memory.push(
    {
      turn: game.turn,
      speaker: "player",
      text: out.playerText,
      ...(plan.presentedEvidenceId ? { evidenceId: plan.presentedEvidenceId } : {}),
    },
    { turn: game.turn, speaker: "character", text: out.dialogue },
  );
  rt.memory = rt.memory.slice(-MEMORY_CAP);

  if (out.performed) {
    const id = `st-${plan.characterId}-${game.turn}`;
    game.statements.push({
      id,
      characterId: plan.characterId,
      text: out.dialogue,
      turn: game.turn,
      mode: "interrogation",
      relatedFactIds: [],
      contradictedByEvidenceIds: [],
    });
    const mine = game.statements.filter((s) => s.characterId === plan.characterId);
    if (mine.length > STATEMENT_CAP) {
      const drop = new Set(mine.slice(0, mine.length - STATEMENT_CAP).map((s) => s.id));
      game.statements = game.statements.filter((s) => !drop.has(s.id));
    }
  }
  return { stressDelta, trustDelta, revealed };
}
