/**
 * SERVER-ONLY (takes the CaseSolution). Grades a player's accusation.
 *
 * Rule (George): a WIN needs the correct murderer, weapon AND motive, AND
 * at least `minKeyEvidence` (default 1) cited ids from solution.keyEvidenceIds, AND
 * at least `minKeyTestimony` (default 0) cited ids from solution.keyTestimonyIds.
 * Extra non-key evidence never changes won/lost. Time and place are not graded, but are returned
 * for the ending recap. Pure; the LLM never judges accusations.
 *
 * E2 rating (WINS ONLY): "sloppy" when any cited clue is outside keyEvidenceIds + supportingEvidenceIds, or any cited
 * testimony is outside keyTestimonyIds + supportingTestimonyIds; otherwise "clean". No loss ever carries a rating,
 * "right person, wrong story" included: a rating there would tell the player they had the culprit (E4's no-tell rule).
 */
import type { CaseSolution } from "./solution";
import type { Accusation } from "./types";

export interface AccusationGrade {
  won: boolean;
  murdererCorrect: boolean;
  weaponCorrect: boolean;
  motiveCorrect: boolean;
  /** Cited ids that are key evidence (deduplicated, in citation order). */
  keyEvidenceCited: string[];
  /** Cited ids that are not key evidence (allowed; not penalised). */
  otherEvidenceCited: string[];
  hasKeyEvidence: boolean;
  /** Cited testimony (secret ids) that is key testimony (deduplicated, in citation order). */
  keyTestimonyCited: string[];
  hasKeyTestimony: boolean;
  /** E2: present only on a win. */
  rating?: Rating;
  /** E2: cited clue / testimony ids that support nothing (what made the rating sloppy). */
  unsupportedCited: string[];
  /** For the ending recap only; not graded. */
  recap: { murdererId: string; weaponId: string; motiveId: string; locationId: string; time: string };
}

export type Rating = "clean" | "sloppy";

/** E2: "Cite up to N" for clues and for testimony separately: the minimum the win needs, plus one. */
export function citeCaps(solution: Pick<CaseSolution, "minKeyEvidence" | "minKeyTestimony">): { evidence: number; testimony: number } {
  return { evidence: (solution.minKeyEvidence ?? 1) + 1, testimony: (solution.minKeyTestimony ?? 0) + 1 };
}

/** E2: the cited ids that support nothing (not key, not supporting). */
export function unsupportedCitations(solution: CaseSolution, accusation: Pick<Accusation, "keyEvidenceIds" | "keyTestimonyIds">): string[] {
  const ev = new Set([...solution.keyEvidenceIds, ...(solution.supportingEvidenceIds ?? [])]);
  const te = new Set([...(solution.keyTestimonyIds ?? []), ...(solution.supportingTestimonyIds ?? [])]);
  return [...[...new Set(accusation.keyEvidenceIds)].filter((id) => !ev.has(id)), ...[...new Set(accusation.keyTestimonyIds ?? [])].filter((id) => !te.has(id))];
}

export function gradeAccusation(solution: CaseSolution, accusation: Accusation): AccusationGrade {
  const cited = [...new Set(accusation.keyEvidenceIds)];
  const key = new Set(solution.keyEvidenceIds);
  const keyEvidenceCited = cited.filter((id) => key.has(id));
  const murdererCorrect = accusation.murdererId === solution.murdererId;
  const weaponCorrect = accusation.weaponId === solution.weaponId;
  const motiveCorrect = accusation.motiveId === solution.motiveId;
  const hasKeyEvidence = keyEvidenceCited.length >= (solution.minKeyEvidence ?? 1);
  const keyTestimony = new Set(solution.keyTestimonyIds ?? []);
  const keyTestimonyCited = [...new Set(accusation.keyTestimonyIds ?? [])].filter((id) => keyTestimony.has(id));
  const hasKeyTestimony = keyTestimonyCited.length >= (solution.minKeyTestimony ?? 0);
  const unsupportedCited = unsupportedCitations(solution, accusation);
  const won = murdererCorrect && weaponCorrect && motiveCorrect && hasKeyEvidence && hasKeyTestimony;
  return {
    won,
    ...(won ? { rating: unsupportedCited.length ? ("sloppy" as const) : ("clean" as const) } : {}),
    unsupportedCited,
    murdererCorrect,
    weaponCorrect,
    motiveCorrect,
    keyEvidenceCited,
    otherEvidenceCited: cited.filter((id) => !key.has(id)),
    hasKeyEvidence,
    keyTestimonyCited,
    hasKeyTestimony,
    recap: {
      murdererId: solution.murdererId,
      weaponId: solution.weaponId,
      motiveId: solution.motiveId,
      locationId: solution.locationId,
      time: solution.time,
    },
  };
}
