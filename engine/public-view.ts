/**
 * Client-safe projection of a case. Strips the solution (incl. the true motive
 * and key evidence), the timeline, facts, every character's private inner
 * world (knowledge, beliefs, secrets + reveal conditions, intended lies,
 * relationships, personality scores), evidence engine links, and any evidence
 * the player has not discovered, and the endings (endings.json). Pure (no fs), so client components may import
 * its TYPES.
 */
import { clueFeatures, publicFeatures } from "./features/registry";
import { publicSetting, type CaseAudio, type PublicSetting, type Theme } from "./presentation";
import type { CaseBackdrops, LoadedCase, MotiveOption, Victim } from "./case-schema";
import { createInitialGameState } from "./game-state";
import { publicProgress, type PublicProgress } from "./progress";
import type { EmotionalState, Evidence, Location, PublicLocation } from "./types";

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

export type PublicEvidence = Pick<Evidence, "id" | "name" | "description" | "kind" | "locationId" | "image" | "icon" | "discoveryLine" | "weapon"> & {
  /** Phase 6: this clue's public feature extras, by module name (engine/features registry `publicClue`). */
  features?: Record<string, unknown>;
};

export interface PublicCaseMeta {
  id: string;
  title: string;
  tagline: string;
  intro: string;
  /** Case-specific How to Play tips (case.json howToPlayTips); absent when the case has none. */
  howToPlayTips?: string[];
}

/** Interrogation stage art (docs/ART_BIBLE.md §7), resolved server-side by lib/case-art.ts. */
export interface StageArt {
  background: string;
  /** `<room>_lightning.webp`, swapped in during a flash. */
  lightning?: string;
  /** `<room>_window_mask.webp` (alpha = window glass) for the rain layer. */
  windowMask?: string;
  /** Seamless rain texture, shown through the window mask. */
  rainTile?: string;
}

export interface PublicCaseView {
  meta: PublicCaseMeta;
  /** Motive OPTIONS for the accusation screen (authored as public choices; never flags the true one). */
  motives: MotiveOption[];
  victim: Victim;
  /** Public per-screen backdrop art (asset paths), resolved with fallbacks by the page. */
  backdrops: CaseBackdrops;
  /** Interrogation stage art; absent until resolveCaseArt runs (screens fall back to a gradient). */
  stage?: StageArt;
  /** Rooms without the private `requires` (only `lockedLine` is public). */
  locations: PublicLocation[];
  suspects: PublicSuspect[];
  evidence: PublicEvidence[];
  /** E3: the case marks weapon candidates (`evidence.weapon`), so the weapon picker lists only those. */
  weaponsMarked: boolean;
  /** Phase 5 (3.2): the case asks "Did anyone help?" (case.json `accuse.askHelper`; public, never the solution). */
  askHelper?: true;
  /** Starting progress (leads, locked rooms, accuse checklist). Routes return the live one with every token. */
  progress: PublicProgress;
  /** Phase 3: the site's wording for screens (only when the case writes `setting`). */
  setting?: PublicSetting;
  /** Phase 3 (Q7): palette overrides, logo and title art (only when the case writes `theme`). */
  theme?: Theme;
  /** Phase 3 (E9): beds and cue overrides (only when the case writes `audio`). */
  audio?: CaseAudio;
  /** Phase 6: each declared feature module's public slice (`publicConfig`), by module name. */
  features?: Record<string, unknown>;
}

export function initialDiscoveredEvidenceIds(c: LoadedCase): string[] {
  return c.evidence.filter((e) => e.initiallyAvailable).map((e) => e.id);
}

export function toPublicLocation(l: Location): PublicLocation {
  const rest: Partial<Location> = { ...l };
  delete rest.requires;
  return rest as PublicLocation;
}

export function toPublicEvidence(e: Evidence, features?: Record<string, unknown>): PublicEvidence {
  const { id, name, description, kind, locationId, image, icon, discoveryLine, weapon } = e;
  return { id, name, description, kind, locationId, image, ...(icon ? { icon } : {}), ...(discoveryLine ? { discoveryLine } : {}), ...(weapon ? { weapon: true } : {}), ...(features ? { features } : {}) };
}

export function getPublicCaseView(
  c: LoadedCase,
  options: { discoveredEvidenceIds?: readonly string[]; portraitPoses?: Record<string, string[]> } = {},
): PublicCaseView {
  const discovered = new Set(options.discoveredEvidenceIds ?? initialDiscoveredEvidenceIds(c));
  const features = publicFeatures(c);
  return {
    meta: { id: c.id, title: c.title, tagline: c.tagline, intro: c.intro, ...(c.howToPlayTips?.length ? { howToPlayTips: [...c.howToPlayTips] } : {}) },
    motives: c.motives.map(({ id, label, description }) => ({ id, label, ...(description ? { description } : {}) })),
    victim: { ...c.victim },
    backdrops: { ...(c.backdrops ?? {}) },
    locations: c.locations.map(toPublicLocation),
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
    evidence: c.evidence.filter((e) => discovered.has(e.id)).map((e) => toPublicEvidence(e, clueFeatures(c, e.id))),
    weaponsMarked: c.evidence.some((e) => e.weapon),
    ...(c.accuse?.askHelper ? { askHelper: true as const } : {}),
    progress: publicProgress(c, createInitialGameState(c)),
    ...(c.setting ? { setting: publicSetting(c.setting) } : {}),
    ...(c.theme ? { theme: structuredClone(c.theme) } : {}),
    ...(c.audio ? { audio: structuredClone(c.audio) } : {}),
    ...(features ? { features } : {}),
  };
}
