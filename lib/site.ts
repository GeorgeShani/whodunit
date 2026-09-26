/** Canonical production origin. The old https://whodunit-nu.vercel.app alias is not canonical. */
export const DEFAULT_SITE_URL = "https://whodunit-game.vercel.app";

/** Normalise an origin: trim, drop trailing slashes; fall back to the default if missing or not http(s). */
export function resolveSiteUrl(raw: string | undefined): string {
  const v = raw?.trim().replace(/\/+$/, "");
  if (!v) return DEFAULT_SITE_URL;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : DEFAULT_SITE_URL;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** Single source of truth for absolute URLs (metadataBase, sitemap, robots, OG). Override with NEXT_PUBLIC_SITE_URL. */
export const SITE_URL = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

/** Public, case-agnostic site metadata (never put case content or secrets here). */
export const SITE = {
  name: "WHODUNIT?!",
  shortName: "WHODUNIT",
  url: SITE_URL,
  description: "An AI-powered cartoon murder mystery. Interrogate suspects who lie, panic and remember.",
  /** Palette: deep night purple (globals.css --background) and cream (--foreground). */
  themeColor: "#1b1035",
  backgroundColor: "#1b1035",
} as const;
