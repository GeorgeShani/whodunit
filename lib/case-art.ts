/**
 * SERVER-ONLY (build/render time). Resolve a case's public art with fallbacks,
 * so screens read art from case data instead of hard-coded ids.
 *
 * Location background: location.background -> assets/backgrounds/<locationId>.webp
 * if that file exists -> none (the card shows an icon).
 * Screen backdrops: case.backdrops.<screen> -> DEFAULT_BACKDROPS (shared art, no case id) -> none
 * (each screen keeps its built-in look).
 * Interrogation stage (ART_BIBLE §7): backdrops.interrogation -> the background
 * of the room where the victim was found -> none; plus the conventional
 * `<room>_lightning.webp`, `<room>_window_mask.webp` and the rain tile when they exist.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { CaseBackdrops } from "@/engine/case-schema";
import type { PublicCaseView, StageArt } from "@/engine/public-view";

/**
 * Shared default backdrops for a case that names none (phase 3: was a per-case-id table). ART_BIBLE §7.2: the manor
 * entrance hall behind suspect selection. Case data always wins (`backdrops.suspects`).
 */
export const DEFAULT_BACKDROPS: CaseBackdrops = { suspects: "/assets/backgrounds/manor.webp" };

/** Does /assets/<...> exist in assets/ (the source that sync:assets copies to public/)? */
export function assetExists(assetPath: string, root = process.cwd()): boolean {
  if (!assetPath.startsWith("/assets/") || assetPath.includes("..")) return false;
  return existsSync(path.join(root, ...assetPath.split("/").filter(Boolean)));
}

export const RAIN_TILE = "/assets/effects/rain_tile.webp";

/** Stage art for a room background, with its conventional lightning frame and window mask. */
export function resolveStageArt(background: string | undefined, root = process.cwd()): StageArt | undefined {
  if (!background || !assetExists(background, root)) return undefined;
  const variant = (suffix: string) => {
    const p = background.replace(/\.webp$/, `${suffix}.webp`);
    return p !== background && assetExists(p, root) ? p : undefined;
  };
  const lightning = variant("_lightning");
  const windowMask = variant("_window_mask");
  const rainTile = windowMask && assetExists(RAIN_TILE, root) ? RAIN_TILE : undefined;
  return {
    background,
    ...(lightning ? { lightning } : {}),
    ...(windowMask ? { windowMask } : {}),
    ...(rainTile ? { rainTile } : {}),
  };
}

export function resolveCaseArt(view: PublicCaseView, root = process.cwd()): PublicCaseView {
  const merged: CaseBackdrops = { ...DEFAULT_BACKDROPS, ...view.backdrops };
  const backdrops = Object.fromEntries(Object.entries(merged).filter(([, p]) => p && assetExists(p, root))) as CaseBackdrops;
  const locations = view.locations.map((l) => {
    const conventional = `/assets/backgrounds/${l.id}.webp`;
    const bg = l.background && assetExists(l.background, root) ? l.background : assetExists(conventional, root) ? conventional : undefined;
    const { background: _drop, ...rest } = l;
    void _drop;
    return bg ? { ...rest, background: bg } : rest;
  });
  const scene = locations.find((l) => l.id === view.victim.foundAtLocationId);
  const crimeScene = scene && "background" in scene ? scene.background : undefined;
  const stage = resolveStageArt(backdrops.interrogation ?? crimeScene, root);
  // Theme art (logo, title art) that is missing falls back to the default look, like a missing backdrop.
  const theme = view.theme && {
    ...view.theme,
    ...(view.theme.logo && !assetExists(view.theme.logo, root) ? { logo: undefined } : {}),
    ...(view.theme.titleArt && !assetExists(view.theme.titleArt, root) ? { titleArt: undefined } : {}),
  };
  if (theme) for (const k of ["logo", "titleArt"] as const) if (theme[k] === undefined) delete theme[k];
  return { ...view, backdrops, ...(stage ? { stage } : {}), locations, ...(theme ? { theme } : {}) };
}
