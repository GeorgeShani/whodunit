/** Public, case-agnostic site metadata (never put case content or secrets here). */
export const SITE = {
  name: "WHODUNIT?!",
  shortName: "WHODUNIT",
  url: "https://whodunit-nu.vercel.app",
  description: "An AI-powered cartoon murder mystery. Interrogate suspects who lie, panic and remember.",
  /** Palette: deep night purple (globals.css --background) and cream (--foreground). */
  themeColor: "#1b1035",
  backgroundColor: "#1b1035",
} as const;
