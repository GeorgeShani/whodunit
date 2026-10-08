/**
 * Per-character `voice` pools (issue #52: openers, actions, deflections the anti-repetition rotation draws on) in
 * cases/blackwood/characters/*.json. Read straight from JSON so the test does not depend on the schema accepting the
 * field yet; the guilt profile is built from a copy of the case with `voice` stripped.
 *
 * Every string must be safe to emit in ANY state, so it is checked against the strictest one: a fresh game (every
 * forbiddenPhrases entry live), the guilt check on the dialogue and on the action field, and a bare-yes reading after
 * a spelled-out accusation.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findForbiddenPhrase } from "@/ai/forbidden-phrases";
import { findReplyGuiltLeak, speakerNamesOf } from "@/ai/guilt-check";
import { findForeignLanguage } from "@/ai/language-check";
import { extractTimes } from "@/ai/canon-check";
import { loadCase } from "@/engine/case-loader";
import { guiltProfile, type GuiltProfile } from "@/engine/core-guilt";
import type { ForbiddenPhrase } from "@/engine/types";

interface Voice { openers: string[]; actions: string[]; deflections: string[] }
interface Char { id: string; name: string; aliases: string[]; voice: Voice; forbiddenPhrases: ForbiddenPhrase[]; personality: { tells: string[] } }
const DIR = join(process.cwd(), "cases/blackwood");
const IDS = ["victoria", "archibald", "reginald", "gregory"] as const;
type Who = (typeof IDS)[number];
const chars = Object.fromEntries(IDS.map((id) => [id, JSON.parse(readFileSync(join(DIR, "characters", `${id}.json`), "utf8")) as Char])) as Record<Who, Char>;
const caseJson = JSON.parse(readFileSync(join(DIR, "case.json"), "utf8")) as { victim: { name: string; aliases?: string[] }; locations: { id: string; name: string }[] };
const POOLS = ["openers", "actions", "deflections"] as const;
const all = (who: Who) => POOLS.flatMap((k) => chars[who].voice[k].map((t) => [k, t] as const));

const wordRe = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}_])`, "iu");
/** Names and aliases of everyone but `who` (other suspects and the victim), plus their surnames and first names. */
function otherNames(who: Who): string[] {
  const out = new Set<string>();
  const add = (n: string) => { out.add(n); for (const p of n.split(/\s+/)) if (/^[A-Z]/.test(p) && !["Lady", "Lord", "Mr", "Mrs", "The"].includes(p)) out.add(p); };
  for (const o of IDS.filter((x) => x !== who)) [chars[o].name, ...chars[o].aliases].forEach(add);
  [caseJson.victim.name, ...(caseJson.victim.aliases ?? [])].forEach(add);
  return [...out];
}
/** Place words: the case's locations ("The Dining Room" -> "dining room", "Kitchen & Servants' Quarters" -> "kitchen", "servants' quarters"). */
const PLACES: Record<string, string[]> = Object.fromEntries(
  caseJson.locations.map((l) => [l.id, l.name.replace(/^The\s+/i, "").split(/\s*&\s*/).map((x) => x.toLowerCase())]),
);
/** The places each character's own public cover story puts them in (the only ones a deflection may name). */
const COVER_PLACES: Record<Who, string[]> = { victoria: ["dining-room"], archibald: ["dining-room"], reginald: ["kitchen"], gregory: ["garden"] };
const RETIRED = /my\s+dear\s+detective|w-+well,?\s+sir|darling|dwell\s+on\s+unpleasantness|if\s+I\s+may\s+be\s+so\s+bold|now\s+see\s+here/i;
const MODERN = /\b(emojis?|computers?|internet|online|e-?mails?|apps?|smartphones?|website|chatbots?|prompts?|debug\w*|developers?|JSON|okay|OK)\b/;
const ACCUSATION = "You went into the library during the blackout and struck him with the candlestick, didn't you?";

let profile: GuiltProfile;
beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), "voice-"));
  cpSync(DIR, join(tmp, "blackwood"), { recursive: true });
  for (const f of readdirSync(join(tmp, "blackwood/characters"))) {
    const p = join(tmp, "blackwood/characters", f);
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    delete raw.voice;
    writeFileSync(p, JSON.stringify(raw));
  }
  profile = guiltProfile((await loadCase("blackwood", tmp)) as never);
});

