/**
 * SERVER-ONLY (build/render time). Resolve a case's public art with fallbacks,
 * so screens read art from case data instead of hard-coded ids.
 *
 * Location background: location.background -> assets/backgrounds/<locationId>.webp
 * if that file exists -> none (the card shows an icon).
 * Screen backdrops: case.backdrops.<screen> -> ART_DEFAULTS[caseId] -> none
 * (each screen keeps its built-in look).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { CaseBackdrops } from "@/engine/case-schema";
import type { PublicCaseView } from "@/engine/public-view";

/**
 * Stopgap art for cases whose authored data doesn't name a backdrop yet.
 * Case data always wins; remove an entry once the case file sets the field.
 */
export const ART_DEFAULTS: Record<string, CaseBackdrops> = {
  // ART_BIBLE §7.2: manor entrance hall for suspect selection (until case.json sets backdrops.suspects).
  blackwood: { suspects: "/assets/backgrounds/manor.webp" },
};

/** Does /assets/<...> exist in assets/ (the source that sync:assets copies to public/)? */
export function assetExists(assetPath: string, root = process.cwd()): boolean {
  if (!assetPath.startsWith("/assets/") || assetPath.includes("..")) return false;
  return existsSync(path.join(root, ...assetPath.split("/").filter(Boolean)));
}

export function resolveCaseArt(view: PublicCaseView, root = process.cwd()): PublicCaseView {
  const defaults = ART_DEFAULTS[view.meta.id] ?? {};
  const backdrops: CaseBackdrops = { ...defaults, ...view.backdrops };
  return {
    ...view,
    backdrops: Object.fromEntries(Object.entries(backdrops).filter(([, p]) => p && assetExists(p, root))) as CaseBackdrops,
    locations: view.locations.map((l) => {
      const conventional = `/assets/backgrounds/${l.id}.webp`;
      const bg = l.background && assetExists(l.background, root) ? l.background : assetExists(conventional, root) ? conventional : undefined;
      const { background: _drop, ...rest } = l;
      void _drop;
      return bg ? { ...rest, background: bg } : rest;
    }),
  };
}
