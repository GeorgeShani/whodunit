import { describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import { AssetPathSchema } from "@/engine/types";
import { getPublicCaseView } from "@/engine/public-view";
import { ART_DEFAULTS, assetExists, resolveCaseArt } from "@/lib/case-art";
import { FIXTURES_DIR } from "../helpers/fixture";

describe("case art resolution", () => {
  it("blackwood: suspects get the manor hall (ART_BIBLE §7.2) and the library card its conventional background", async () => {
    const view = resolveCaseArt(getPublicCaseView(await loadCase("blackwood")));
    expect(view.backdrops.suspects).toBe("/assets/backgrounds/manor.webp");
    expect(view.locations.find((l) => l.id === "library")?.background).toBe("/assets/backgrounds/library.webp");
    expect(view.locations.find((l) => l.id === "garden")?.background).toBeUndefined();
  });

  it("case data wins over the stopgap defaults; location.background wins over the file convention", async () => {
    const view = resolveCaseArt(getPublicCaseView(await loadCase("harbor-light", FIXTURES_DIR)));
    expect(view.backdrops).toEqual({ suspects: "/assets/backgrounds/library.webp" });
    expect(view.locations.find((l) => l.id === "lamp-room")?.background).toBe("/assets/backgrounds/manor.webp");
    expect(view.locations.find((l) => l.id === "galley")?.background).toBeUndefined();
  });

  it("drops art whose file doesn't exist", async () => {
    const base = getPublicCaseView(await loadCase("harbor-light", FIXTURES_DIR));
    const view = resolveCaseArt({ ...base, backdrops: { interrogation: "/assets/backgrounds/nope.webp" }, locations: base.locations.map((l) => ({ ...l, background: "/assets/backgrounds/nope.webp" })) });
    expect(view.backdrops).toEqual({});
    expect(view.locations.every((l) => !l.background)).toBe(true);
  });

  it("every stopgap default points at a real asset", () => {
    for (const b of Object.values(ART_DEFAULTS)) for (const p of Object.values(b)) expect(assetExists(p as string), p).toBe(true);
  });

  it.each(["/assets/../secret.webp", "https://evil.test/x.webp", "/assets/backgrounds/x.webp?x=1", "assets/x.webp", "/assets/x.exe", "/assets/a/..b/x.png"])(
    "asset path schema rejects %s",
    (p) => expect(AssetPathSchema.safeParse(p).success).toBe(false),
  );

  it("asset path schema accepts a normal path", () => {
    expect(AssetPathSchema.safeParse("/assets/backgrounds/manor.webp").success).toBe(true);
  });
});
