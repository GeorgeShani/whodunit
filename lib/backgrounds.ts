/**
 * SERVER-ONLY (build time). Which locations have background art on disk.
 * Convention (Toon): assets/backgrounds/<locationId>.webp, served at /assets/backgrounds/...
 */
import { existsSync } from "node:fs";
import path from "node:path";

export function locationBackgrounds(locationIds: readonly string[], root = process.cwd()): Record<string, string> {
  return Object.fromEntries(
    locationIds
      .filter((id) => existsSync(path.join(root, "assets", "backgrounds", `${id}.webp`)))
      .map((id) => [id, `/assets/backgrounds/${id}.webp`]),
  );
}
