import type { PublicEvidence } from "@/engine/public-view";

/**
 * E3: the clues the accuse form offers as the weapon. A case that marks weapon candidates (`evidence.weapon`, the
 * real weapon plus any decoys) gets only those; a case that marks none falls back to every clue found.
 */
export function weaponChoices(found: readonly PublicEvidence[], weaponsMarked: boolean): PublicEvidence[] {
  return weaponsMarked ? found.filter((e) => e.weapon) : [...found];
}
