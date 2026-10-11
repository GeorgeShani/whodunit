/** SERVER-ONLY. Reads docs/HOW_TO_PLAY.md (the single source of truth) and parses it once per process / build. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseManual, type Manual } from "./how-to-play";

export const HOW_TO_PLAY_PATH = path.join(process.cwd(), "docs", "HOW_TO_PLAY.md");

let cached: Manual | null = null;
export function getManual(): Manual {
  cached ??= parseManual(readFileSync(HOW_TO_PLAY_PATH, "utf8"));
  return cached;
}
