/**
 * Case-two plan phase 3 (section 4.4): per-case presentation as data. Every block is optional and its defaults
 * reproduce the first case's wording and look byte for byte, so a case that omits a block is unchanged.
 *
 * - `setting`: in-world wording (place, era, the site's noun, the authority, the roster line, vocabulary).
 * - `theme`: presentation only (Q7): named palette tokens, an optional logo and title art under /assets/cases/<id>/.
 *   No per-case fonts, layouts, components or CSS.
 * - `orderLandmarks` / `orderWords`: the order-of-events check's landmarks and movement words (ai/order-check.ts).
 * - `audio`: per-screen beds and cue file overrides (components/effects/audio.ts).
 *
 * Client-safe (no fs, no server imports).
 */
import { z } from "zod";
import { AssetPathSchema } from "./types";

const Phrase = z.string().trim().min(1).max(80);
const Word = z.string().trim().min(1).max(40);

export const SettingSchema = z.strictObject({
  /** "You live {place} in {dateLine ?? decade}." */
  place: Phrase.optional(),
  decade: Phrase.optional(),
  /** Overrides `decade` in the era sentence. */
  dateLine: Phrase.optional(),
  /** Short noun phrase for the site, with its article ("the house", "the ship"). */
  site: z
    .string()
    .trim()
    .regex(/^the [a-z][a-z' -]{0,38}$/, 'a short noun phrase starting with "the"')
    .optional(),
  /** The people of the site as a group ("the household", "the passengers"). */
  household: z
    .string()
    .trim()
    .regex(/^the [a-z][a-z' -]{0,38}$/, 'a short noun phrase starting with "the"')
    .optional(),
  /** The in-world authority. Never a suspect (validator). */
  authority: z.strictObject({ noun: Phrase, policeAboard: z.boolean().optional(), note: z.string().trim().min(1).max(160).optional() }).optional(),
  /** Prompt line before the other characters ("Others in the house:"). */
  roster: z.string().trim().min(1).max(40).optional(),
  vocabulary: z
    .strictObject({
      /** Ordinary in this world: named in the prompt and exempt from every banned list. */
      allowed: z.array(Word).max(30).optional(),
      /** Added to the default anachronism list (whole words or phrases, case-insensitive, plural-aware). */
      banned: z.array(Word).max(30).optional(),
    })
    .optional(),
});
export type Setting = z.infer<typeof SettingSchema>;

export const DEFAULT_SETTING = {
  place: "in an English country house",
  decade: "the 1920s",
  site: "the house",
  household: "the household",
  authority: { noun: "the constable", policeAboard: true },
  roster: "Others in the house:",
} as const;

export interface ResolvedSetting {
  place: string;
  era: string;
  site: string;
  household: string;
  authority: { noun: string; policeAboard: boolean; note?: string };
  roster: string;
  allowed: string[];
  banned: string[];
  /** True when the case wrote no `setting` (the first case's exact wording applies). */
  isDefault: boolean;
}

export function resolveSetting(s: Setting | undefined): ResolvedSetting {
  return {
    place: s?.place ?? DEFAULT_SETTING.place,
    era: s?.dateLine ?? s?.decade ?? DEFAULT_SETTING.decade,
    site: s?.site ?? DEFAULT_SETTING.site,
    household: s?.household ?? DEFAULT_SETTING.household,
    authority: s?.authority
      ? { noun: s.authority.noun, policeAboard: s.authority.policeAboard ?? false, ...(s.authority.note ? { note: s.authority.note } : {}) }
      : { ...DEFAULT_SETTING.authority },
    roster: s?.roster ?? DEFAULT_SETTING.roster,
    allowed: s?.vocabulary?.allowed ?? [],
    banned: s?.vocabulary?.banned ?? [],
    isDefault: s === undefined,
  };
}

/** The public part of a setting (what screens need). Present in the public view only when the case writes `setting`. */
export interface PublicSetting {
  site: string;
  household: string;
}
export const publicSetting = (s: Setting | undefined): PublicSetting => {
  const r = resolveSetting(s);
  return { site: r.site, household: r.household };
};

/** "the house" -> "house" (for "this house", "the whole house"). */
export const siteNoun = (site: string) => site.replace(/^the\s+/i, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Fill a line's setting slots: {site} "the house", {Site} "The house", {siteNoun} "house", {household} "the household",
 * {Household} "The household".
 */
export function fillSetting(line: string, s: Pick<PublicSetting, "site" | "household">): string {
  return line
    .replaceAll("{site}", s.site)
    .replaceAll("{Site}", cap(s.site))
    .replaceAll("{siteNoun}", siteNoun(s.site))
    .replaceAll("{household}", s.household)
    .replaceAll("{Household}", cap(s.household));
}

// ---------------------------------------------------------------------------
// Theme (Q7, decided): presentation only.
// ---------------------------------------------------------------------------

/** Named palette tokens (CSS custom properties `--<token>`, Tailwind colours `*-<token>`; app/globals.css). */
export const PALETTE_TOKENS = ["backdrop", "paper", "ink", "accent"] as const;
export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export type Palette = Record<PaletteToken, string>;

/** The default palette (the first case's look). `accent` is Tailwind's yellow-300, written here as hex for the contrast check. */
export const DEFAULT_PALETTE: Palette = { backdrop: "#1b1035", paper: "#fff8e7", ink: "#000000", accent: "#ffdf20" };

/** Text/background pairs that must stay readable (WCAG AA, 4.5:1). */
export const CONTRAST_PAIRS: readonly { fg: PaletteToken; bg: PaletteToken; min: number }[] = [
  { fg: "ink", bg: "paper", min: 4.5 },
  { fg: "accent", bg: "backdrop", min: 4.5 },
  { fg: "paper", bg: "backdrop", min: 4.5 },
];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Asset paths a theme may use: only under /assets/cases/<id>/ (the case's own folder; checked against the id by the validator). */
const CaseAssetPath = AssetPathSchema.refine((p) => /^\/assets\/cases\/[a-z0-9_-]+\//.test(p), "theme assets live under /assets/cases/<caseId>/");

export const ThemeSchema = z.strictObject({
  /** Overrides for named tokens only; unnamed tokens keep the default. Colours are #rgb or #rrggbb. */
  palette: z.partialRecord(z.enum(PALETTE_TOKENS), z.string().regex(HEX, "a #rgb or #rrggbb colour")).optional(),
  /** Replaces the WHODUNIT?! title logo. */
  logo: CaseAssetPath.optional(),
  /** Title screen art (the backdrop behind the logo). */
  titleArt: CaseAssetPath.optional(),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const resolvePalette = (t: Theme | undefined): Palette => ({ ...DEFAULT_PALETTE, ...(t?.palette ?? {}) });

function luminance(hex: string): number {
  const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Pairs in a palette below their minimum contrast. */
export function contrastFailures(p: Palette): { fg: PaletteToken; bg: PaletteToken; ratio: number; min: number }[] {
  return CONTRAST_PAIRS.map((c) => ({ ...c, ratio: contrastRatio(p[c.fg], p[c.bg]) })).filter((c) => c.ratio < c.min);
}

/** CSS custom properties for a theme's overrides (only the tokens the case sets; the rest inherit app/globals.css). */
export function themeStyle(t: Theme | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(t?.palette ?? {}).map(([k, v]) => [`--${k}`, v]));
}

// ---------------------------------------------------------------------------
// Order-of-events landmarks and movement words (ai/order-check.ts)
// ---------------------------------------------------------------------------

/** A regex source: length-capped, no nested quantifiers (a cheap catastrophic-backtracking guard). */
export const SafePattern = z
  .string()
  .min(1)
  .max(600)
  .refine((p) => !/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(p), "nested quantifiers are not allowed")
  .refine((p) => {
    try {
      new RegExp(p, "i");
      return true;
    } catch {
      return false;
    }
  }, "not a valid regular expression");

export const OrderLandmarkSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Shown in the prompt ("THE EVENING IN ORDER") and in retry notes. */
  label: z.string().trim().min(1).max(80),
  /** How a speaker refers to it (alternatives). */
  say: z.array(SafePattern).min(1).max(12),
  /** How a knowledge statement describes it (alternatives). */
  fact: z.array(SafePattern).min(1).max(12),
  /** Which matching fact times it: the earliest (default) or the latest (e.g. "the lights come back"). */
  pick: z.enum(["earliest", "latest"]).optional(),
  /** Validator pin only: the minute the facts must give it (HH:MM). */
  expectTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});
export type OrderLandmark = z.infer<typeof OrderLandmarkSchema>;

/** Extra words for the order check, added to the defaults (e.g. ship verbs: "went below", "turned in"). */
export const OrderWordsSchema = z.strictObject({
  /** A clause claiming someone's absence or movement. */
  absence: z.array(SafePattern).max(20).optional(),
  /** A knowledge statement describing someone's comings and goings. */
  movement: z.array(SafePattern).max(20).optional(),
});
export type OrderWords = z.infer<typeof OrderWordsSchema>;

// ---------------------------------------------------------------------------
// Audio (E9)
// ---------------------------------------------------------------------------

/** Screens that carry a bed (components/effects/audio-scenes.ts). */
export const BED_SCREENS = ["title", "intro", "suspects", "investigate", "interrogation", "confront", "accuse", "ending"] as const;
/** A file stem in assets/audio/ (both .mp3 and .ogg must exist; validator). */
const AudioStem = z.string().regex(/^[a-z0-9_]{1,60}$/, "a file stem in assets/audio/ (lower-case, digits, _)");

export const CaseAudioSchema = z.strictObject({
  /** Bed per screen; unnamed screens keep the default bed. */
  beds: z.partialRecord(z.enum(BED_SCREENS), AudioStem).optional(),
  /** Replace the files of an existing cue (the validator checks the cue name). */
  cues: z.record(z.string().regex(/^[a-z_]+$/), z.array(AudioStem).min(1).max(4)).optional(),
});
export type CaseAudio = z.infer<typeof CaseAudioSchema>;
