/**
 * Engine-side secret reveal rules. Pure; the model never decides reveals.
 */
import type { CharacterRuntimeState, Secret } from "./types";

type RevealState = Pick<CharacterRuntimeState, "stress" | "evidenceShownIds" | "revealedSecretIds"> & Partial<Pick<CharacterRuntimeState, "testimonyShownIds">>;

/** Reveal tier: the least damaging secret comes out first when several are eligible on the same exchange. */
export const SEVERITY_TIER: Record<Secret["severity"], number> = { embarrassing: 0, serious: 1, damning: 2 };

/**
 * Should `secret` be revealed given the character's runtime state?
 * - Core guilt (`coreGuilt: true`) -> false, always: never revealed before the accusation (engine/core-guilt.ts).
 * - Already revealed -> true.
 * - No revealConditions -> false (never auto-revealed).
 * - Every afterSecretIds prerequisite must already be revealed.
 * - Conditions: stress >= stressThreshold (if set), each evidenceId shown, each
 *   testimonyId presented to this character as testimony.
 *   mode "any": at least one condition holds; "all": every condition holds.
 */
export function shouldRevealSecret(secret: Secret, state: RevealState): boolean {
  if (secret.coreGuilt === true) return false;
  if (state.revealedSecretIds.includes(secret.id)) return true;
  const rc = secret.revealConditions;
  if (!rc) return false;
  if (!rc.afterSecretIds.every((id) => state.revealedSecretIds.includes(id))) return false;

  const heard = state.testimonyShownIds ?? [];
  const results: boolean[] = [];
  if (rc.stressThreshold !== undefined) results.push(state.stress >= rc.stressThreshold);
  for (const id of rc.evidenceIds) results.push(state.evidenceShownIds.includes(id));
  for (const id of rc.testimonyIds ?? []) results.push(heard.includes(id));
  if (results.length === 0) return false;
  return rc.mode === "all" ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Ids of secrets that should be revealed now but are not yet, lowest tier first (then authored order).
 * `exclude`: secrets that may never be revealed here (core guilt derived from the solution, see engine/core-guilt.ts).
 * The engine reveals only the FIRST of these per exchange.
 */
export function secretsToReveal(secrets: readonly Secret[], state: RevealState, exclude: ReadonlySet<string> = new Set()): string[] {
  return secrets
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !exclude.has(s.id) && !state.revealedSecretIds.includes(s.id) && shouldRevealSecret(s, state))
    .sort((a, b) => SEVERITY_TIER[a.s.severity] - SEVERITY_TIER[b.s.severity] || a.i - b.i)
    .map(({ s }) => s.id);
}
