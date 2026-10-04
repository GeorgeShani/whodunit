/**
 * Clue art: ONE resolver for every screen that shows a piece of evidence (notebook cards, the "clue found" overlay,
 * the accusation pickers, the end-screen cited list). Client-safe: no fs access here.
 *
 * Priority (never guesses from the clue's `kind`):
 *  1. an illustration that exists under assets/evidence/: `<caseId>/<id>.webp`, then `<id>.webp`, then the legacy
 *     `image` key (`<image>.webp`). Toon drops files in; nothing else changes.
 *  2. the item's own `icon` emoji (cases/<case>/evidence.json).
 *  3. the shared neutral picture assets/evidence/_fallback.webp (magnifier over a "?" tag) when it exists, else the
 *     generic CLUE_FALLBACK_ICON emoji.
 *
 * Which files exist is decided at BUILD/START time: next.config.ts lists assets/evidence/ into
 * NEXT_PUBLIC_CLUE_ART (relative paths without extension, comma separated), so a missing file is never requested.
 * <ClueArt> still falls back to the icon on <img onError>.
 */
import type { PublicEvidence } from "@/engine/public-view";

/** Neutral stand-in when a clue has neither an illustration nor an authored icon. */
export const CLUE_FALLBACK_ICON = "🔍";
/** Public URL folder (assets/ is copied to public/assets/ by sync:assets). */
/** The shared neutral picture (not matched by the id regex, so no clue can claim it). */
export const CLUE_FALLBACK_FILE = "_fallback";
export const CLUE_ART_DIR = "/assets/evidence";

export type ClueArtEvidence = Pick<PublicEvidence, "id"> & { image?: string | undefined; icon?: string | undefined };

export type ClueArt = { kind: "image"; src: string } | { kind: "icon"; icon: string };

const KEY = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const CASE_KEY = /^_?[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** The set of available illustrations, as inlined by next.config.ts (empty when unset, e.g. in unit tests). */
export function availableClueArt(raw: string | undefined = process.env.NEXT_PUBLIC_CLUE_ART): ReadonlySet<string> {
  return new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

/** A usable icon: 1–8 chars, no plain ASCII letters (so a stray word is never rendered as an "icon"). */
export function validClueIcon(icon: unknown): icon is string {
  return typeof icon === "string" && icon.trim().length > 0 && icon.length <= 8 && !/[A-Za-z]/.test(icon);
}

/** The icon for a clue: its own, else the neutral fallback. Used on its own when an image fails to load. */
export function clueIcon(evidence: Pick<ClueArtEvidence, "icon">): string {
  return validClueIcon(evidence.icon) ? evidence.icon.trim() : CLUE_FALLBACK_ICON;
}

export function resolveClueArt(caseId: string, evidence: ClueArtEvidence, available: ReadonlySet<string> = availableClueArt()): ClueArt {
  const candidates: string[] = [];
  if (KEY.test(evidence.id)) {
    if (CASE_KEY.test(caseId)) candidates.push(`${caseId}/${evidence.id}`);
    candidates.push(evidence.id);
  }
  if (evidence.image && KEY.test(evidence.image)) {
    if (CASE_KEY.test(caseId)) candidates.push(`${caseId}/${evidence.image}`);
    candidates.push(evidence.image);
  }
  const hit = candidates.find((c) => available.has(c));
  if (hit) return { kind: "image", src: `${CLUE_ART_DIR}/${hit}.webp` };
  if (validClueIcon(evidence.icon)) return { kind: "icon", icon: evidence.icon.trim() };
  if (available.has(CLUE_FALLBACK_FILE)) return { kind: "image", src: `${CLUE_ART_DIR}/${CLUE_FALLBACK_FILE}.webp` };
  return { kind: "icon", icon: CLUE_FALLBACK_ICON };
}
