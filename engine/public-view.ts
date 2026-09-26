/**
 * Client-safe projection of a case. Strips the solution, the timeline, facts,
 * every character's private inner world, and any evidence the player has not
 * discovered. Pure (no fs), so client components may import its TYPES.
 */
import type { CaseMeta, LoadedCase, Victim } from "./case-schema";
import type { EmotionalState, Evidence, Location } from "./types";

export interface PublicSuspect {
  id: string;
  name: string;
  role: string;
  bio: string;
  /** Asset folder under assets/characters/ (defaults to the character id). */
  portrait: string;
  /** Pose files available for this portrait (e.g. ["neutral","angry"]); empty -> silhouette. */
  poses: string[];
  emotion: EmotionalState;
}

export type PublicEvidence = Pick<Evidence, "id" | "name" | "description" | "kind" | "locationId" | "image">;

export interface PublicCaseView {
  meta: CaseMeta;
  victim: Victim;
  locations: Location[];
  suspects: PublicSuspect[];
  evidence: PublicEvidence[];
}

export function initialDiscoveredEvidenceIds(c: LoadedCase): string[] {
  return c.evidence.filter((e) => e.initiallyAvailable).map((e) => e.id);
}

export function toPublicEvidence(e: Evidence): PublicEvidence {
  const { id, name, description, kind, locationId, image } = e;
  return { id, name, description, kind, locationId, image };
}

export function getPublicCaseView(
  c: LoadedCase,
  options: { discoveredEvidenceIds?: readonly string[]; portraitPoses?: Record<string, string[]> } = {},
): PublicCaseView {
  const discovered = new Set(options.discoveredEvidenceIds ?? initialDiscoveredEvidenceIds(c));
  return {
    meta: { ...c.meta },
    victim: { ...c.victim },
    locations: c.locations.map((l) => ({ ...l })),
    suspects: c.characters.map((ch) => {
      const portrait = ch.portrait ?? ch.id;
      return {
        id: ch.id,
        name: ch.name,
        role: ch.role,
        bio: ch.bio,
        portrait,
        poses: [...(options.portraitPoses?.[portrait] ?? [])],
        emotion: { ...ch.initialEmotion },
      };
    }),
    evidence: c.evidence.filter((e) => discovered.has(e.id)).map(toPublicEvidence),
  };
}
