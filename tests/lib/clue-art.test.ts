import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccuseScreen } from "@/components/accuse/AccuseScreen";
import { ClueArt, ClueArtProvider } from "@/components/evidence/ClueArt";
import { DiscoverySting } from "@/components/evidence/DiscoverySting";
import { Notebook } from "@/components/evidence/Notebook";
import { EvidenceSchema } from "@/engine/types";
import { toPublicEvidence } from "@/engine/public-view";
import { availableClueArt, CLUE_FALLBACK_ICON, clueIcon, resolveClueArt, validClueIcon } from "@/lib/clue-art";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const set = (...k: string[]) => new Set(k);

describe("resolveClueArt", () => {
  it("uses assets/evidence/<id>.webp when it exists (even if the item also has an icon)", () => {
    expect(resolveClueArt("blackwood", { id: "silver-candlestick", icon: "🕯️" }, set("silver-candlestick"))).toEqual({ kind: "image", src: "/assets/evidence/silver-candlestick.webp" });
  });

  it("prefers the per-case folder over the shared one", () => {
    expect(resolveClueArt("blackwood", { id: "key" }, set("key", "blackwood/key"))).toEqual({ kind: "image", src: "/assets/evidence/blackwood/key.webp" });
    expect(resolveClueArt("other", { id: "key" }, set("key", "blackwood/key"))).toEqual({ kind: "image", src: "/assets/evidence/key.webp" });
  });

  it("still honours the legacy `image` key when that file exists", () => {
    expect(resolveClueArt("c", { id: "a", image: "old-art" }, set("old-art"))).toEqual({ kind: "image", src: "/assets/evidence/old-art.webp" });
  });

  it("an absent file never produces an image (no 404): icon, then generic", () => {
    expect(resolveClueArt("c", { id: "a", icon: "🗝️", image: "missing" }, set("something-else"))).toEqual({ kind: "icon", icon: "🗝️" });
    expect(resolveClueArt("c", { id: "a" }, set())).toEqual({ kind: "icon", icon: CLUE_FALLBACK_ICON });
  });

  it("an invalid image key or id is ignored, never turned into a src", () => {
    const evil = set("../x", "http://evil/x", "a b");
    expect(resolveClueArt("c", { id: "a", image: "../x" }, evil).kind).toBe("icon");
    expect(resolveClueArt("c", { id: "a", image: "http://evil/x" }, evil).kind).toBe("icon");
    expect(resolveClueArt("c", { id: "../x" }, evil).kind).toBe("icon");
    expect(resolveClueArt("c", { id: "a", image: "/assets/evidence/a.webp" }, set("a")).kind).toBe("image"); // id still matches by convention
  });

  it("an invalid icon (too long, plain letters, blank) falls back to the neutral icon", () => {
    for (const icon of ["wrench", "🔧🔧🔧🔧🔧🔧🔧🔧🔧", "", "  ", "ab"]) expect(resolveClueArt("c", { id: "a", icon }, set())).toEqual({ kind: "icon", icon: CLUE_FALLBACK_ICON });
    expect(validClueIcon("🕯️")).toBe(true);
    expect(clueIcon({ icon: " 👣 " })).toBe("👣");
  });

  it("the shared _fallback.webp is the last resort when listed (after the icon), and cannot be claimed by an id", () => {
    expect(resolveClueArt("c", { id: "a" }, set("_fallback"))).toEqual({ kind: "image", src: "/assets/evidence/_fallback.webp" });
    expect(resolveClueArt("c", { id: "a", icon: "🗝️" }, set("_fallback"))).toEqual({ kind: "icon", icon: "🗝️" });
    expect(resolveClueArt("c", { id: "_fallback" }, set("_fallback"))).toEqual({ kind: "image", src: "/assets/evidence/_fallback.webp" }); // via the fallback rule, not the id
    expect(resolveClueArt("c", { id: "a", image: "_fallback" }, set("_fallback")).kind).toBe("image");
  });

  it("the fallback is never kind-specific", () => {
    expect(CLUE_FALLBACK_ICON).toBe("🔍");
    expect(clueIcon({})).not.toBe("🔧");
  });

  it("reads the available files from the build-time list", () => {
    expect([...availableClueArt("a,blackwood/b, c ,")]).toEqual(["a", "blackwood/b", "c"]);
    expect(availableClueArt(undefined).size).toBe(0);
  });
});

