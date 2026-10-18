/**
 * SERVER-ONLY. Which per-case character sprites exist (assets/cases/<caseId>/characters/<key>/<pose>.webp) and the
 * case's anchors (assets/cases/<caseId>/characters/anchors.json), read once per process: at build time for the
 * statically generated case pages, at start in dev. Adding art needs a new build (Vercel does that on deploy).
 * The lookup order itself lives in components/characters/sprite-lookup.ts.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveCharacterSprite, type CharacterSprite } from "@/components/characters/sprite-lookup";
import { AnchorsFile, CANVAS_H, CANVAS_W, type PoseAnchors } from "@/components/characters/sprite-meta";

const KEY = /^_?[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const dirOf = (caseId: string) => path.join(process.cwd(), "assets", "cases", caseId, "characters");

const files = new Map<string, Map<string, string[]>>();
/** Pose files per portrait key under assets/cases/<caseId>/characters/. */
export function caseSpriteFiles(caseId: string): Map<string, string[]> {
  const hit = files.get(caseId);
  if (hit) return hit;
  const out = new Map<string, string[]>();
  const root = dirOf(caseId);
  if (KEY.test(caseId) && existsSync(root)) {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || !KEY.test(e.name)) continue;
      const poses = readdirSync(path.join(root, e.name)).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5)).filter((p) => KEY.test(p));
      if (poses.length) out.set(e.name, poses.sort());
    }
  }
  files.set(caseId, out);
  return out;
}

const anchors = new Map<string, Record<string, PoseAnchors>>();
/** The case's anchors.json `sprites` (same shape as assets/characters/anchors.json), or {} when absent. Throws if malformed. */
export function caseAnchors(caseId: string): Record<string, PoseAnchors> {
  const hit = anchors.get(caseId);
  if (hit) return hit;
  const file = path.join(dirOf(caseId), "anchors.json");
  let out: Record<string, PoseAnchors> = {};
  if (KEY.test(caseId) && existsSync(file)) {
    const parsed = AnchorsFile.parse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed.canvas[0] !== CANVAS_W || parsed.canvas[1] !== CANVAS_H) throw new Error(`${file}: canvas must be [${CANVAS_W}, ${CANVAS_H}]`);
    out = parsed.sprites;
  }
  anchors.set(caseId, out);
  return out;
}

/** Sprite lookup for every character of a case, by portrait key. */
export function caseCharacterSprites(c: { id: string; characters: readonly { id: string; portrait?: string | undefined }[] }): Record<string, CharacterSprite> {
  const f = caseSpriteFiles(c.id);
  const a = caseAnchors(c.id);
  return Object.fromEntries(c.characters.map((ch) => {
    const key = ch.portrait ?? ch.id;
    return [key, resolveCharacterSprite(c.id, key, f, a)];
  }));
}

/** getPublicCaseView options for a case's sprites: poses for everyone, folder/anchors only for case-owned art. */
export function spriteViewOptions(c: Parameters<typeof caseCharacterSprites>[0]) {
  const sprites = caseCharacterSprites(c);
  return {
    portraitPoses: Object.fromEntries(Object.entries(sprites).map(([k, s]) => [k, s.poses])),
    portraitSprites: Object.fromEntries(
      Object.entries(sprites)
        .filter(([, s]) => s.spriteDir || s.anchors)
        .map(([k, { spriteDir, anchors: a }]) => [k, { ...(spriteDir ? { spriteDir } : {}), ...(a ? { anchors: a } : {}) }]),
    ),
  };
}
