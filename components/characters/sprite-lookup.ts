/**
 * Per-case character sprites (pure; the file list and anchors are read on the server by lib/case-sprites.server.ts at
 * build/start time, like the clue art). For a character's portrait key (`portrait`, else its id):
 *
 *  Sprites, first that exists:
 *   1. assets/cases/<caseId>/characters/<key>/<pose>.webp   (the pose the emotion asks for, see resolvePose)
 *   2. that case's assets/cases/<caseId>/characters/<key>/neutral.webp   (resolvePose falls back to neutral)
 *   3. the global assets/characters/<key>/... lookup, unchanged (its poses come from assets/characters/anchors.json)
 *  A case folder with at least one pose replaces the global sprites for that character; poses are never mixed.
 *
 *  Anchors (bust framing, effect overlays, contact shadow), per character:
 *   assets/cases/<caseId>/characters/anchors.json entry, else the global assets/characters/anchors.json entry, else
 *   none (today's behaviour: no bust framing / overlays; a silhouette when there is no sprite either).
 */
import { ANCHORS, type PoseAnchors } from "./sprite-meta";

export const CASE_SPRITE_ROOT = "/assets/cases";
export const GLOBAL_SPRITE_ROOT = "/assets/characters";
const KEY = /^_?[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export interface CharacterSprite {
  /** Pose names that exist (empty -> silhouette). */
  poses: string[];
  /** URL folder of the case's own sprites; absent = the global assets/characters/<key>/. */
  spriteDir?: string;
  /** Per-case anchors for this character; absent = the global anchors (or none). */
  anchors?: PoseAnchors;
}

export function resolveCharacterSprite(
  caseId: string,
  key: string,
  caseFiles: ReadonlyMap<string, readonly string[]>,
  caseAnchors: Readonly<Record<string, PoseAnchors>> = {},
  globalAnchors: Readonly<Record<string, PoseAnchors>> = ANCHORS.sprites,
): CharacterSprite {
  const own = KEY.test(caseId) && KEY.test(key) ? [...(caseFiles.get(key) ?? [])].sort() : [];
  const anchors = caseAnchors[key];
  if (own.length) return { poses: own, spriteDir: `${CASE_SPRITE_ROOT}/${caseId}/characters/${key}`, ...(anchors ? { anchors } : {}) };
  return { poses: Object.keys(globalAnchors[key] ?? {}), ...(anchors ? { anchors } : {}) };
}
