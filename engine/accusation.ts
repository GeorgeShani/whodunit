/**
 * SERVER-ONLY (takes the CaseSolution). Grades a player's accusation.
 *
 * Rule (George): a WIN needs the correct murderer, weapon AND motive, AND
 * at least `minKeyEvidence` (default 1) cited ids from solution.keyEvidenceIds, AND
 * at least `minKeyTestimony` (default 0) cited ids from solution.keyTestimonyIds.
 * Extra non-key evidence is fine. Time and place are not graded, but are returned
 * for the ending recap. Pure; the LLM never judges accusations.
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
  /** For the ending recap only; not graded. */
  recap: { murdererId: string; weaponId: string; motiveId: string; locationId: string; time: string };
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
  return {
    won: murdererCorrect && weaponCorrect && motiveCorrect && hasKeyEvidence && hasKeyTestimony,
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
