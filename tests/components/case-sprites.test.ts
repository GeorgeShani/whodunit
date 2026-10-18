import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCharacterSprite } from "@/components/characters/sprite-lookup";
import { ANCHORS, anchorsOf, overlayPlacement, type PoseAnchors } from "@/components/characters/sprite-meta";
import { portraitSrc, poseAssetUrls, resolvePose } from "@/components/effects/emotion-map";
import { bustFrame, contactShadowPct } from "@/components/stage/layout";
import { caseAnchors, caseCharacterSprites, caseSpriteFiles, spriteViewOptions } from "@/lib/case-sprites.server";
import { getPublicCaseView } from "@/engine/public-view";
import { getPublicCase } from "@/engine/case-registry";

const reg = ANCHORS.sprites.reginald!;
const shifted: PoseAnchors = { neutral: { ...reg.neutral!, headCenter: [300, 200] } };

describe("per-case sprite lookup order", () => {
  const files = new Map([["ana", ["neutral", "angry"]], ["reginald", ["neutral"]]]);

  it("1. case emotion pose, 2. case neutral, 3. global unchanged", () => {
    const ana = resolveCharacterSprite("case-two", "ana", files, {}, {});
    expect(ana.spriteDir).toBe("/assets/cases/case-two/characters/ana");
    const s = { portrait: "ana", ...ana };
    expect(portraitSrc(s, resolvePose("angry", ana.poses)!)).toBe("/assets/cases/case-two/characters/ana/angry.webp");
    expect(portraitSrc(s, resolvePose("nervous", ana.poses)!)).toBe("/assets/cases/case-two/characters/ana/neutral.webp");
    const g = resolveCharacterSprite("case-two", "victoria", files);
    expect(g).toEqual({ poses: Object.keys(ANCHORS.sprites.victoria!) });
    expect(portraitSrc({ portrait: "victoria", ...g }, "neutral")).toBe("/assets/characters/victoria/neutral.webp");
  });

  it("case folder replaces the global sprites for that character; nothing anywhere = silhouette", () => {
    expect(resolveCharacterSprite("case-two", "reginald", files).poses).toEqual(["neutral"]);
    expect(resolveCharacterSprite("case-two", "nobody", files, {}, {}).poses).toEqual([]);
    expect(poseAssetUrls({ portrait: "ana", poses: ["neutral"], spriteDir: "/assets/cases/x/characters/ana" })[0]).toBe("/assets/cases/x/characters/ana/neutral.webp");
  });

  it("rejects unsafe ids", () => {
    expect(resolveCharacterSprite("../x", "ana", files, {}, {}).spriteDir).toBeUndefined();
  });
});

describe("per-case anchors precedence", () => {
  it("case entry wins per character, else global, else none", () => {
    const files = new Map([["reginald", ["neutral"]], ["ana", ["neutral"]]]);
    const own = resolveCharacterSprite("c", "reginald", files, { reginald: shifted });
    expect(own.anchors).toBe(shifted);
    expect(anchorsOf({ portrait: "reginald", ...own })).toBe(shifted);
    expect(bustFrame({ portrait: "reginald", ...own }, "neutral", 2, false)).not.toEqual(bustFrame("reginald", "neutral", 2, false));
    const glob = resolveCharacterSprite("c", "victoria", files, { reginald: shifted });
    expect(glob.anchors).toBeUndefined();
    expect(anchorsOf({ portrait: "victoria", ...glob })).toBe(ANCHORS.sprites.victoria);
    const none = { portrait: "ana", ...resolveCharacterSprite("c", "ana", files, {}, {}) };
    expect(anchorsOf(none)).toBeUndefined();
    expect(bustFrame(none, "neutral", 2, false)).toEqual(bustFrame("no-such-portrait", "neutral", 2, false));
    expect(contactShadowPct(none)).toEqual(contactShadowPct("no-such-portrait"));
    expect(overlayPlacement(none, "neutral", "sweat", { mirrored: false })).toEqual(overlayPlacement("no-such-portrait", "neutral", "sweat", { mirrored: false }));
  });
});

describe("real assets", () => {
  it("Blackwood: sprites resolve as before and the public view gains no fields", async () => {
    const c = await getPublicCase("blackwood");
    const opts = spriteViewOptions(c);
    expect(opts.portraitSprites).toEqual({});
    for (const ch of c.characters) expect(opts.portraitPoses[ch.portrait ?? ch.id]).toEqual(Object.keys(ANCHORS.sprites[ch.portrait ?? ch.id] ?? {}));
    const before = getPublicCaseView(c, { portraitPoses: opts.portraitPoses });
    expect(getPublicCaseView(c, opts)).toEqual(before);
    for (const s of before.suspects) expect(s).not.toHaveProperty("spriteDir");
  });

  it("Tallyho: every character resolves to its case neutral.webp", () => {
    const dir = path.join(process.cwd(), "cases", "_tallyho", "characters");
    const characters = readdirSync(dir).map((f) => ({ id: f.replace(/\.json$/, "") }));
    expect(characters.length).toBe(6);
    // Toon's per-case anchors (neutral only for now): one entry per character, on the shared canvas baseline.
    const anchors = caseAnchors("_tallyho");
    expect(Object.keys(anchors).sort()).toEqual(characters.map((c) => c.id).sort());
    for (const { id } of characters) expect(anchors[id]?.neutral?.feet).toEqual([392, 1200]);
    const sprites = caseCharacterSprites({ id: "_tallyho", characters });
    for (const { id } of characters) {
      const s = sprites[id]!;
      expect(s.poses).toContain("neutral");
      expect(portraitSrc({ portrait: id, ...s }, resolvePose("angry", s.poses)!)).toBe(`/assets/cases/_tallyho/characters/${id}/neutral.webp`);
    }
    expect(caseSpriteFiles("no-such-case").size).toBe(0);
  });
});