describe("blackwood voice pools (#52): shape", () => {
  it("every character has 6-8 openers, actions and deflections, all non-empty", () => {
    for (const who of IDS) for (const k of POOLS) {
      const pool = chars[who].voice?.[k];
      expect(pool, `${who}.${k}`).toBeDefined();
      expect(pool.length, `${who}.${k}`).toBeGreaterThanOrEqual(6);
      expect(pool.length, `${who}.${k}`).toBeLessThanOrEqual(8);
      for (const t of pool) expect(t.trim().length, `${who}.${k}`).toBeGreaterThan(1);
    }
  });

  it("no duplicates within a character, across all three pools", () => {
    for (const who of IDS) {
      const norm = all(who).map(([, t]) => t.toLowerCase().replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ").trim());
      expect(new Set(norm).size, who).toBe(norm.length);
    }
  });

  it("no near-duplicate openers within a character: distinct first words and little word overlap", () => {
    const words = (t: string) => t.toLowerCase().replace(/[^\p{L}'\s]/gu, " ").split(/\s+/).filter(Boolean);
    for (const who of IDS) {
      const o = chars[who].voice.openers;
      const firsts = o.map((t) => words(t)[0]);
      expect(new Set(firsts).size, `${who} first words: ${firsts.join(", ")}`).toBe(o.length);
      for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) {
        const a = new Set(words(o[i])), b = new Set(words(o[j]));
        const inter = [...a].filter((w) => b.has(w)).length;
        expect(inter / Math.min(a.size, b.size), `${who}: "${o[i]}" ~ "${o[j]}"`).toBeLessThan(0.5);
      }
    }
  });

  it("openers vary in shape: not all addresses, at most two name the detective", () => {
    for (const who of IDS) {
      const o = chars[who].voice.openers;
      expect(o.filter((t) => /\b(detective|inspector)\b/i.test(t)).length, who).toBeLessThanOrEqual(2);
      expect(o.filter((t) => /\b(sir|madam|m['’]lady)\b/i.test(t)).length, who).toBeLessThanOrEqual(4);
      expect(new Set(o.map((t) => t.trim().slice(-1))).size, `${who} endings`).toBeGreaterThanOrEqual(3);
    }
  });

  it("none of the retired catchphrases come back", () => {
    for (const who of IDS) for (const [k, t] of all(who)) expect(t, `${who}.${k}`).not.toMatch(RETIRED);
  });

  it("period English: no modern words, no foreign-language lines", () => {
    for (const who of IDS) for (const [k, t] of all(who)) {
      expect(t, `${who}.${k}`).not.toMatch(MODERN);
      expect(findForeignLanguage(t), `${who}.${k}: ${t}`).toBeNull();
    }
  });

  it("Reginald never uses a contraction in his openers and deflections (his speech style)", () => {
    for (const t of [...chars.reginald.voice.openers, ...chars.reginald.voice.deflections]) expect(t, t).not.toMatch(/\b\w+['’](?:t|s|re|ve|ll|d|m)\b/i);
  });
});

describe("blackwood voice pools (#52): safety", () => {
  it("every string passes the speaker's forbiddenPhrases on a fresh game (every entry live)", () => {
    for (const who of IDS) for (const [k, t] of all(who)) {
      const hit = findForbiddenPhrase(t, chars[who].forbiddenPhrases, []);
      expect(hit, `${who}.${k}: "${t}" hit ${hit?.phrase.text}`).toBeNull();
    }
  });

  it("every string passes the guilt check: as dialogue, as the action field, and as a reply to a spelled-out accusation", () => {
    for (const who of IDS) {
      const opts = { speakerNames: speakerNamesOf({ characters: IDS.map((id) => chars[id]) }, who) };
      for (const [k, t] of all(who)) {
        const reply = k === "actions" ? { dialogue: "", action: t } : { dialogue: t };
        expect(findReplyGuiltLeak(reply, ACCUSATION, profile, who, opts), `${who}.${k}: ${t}`).toBeNull();
        expect(findReplyGuiltLeak({ dialogue: t, action: t }, "", profile, who, opts), `${who}.${k}: ${t}`).toBeNull();
      }
    }
  });

  it("deflections carry no digits, no clock times, no other suspect's or the victim's names or aliases", () => {
    for (const who of IDS) for (const t of chars[who].voice.deflections) {
      expect(t, `${who}: ${t}`).not.toMatch(/\d/);
      expect(extractTimes(t), `${who}: ${t}`).toEqual([]);
      for (const n of otherNames(who)) expect(wordRe(n).test(t), `${who}: "${t}" names ${n}`).toBe(false);
    }
  });

  it("deflections name no place except those in the speaker's own cover story", () => {
    for (const who of IDS) for (const t of chars[who].voice.deflections)
      for (const [id, words] of Object.entries(PLACES)) if (!COVER_PLACES[who].includes(id)) for (const w of words) expect(wordRe(w).test(t), `${who}: "${t}" names ${w}`).toBe(false);
  });

  it("deflections are full standalone sentences (capitalised, end in . ! or ?)", () => {
    for (const who of IDS) for (const t of chars[who].voice.deflections) expect(t, `${who}: ${t}`).toMatch(/^[A-Z"'][\s\S]*[.!?]["']?$/);
  });

  it("actions stay off the case: no names, no places, no clue or weapon words, and nobody glances at anybody", () => {
    const CLUES = /\b(candlestick|candle|key|lock\w*|letter|will|desk|scuttle|coal|fire(?:place|side)?|mantel\w*|mud\w*|footprint|blood\w*|door|window|money|coins?|pantry|telephone|phone|shed)\b/i;
    for (const who of IDS) for (const t of chars[who].voice.actions) {
      expect(t, `${who}: ${t}`).not.toMatch(CLUES);
      expect(t, `${who}: ${t}`).not.toMatch(/\bglanc\w*/i);
      expect(t, `${who}: ${t}`).not.toMatch(/\b(?:looks?|peers?|stares?|peeks?)\s+(?:at|towards?)\s+(?:him|her(?!\s+own)|them|everyone|somebody|someone|lady|lord|the\s+(?:lady|butler|gardener|guests?))\b/i);
      for (const n of otherNames(who)) expect(wordRe(n).test(t), `${who}: "${t}" names ${n}`).toBe(false);
      for (const words of Object.values(PLACES)) for (const w of words) expect(wordRe(w).test(t), `${who}: "${t}" names ${w}`).toBe(false);
    }
  });

  it("Victoria's actions never use the handkerchief (a core-guilt object) or the accepted library/fireplace tells", () => {
    for (const t of chars.victoria.voice.actions) expect(t, t).not.toMatch(/handkerchief|library|fireplace|\brings?\b/i);
  });

  it("Gregory never looks at Victoria or the hall door in his actions", () => {
    for (const t of chars.gregory.voice.actions) expect(t, t).not.toMatch(/ladyship|victoria|m['’]lady|hall|door/i);
  });
});