describe("evidence icon field", () => {
  const base = { id: "k", name: "K", description: "d", kind: "physical" } as const;
  it("is optional, strict, and short", () => {
    expect(EvidenceSchema.safeParse(base).success).toBe(true);
    expect(EvidenceSchema.safeParse({ ...base, icon: "🗝️" }).success).toBe(true);
    expect(EvidenceSchema.safeParse({ ...base, icon: "" }).success).toBe(false);
    expect(EvidenceSchema.safeParse({ ...base, icon: "key" }).success).toBe(false);
    expect(EvidenceSchema.safeParse({ ...base, icon: "🗝️".repeat(5) }).success).toBe(false);
    expect(EvidenceSchema.safeParse({ ...base, ikon: "🗝️" }).success).toBe(false);
  });
  it("reaches the public view", () => {
    expect(toPublicEvidence(EvidenceSchema.parse({ ...base, icon: "🗝️" })).icon).toBe("🗝️");
    expect("icon" in toPublicEvidence(EvidenceSchema.parse(base))).toBe(false);
  });
});

describe("Blackwood clue icons", () => {
  const items = JSON.parse(readFileSync(path.join(process.cwd(), "cases/blackwood/evidence.json"), "utf8")) as { id: string; kind: string; icon?: string }[];
  it("every item has an authored icon, and the candlestick/key are not a wrench", () => {
    for (const e of items) expect(validClueIcon(e.icon), e.id).toBe(true);
    expect(items.find((e) => e.id === "silver-candlestick")?.icon).toBe("🕯️");
    expect(items.find((e) => e.id === "library-key")?.icon).toBe("🗝️");
    expect(items.map((e) => e.icon)).not.toContain("🔧");
  });
});

describe("screens use the resolver (no kind-based wrench)", () => {
  // A physical clue with NO icon must show the neutral icon, never the old 🔧 for kind "physical".
  const bare = { id: "mystery-thing", name: "Mystery Thing", description: "d", kind: "physical" as const };
  const withIcon = { id: "silver-candlestick", name: "Silver Candlestick", description: "d", kind: "physical" as const, icon: "🕯️" };
  const wrap = (el: Parameters<typeof html>[0]) => html(h(ClueArtProvider, { caseId: "blackwood", children: el }));
  const suspects = [{ id: "ann", name: "Ann Lee", role: "Cook", bio: "b", portrait: "ann", poses: [], emotion: { emotion: "calm", intensity: 0.2, composure: 0.9 } }] as never;

  it("ClueArt: icon, neutral fallback, or an illustration when the file is listed", () => {
    expect(wrap(h(ClueArt, { evidence: withIcon }))).toContain("🕯️");
    const out = wrap(h(ClueArt, { evidence: bare }));
    expect(out).toContain(CLUE_FALLBACK_ICON);
    expect(out).not.toContain("🔧");
    expect(out).not.toContain("<img");
  });

  it("ClueArt renders an <img> for a listed illustration (build-time list), still with an icon fallback", () => {
    vi.stubEnv("NEXT_PUBLIC_CLUE_ART", "blackwood/silver-candlestick");
    const out = wrap(h(ClueArt, { evidence: withIcon }));
    expect(out).toContain('src="/assets/evidence/blackwood/silver-candlestick.webp"');
    expect(out).toContain('data-clue-art="image"');
    expect(wrap(h(ClueArt, { evidence: bare }))).not.toContain("<img");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("Notebook cards", () => {
    const out = wrap(h(Notebook, { evidence: [withIcon, bare], testimonies: [], locations: [], notes: {}, suspects, onPresent: () => {}, onClose: () => {} }));
    expect(out).toContain("🕯️");
    expect(out).toContain(CLUE_FALLBACK_ICON);
    expect(out).not.toContain("🔧");
    expect(out).not.toContain("<img");
  });

  it("Accuse weapon and proof pickers", () => {
    const out = wrap(h(AccuseScreen, { suspects, evidence: [withIcon, bare], motives: [], busy: false, onSubmit: () => {}, onBack: () => {} }));
    expect(out).toContain("🕯️");
    expect(out.match(/data-clue-art="icon"/g)?.length).toBeGreaterThanOrEqual(4); // 2 weapons + 2 proofs
    expect(out).not.toContain("🔧");
  });

  it("Clue-found overlay", () => {
    const out = wrap(h(DiscoverySting, { clue: withIcon, remaining: 0, onDone: () => {} }));
    if (out) expect(out).not.toContain("🔧");
  });

  it("no component carries a per-kind icon table or the wrench emoji any more", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
    const files = walk(path.join(process.cwd(), "components")).filter((f) => /\.(tsx?|css)$/.test(f));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("🔧");
      expect(src, f).not.toContain("KIND_ICON");
    }
  });
});

describe("assets/evidence convention", () => {
  it("documents the filename convention and the folder exists", () => {
    expect(existsSync(path.join(process.cwd(), "assets/evidence/README.md"))).toBe(true);
    expect(readFileSync(path.join(process.cwd(), "docs/CASE_FORMAT.md"), "utf8")).toContain("assets/evidence/<id>.webp");
  });
});
