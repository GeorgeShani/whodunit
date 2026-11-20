/**
 * After the publish rename, every Tallyho theme, backdrop, location, sprite, diagram and audio
 * path must resolve to a real file under assets/cases/tallyho/. Missing files would be silently
 * replaced by Blackwood / shared art or sound (lib/case-art.ts, audioUrl).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CUES } from "@/components/effects/audio";
import { loadPlayableCase } from "@/engine/case-loader";
import { featureAssetPaths } from "@/engine/features/registry";
import { checkPresentationAssets } from "@/engine/presentation-validation";
import { getPublicCaseView } from "@/engine/public-view";
import { assetExists, DEFAULT_BACKDROPS, resolveCaseArt } from "@/lib/case-art";
import { caseAudioFiles } from "@/lib/case-audio.server";
import { caseAnchors, caseCharacterSprites, spriteViewOptions } from "@/lib/case-sprites.server";

const CASE_PREFIX = "/assets/cases/tallyho/";
const onDisk = (assetPath: string) => path.join("assets", assetPath.slice("/assets/".length));

function collectAssetPaths(value: unknown, out: Set<string>): void {
  if (typeof value === "string" && value.startsWith("/assets/")) out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => collectAssetPaths(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectAssetPaths(v, out));
}

describe("Tallyho asset paths resolve under assets/cases/tallyho/", () => {
  it("every /assets path in the case data is a case-folder file that exists", async () => {
    const c = await loadPlayableCase("tallyho");
    const paths = new Set<string>();
    collectAssetPaths(JSON.parse(readFileSync("cases/tallyho/case.json", "utf8")), paths);
    collectAssetPaths(JSON.parse(readFileSync("cases/tallyho/evidence.json", "utf8")), paths);
    for (const f of featureAssetPaths(c)) paths.add(f.path);

    expect(paths.size).toBeGreaterThan(0);
    for (const p of [...paths].sort()) {
      expect(p.startsWith(CASE_PREFIX), p).toBe(true);
      expect(p.includes("/_tallyho/"), p).toBe(false);
      expect(assetExists(p), p).toBe(true);
      expect(existsSync(onDisk(p)), p).toBe(true);
    }
  });

  it("theme, backdrops and location backgrounds exist; resolveCaseArt does not fall back to Blackwood art", async () => {
    const c = await loadPlayableCase("tallyho");
    expect(checkPresentationAssets(c, { exists: (p) => assetExists(p), cueNames: Object.keys(CUES) })).toEqual([]);

    const resolved = resolveCaseArt(getPublicCaseView(c, spriteViewOptions(c)));
    expect(resolved.theme?.logo).toBe(`${CASE_PREFIX}logo.webp`);
    expect(resolved.theme?.titleArt).toBe(`${CASE_PREFIX}title.webp`);
    expect(resolved.backdrops?.suspects).toBe(`${CASE_PREFIX}backgrounds/ballroom.webp`);
    expect(resolved.backdrops?.suspects).not.toBe(DEFAULT_BACKDROPS.suspects);
    for (const l of resolved.locations) {
      expect(l.background, l.id).toBe(`${CASE_PREFIX}backgrounds/${l.id}.webp`);
      expect(l.background, l.id).not.toMatch(/^\/assets\/backgrounds\//);
      expect(assetExists(l.background!), l.background).toBe(true);
    }
    const blob = JSON.stringify(resolved);
    expect(blob).not.toContain("/assets/backgrounds/manor.webp");
    expect(blob).not.toContain("/assets/cases/_tallyho/");
  });

  it("every character has a case-folder sprite and anchors, not the shared Blackwood portraits", async () => {
    const c = await loadPlayableCase("tallyho");
    const sprites = caseCharacterSprites(c);
    const anchors = caseAnchors("tallyho");
    expect(existsSync("assets/cases/tallyho/characters/anchors.json")).toBe(true);
    expect(c.characters.length).toBe(6);
    for (const ch of c.characters) {
      const key = ch.portrait ?? ch.id;
      const s = sprites[key];
      expect(s?.poses.includes("neutral"), ch.id).toBe(true);
      expect(s?.spriteDir, ch.id).toBe(`/assets/cases/tallyho/characters/${key}`);
      expect(s?.spriteDir, ch.id).not.toMatch(/^\/assets\/characters\//);
      expect(existsSync(`assets/cases/tallyho/characters/${key}/neutral.webp`), ch.id).toBe(true);
      expect(anchors[key], ch.id).toBeTruthy();
    }
  });

  it("every named audio stem ships in the case folder (ogg+mp3), so cues do not fall back to shared sounds", async () => {
    const c = await loadPlayableCase("tallyho");
    const stems = new Set<string>([
      ...Object.values(c.audio?.beds ?? {}),
      ...Object.values(c.audio?.rooms ?? {}),
      ...Object.values(c.audio?.cues ?? {}).flat(),
      "case_open",
      "door_creak",
      "door_slam",
    ]);
    const shipped = caseAudioFiles("tallyho");
    for (const stem of stems) {
      expect(shipped, stem).toContain(stem);
      for (const ext of ["ogg", "mp3"] as const) {
        const p = `${CASE_PREFIX}audio/${stem}.${ext}`;
        expect(assetExists(p), p).toBe(true);
      }
    }
  });
});
