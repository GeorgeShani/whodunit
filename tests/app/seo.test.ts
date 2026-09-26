import { describe, expect, it } from "vitest";
import { metadata, viewport } from "@/lib/metadata";
import manifest from "@/app/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { DEFAULT_SITE_URL, resolveSiteUrl, SITE } from "@/lib/site";
import { loadCase } from "@/engine/case-loader";

describe("SEO routes", () => {
  it("robots allows everything and links the sitemap", () => {
    const r = robots();
    expect(r.rules).toEqual([{ userAgent: "*", allow: "/" }]);
    expect(r.sitemap).toBe(`${DEFAULT_SITE_URL}/sitemap.xml`);
  });

  it("sitemap lists only the root URL", () => {
    const s = sitemap();
    expect(s.map((e) => e.url)).toEqual([DEFAULT_SITE_URL]);
  });

  it("manifest is a standalone app starting at /", () => {
    const m = manifest();
    expect(m).toMatchObject({
      name: "WHODUNIT?!",
      short_name: SITE.shortName,
      description: SITE.description,
      start_url: "/",
      display: "standalone",
      theme_color: SITE.themeColor,
      background_color: SITE.backgroundColor,
    });
    expect(m.icons?.length).toBeGreaterThan(0);
  });

  it("layout metadata has the title template, metadataBase, OG and Twitter cards", () => {
    expect(metadata.title).toEqual({ default: "WHODUNIT?!", template: "%s | WHODUNIT?!" });
    expect(metadata.description).toBe("An AI-powered cartoon murder mystery. Interrogate suspects who lie, panic and remember.");
    expect(String(metadata.metadataBase)).toBe(`${DEFAULT_SITE_URL}/`);
    expect(metadata.openGraph).toMatchObject({ type: "website", siteName: "WHODUNIT?!", url: "/" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(viewport.themeColor).toBe(SITE.themeColor);
  });

  it("metadata leaks no case content (suspect names, clues, solution)", async () => {
    const c = await loadCase("blackwood");
    const blob = JSON.stringify({ metadata, manifest: manifest(), SITE });
    const forbidden = [
      ...c.characters.flatMap((ch) => [ch.name, ch.id]),
      ...c.evidence.map((e) => e.name),
      c.victim.name,
      c.solution.murdererId,
      ...(c.solution.explanation ? [c.solution.explanation] : []),
    ];
    for (const f of forbidden) expect(blob.toLowerCase()).not.toContain(f.toLowerCase());
  });
});

describe("SITE_URL", () => {
  it("defaults to the canonical domain and honours NEXT_PUBLIC_SITE_URL", () => {
    expect(DEFAULT_SITE_URL).toBe("https://whodunit-game.vercel.app");
    expect(resolveSiteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("  ")).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("https://example.com/")).toBe("https://example.com");
    expect(resolveSiteUrl("javascript:alert(1)")).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("not a url")).toBe(DEFAULT_SITE_URL);
  });
});
