/**
 * Engine-side secret reveal rules. Pure; the model never decides reveals.
 */
import type { CharacterRuntimeState, Secret } from "./types";

type RevealState = Pick<CharacterRuntimeState, "stress" | "evidenceShownIds" | "revealedSecretIds">;

/**
 * Should `secret` be revealed given the character's runtime state?
 * - Already revealed -> true.
 * - No revealConditions -> false (never auto-revealed).
 * - Every afterSecretIds prerequisite must already be revealed.
 * - Conditions: stress >= stressThreshold (if set) and each evidenceId shown.
 *   mode "any": at least one condition holds; "all": every condition holds.
 */
export function shouldRevealSecret(secret: Secret, state: RevealState): boolean {
  if (state.revealedSecretIds.includes(secret.id)) return true;
  const rc = secret.revealConditions;
  if (!rc) return false;
  if (!rc.afterSecretIds.every((id) => state.revealedSecretIds.includes(id))) return false;

  const results: boolean[] = [];
  if (rc.stressThreshold !== undefined) results.push(state.stress >= rc.stressThreshold);
  for (const id of rc.evidenceIds) results.push(state.evidenceShownIds.includes(id));
  if (results.length === 0) return false;
  return rc.mode === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** Ids of secrets that should be revealed now but are not yet (in authored order). */
export function secretsToReveal(secrets: readonly Secret[], state: RevealState): string[] {
  return secrets
    .filter((s) => !state.revealedSecretIds.includes(s.id) && shouldRevealSecret(s, state))
    .map((s) => s.id);
}
