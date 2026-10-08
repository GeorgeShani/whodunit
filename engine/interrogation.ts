/**
 * Engine side of one interrogation exchange. Pure and deterministic.
 *
 * 1. planTurn(): BEFORE the model is called, apply the engine effects of the
 *    player's move (presented evidence or testimony raises stress by fixed
 *    rules; see engine/testimony.ts for lies broken by testimony), work out
 *    which intended lies are now exposed, and decide (via secrets.ts) whether a
 *    secret is revealed this turn. The model is then TOLD what it may perform.
 * 2. commitTurn(): AFTER the performance, commit the planned reveal (only if
 *    the model actually performed it), apply the model's suggested
 *    stress/trust deltas CLAMPED to +/-MAX_MODEL_DELTA, and record memory and
 *    the statement. The model can never reveal a secret, touch evidence, or
 *    move stress/trust by more than the clamp.
 */
import type { LoadedCase } from "./case-schema";
import { acceptsExplanation, extractClaims, mergeClaims, questionTouchesLie, RELIEF } from "./memory";
import { coreGuiltSecretIds } from "./core-guilt";
import { secretsToReveal } from "./secrets";
import { BREAKDOWN_STRESS, escalateEmotion, POST_BREAKDOWN_STRESS } from "./stress";
import { brokenLieIds, liesTouchedByTestimony, secretIndex } from "./testimony";
import type { CharacterRuntimeState, EmotionalState, Emotion, GameState } from "./types";

/** Fixed stress rules for presenting evidence or testimony (first time it is shown to this character). */
export const STRESS_RULES = {
  /** Per intended lie the clue / testimony newly breaks. */
  lieBroken: 15,
  /** Clue is named in one of the character's secret reveal conditions. */
  secretEvidence: 10,
  /** Clue is linked to the character (relatedCharacters); testimony touches one of their lies without breaking it yet. */
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
  /** Testimony (a revealed secret id) presented this turn. */
  presentedTestimonyId?: string;
  /** Stress added by the engine rules this turn. */
  engineStressDelta: number;
  /** Secret the engine allows (and asks) the character to confess this turn. */
  revealSecretId: string | null;
  /** Intended lies that shown evidence or presented testimony has broken (the character can no longer maintain them). */
  exposedLieIds: string[];
  /** Lies broken for the first time by this turn's evidence or testimony (drives the contradiction beat). */
  newlyExposedLieIds: string[];
  /**
   * The character's own lies retired by the secret confessed THIS turn
   * (supersededBySecretIds). Already included in exposedLieIds, so the model is
   * never told to confess the secret and keep the lie in the same prompt.
   */
  retiredLieIds: string[];
  /** Stress is at breakdown level and this character hasn't broken down yet: the performance is the breakdown. */
  breakdown: boolean;
  /** Lies the prompt tells the character to MAINTAIN whose topic the detective touched: recorded as told if performed. */
  toldLieIds: string[];
  /** The detective's assertions this turn (addressed character only, typed lines only). */
  claims: string[];
  /** Engine stress relief applied this turn (>= 0), and why. */
  relief: number;
  reliefReason?: "suspicion_elsewhere" | "explanation_accepted";
}

