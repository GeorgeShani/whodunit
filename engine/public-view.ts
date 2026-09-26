/**
 * Client-safe projection of a case. Strips the solution (incl. the true motive
 * and key evidence), the timeline, facts, every character's private inner
 * world (knowledge, beliefs, secrets + reveal conditions, intended lies,
 * relationships, personality scores), evidence engine links, and any evidence
 * the player has not discovered, and the endings (endings.json). Pure (no fs), so client components may import
 * its TYPES.
 */
import type { CaseBackdrops, LoadedCase, MotiveOption, Victim } from "./case-schema";
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

export type PublicEvidence = Pick<Evidence, "id" | "name" | "description" | "kind" | "locationId" | "image" | "discoveryLine">;

export interface PublicCaseMeta {
  id: string;
  title: string;
  tagline: string;
  intro: string;
}

export interface PublicCaseView {
  meta: PublicCaseMeta;
  /** Motive OPTIONS for the accusation screen (authored as public choices; never flags the true one). */
  motives: MotiveOption[];
  victim: Victim;
  /** Public per-screen backdrop art (asset paths), resolved with fallbacks by the page. */
  backdrops: CaseBackdrops;
  locations: Location[];
  suspects: PublicSuspect[];
  evidence: PublicEvidence[];
}

export function initialDiscoveredEvidenceIds(c: LoadedCase): string[] {
  return c.evidence.filter((e) => e.initiallyAvailable).map((e) => e.id);
}

export function toPublicEvidence(e: Evidence): PublicEvidence {
  const { id, name, description, kind, locationId, image, discoveryLine } = e;
  return { id, name, description, kind, locationId, image, ...(discoveryLine ? { discoveryLine } : {}) };
}

export function getPublicCaseView(
  c: LoadedCase,
  options: { discoveredEvidenceIds?: readonly string[]; portraitPoses?: Record<string, string[]> } = {},
): PublicCaseView {
  const discovered = new Set(options.discoveredEvidenceIds ?? initialDiscoveredEvidenceIds(c));
  return {
    meta: { id: c.id, title: c.title, tagline: c.tagline, intro: c.intro },
    motives: c.motives.map(({ id, label, description }) => ({ id, label, ...(description ? { description } : {}) })),
    victim: { ...c.victim },
    backdrops: { ...(c.backdrops ?? {}) },
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
