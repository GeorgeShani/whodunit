/**
 * SERVER-ONLY. Which stems a case ships in assets/cases/<caseId>/audio/ (Q14), read once per process (build time for
 * the static case pages). A stem counts only when both .ogg and .mp3 exist; a missing folder is []. The client
 * resolves each stem case folder first, then assets/audio/ (components/effects/audio.ts audioUrl).
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const KEY = /^_?[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const STEM = /^[a-z0-9_]{1,60}$/;
const cache = new Map<string, string[]>();

export function caseAudioFiles(caseId: string, root = process.cwd()): string[] {
  const key = `${root}\0${caseId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dir = path.join(root, "assets", "cases", caseId, "audio");
  let out: string[] = [];
  if (KEY.test(caseId) && existsSync(dir)) {
    const names = new Set(readdirSync(dir));
    out = [...names]
      .filter((f) => f.endsWith(".ogg"))
      .map((f) => f.slice(0, -4))
      .filter((s) => STEM.test(s) && names.has(`${s}.mp3`))
      .sort();
  }
  cache.set(key, out);
  return out;
}