/** The player's move this turn: at most one of evidence / testimony. */
export interface PresentMove {
  presentedEvidenceId?: string;
  presentedTestimonyId?: string;
  /** What the detective said this turn (topic matching for liesTold, claims, acceptance). */
  playerText?: string;
  /** false for a confrontation partner who only overheard the line: no claims or acceptance relief for them. */
  addressed?: boolean;
  /** false when another turn of the SAME exchange (the other side of a confrontation) already planned a reveal. */
  allowReveal?: boolean;
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
  move?: string | PresentMove,
): TurnPlan {
  const { presentedEvidenceId, presentedTestimonyId, playerText = "", addressed = true, allowReveal = true }: PresentMove =
    typeof move === "string" ? { presentedEvidenceId: move } : (move ?? {});
  const ch = caseData.characters.find((c) => c.id === characterId);
  const rt = game.characters[characterId];
  if (!ch || !rt) throw new Error(`planTurn: unknown character "${characterId}"`);
  if (presentedEvidenceId && presentedTestimonyId) throw new Error("planTurn: present evidence OR testimony, not both");

  // Core guilt (engine/core-guilt.ts) is never revealed before the accusation; a legacy token that already lists one
  // counts it as unrevealed, so it can neither retire a lie nor be talked about.
  const core = coreGuiltSecretIds(caseData);
  const ownState = () => ({ ...rt, revealedSecretIds: rt.revealedSecretIds.filter((id) => !core.has(id)) });
  const before = brokenLieIds(caseData, ch, ownState());
  let engineStressDelta = 0;
  let relief = 0;
  let reliefReason: TurnPlan["reliefReason"];

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
      // §18 "suspicion moves elsewhere": the clue bears on someone else and on nothing of theirs.
      if (!engineStressDelta && ev && ev.relatedCharacters.some((id) => id !== characterId && caseData.characters.some((c) => c.id === id))) {
        relief = RELIEF.suspicionElsewhere;
        reliefReason = "suspicion_elsewhere";
      }
    }
    rt.stress = clamp(rt.stress + engineStressDelta, 0, 100);
  }

  if (presentedTestimonyId) {
    if (!secretIndex(caseData).has(presentedTestimonyId)) throw new Error(`planTurn: unknown testimony "${presentedTestimonyId}"`);
    if (rt.testimonyShownIds.includes(presentedTestimonyId)) {
      engineStressDelta = STRESS_RULES.repeatEvidence;
    } else {
      rt.testimonyShownIds.push(presentedTestimonyId);
      const nowBroken = brokenLieIds(caseData, ch, ownState()).filter((id) => !before.includes(id)).length;
      const touches = liesTouchedByTestimony(caseData, ch, presentedTestimonyId).length > 0;
      // Same bump as evidence: per lie it breaks; a smaller nudge if it bears on a lie without breaking it yet.
      engineStressDelta = nowBroken * STRESS_RULES.lieBroken + (!nowBroken && touches ? STRESS_RULES.relatedEvidence : 0);
      engineStressDelta = Math.min(engineStressDelta, STRESS_RULES.maxPerPresentation);
    }
    rt.stress = clamp(rt.stress + engineStressDelta, 0, 100);
  }

  // §18 "player accepts their explanation" (typed line to this character, no clue or testimony on the table).
  if (!relief && addressed && !presentedEvidenceId && !presentedTestimonyId && acceptsExplanation(playerText)) {
    relief = RELIEF.explanationAccepted;
    reliefReason = "explanation_accepted";
  }
  relief = Math.min(relief, rt.stress);
  rt.stress = clamp(rt.stress - relief, 0, 100);

  const own = ownState();
  const brokenByMove = brokenLieIds(caseData, ch, own);
  // At most ONE new reveal per exchange (lowest tier first, then authored order; prerequisites respected): no cascades,
  // no loops. A breakdown never unlocks anything by itself: reveals follow the authored conditions only. A lie may be
  // broken with nothing revealed (e.g. a card exposes a story whose truth is core guilt: she stonewalls).
  const revealSecretId = allowReveal ? (secretsToReveal(ch.secrets, own, core)[0] ?? null) : null;
  // Same-turn retirement: lies superseded by the secret being confessed now count as exposed already.
  const retiredLieIds = revealSecretId
    ? ch.intendedLies.filter((l) => l.supersededBySecretIds.includes(revealSecretId) && !brokenByMove.includes(l.id)).map((l) => l.id)
    : [];
  const exposedLieIds = [...brokenByMove, ...retiredLieIds];
  const breakdown = rt.stress >= BREAKDOWN_STRESS && !rt.brokeDown;
  // Told = the prompt orders MAINTAIN (not exposed / retired) and the detective's words touch the topic.
  const toldLieIds = playerText
    ? ch.intendedLies.filter((l) => !exposedLieIds.includes(l.id) && !rt.liesToldIds.includes(l.id) && questionTouchesLie(caseData, ch, l, playerText)).map((l) => l.id)
    : [];
  const claims = addressed && !presentedEvidenceId && !presentedTestimonyId ? extractClaims(playerText) : [];

  return {
    characterId,
    ...(presentedEvidenceId ? { presentedEvidenceId } : {}),
    ...(presentedTestimonyId ? { presentedTestimonyId } : {}),
    engineStressDelta,
    revealSecretId,
    exposedLieIds,
    newlyExposedLieIds: brokenByMove.filter((id) => !before.includes(id)),
    retiredLieIds,
    breakdown,
    toldLieIds,
    claims,
    relief,
    ...(reliefReason ? { reliefReason } : {}),
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
export function commitTurn(game: GameState, plan: TurnPlan, out: PerformanceOutcome, mode: "interrogation" | "confrontation" = "interrogation") {
  const rt = game.characters[plan.characterId] as CharacterRuntimeState;
  game.turn += 1;
  rt.interrogationCount += 1;

  // The engine decided the reveal; it is committed once it has actually been performed.
  // (On a fallback turn it stays pending and the engine offers it again next turn.)
  const revealed = plan.revealSecretId !== null && out.performed;
  if (revealed && !rt.revealedSecretIds.includes(plan.revealSecretId as string)) {
    rt.revealedSecretIds.push(plan.revealSecretId as string);
  }
  // Case-wide testimony set: every revealed secret becomes something the player can present to anyone.
  if (revealed && !game.revealedSecretIds.includes(plan.revealSecretId as string)) {
    game.revealedSecretIds.push(plan.revealSecretId as string);
  }

  // Stories told: only when a validated reply performed the turn the prompt ordered.
  if (out.performed) for (const id of plan.toldLieIds) if (!rt.liesToldIds.includes(id)) rt.liesToldIds.push(id);
  // The detective said it either way (untrusted; see engine/memory.ts).
  if (plan.claims.length) rt.playerClaims = mergeClaims(rt.playerClaims, plan.claims, game.turn);

  const stressDelta = out.performed ? clampDelta(out.stressDelta) : 0;
  const trustDelta = out.performed ? clampDelta(out.trustDelta) : 0;
  rt.stress = clamp(rt.stress + stressDelta, 0, 100);
  rt.trust = clamp(rt.trust + trustDelta, 0, 100);
  // The breakdown happens once it has been performed (a fallback turn leaves it pending), then stress settles.
  const brokeDown = plan.breakdown && out.performed;
  if (brokeDown) {
    rt.brokeDown = true;
    rt.stress = POST_BREAKDOWN_STRESS;
  }
  // A spent breakdown can't happen again, so the gauge tops out at "panicking" (it never reads BREAKDOWN with nothing to come, #29).
  if (rt.brokeDown) rt.stress = Math.min(rt.stress, BREAKDOWN_STRESS - 1);

  const emotion: EmotionalState = {
    // Engine floor: the pose follows the stress gauge, whatever the model picked.
    emotion: escalateEmotion(out.emotion, rt.stress, brokeDown),
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
      ...(plan.presentedTestimonyId ? { testimonyId: plan.presentedTestimonyId } : {}),
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
      mode,
      relatedFactIds: [],
      contradictedByEvidenceIds: [],
    });
    const mine = game.statements.filter((s) => s.characterId === plan.characterId);
    if (mine.length > STATEMENT_CAP) {
      const drop = new Set(mine.slice(0, mine.length - STATEMENT_CAP).map((s) => s.id));
      game.statements = game.statements.filter((s) => !drop.has(s.id));
    }
  }
  return { stressDelta, trustDelta, revealed, brokeDown, emotion: emotion.emotion, stress: rt.stress };
}
