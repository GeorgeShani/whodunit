import type { LoadedCase } from "@/engine/case-schema";
import type { Accusation } from "@/engine/types";

/**
 * The official winning accusation, read from the loaded (gitignored or env) solution.
 * Pass `over` to cite a subset of key evidence, add a red herring, or change one field.
 */
export function winningAccusation(c: LoadedCase, over: Partial<Accusation> = {}): Accusation {
  return {
    murdererId: c.solution.murdererId,
    weaponId: c.solution.weaponId,
    motiveId: c.solution.motiveId,
    keyEvidenceIds: [...c.solution.keyEvidenceIds],
    ...over,
  };
}
