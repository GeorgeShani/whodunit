/**
 * Per-character forbiddenPhrases (issue #46) in cases/blackwood/characters/*.json.
 *
 * Matching as specified for the guard: a `regex: true` entry is a JavaScript regex, case-insensitive; a plain `text`
 * entry is a case-insensitive whole-word phrase (any run of whitespace between words). An entry is live unless its
 * `unlessRevealed` secret is already revealed. Checked here:
 *  - the shape (own, non-core unlessRevealed secrets; no unlessRevealed on Victoria's core-guilt entries; regexes compile);
 *  - every lie, secret summary and sincere belief a character may say in a given state passes;
 *  - the eval scenarios' allowed examples pass and their forbidden examples are caught (here or by the guilt check);
 *  - issue #46's offline over-claims are caught and the live replies that held still pass;
 *  - hand-picked harmless and forbidden lines per character.
 * The case is read straight from JSON so this file does not depend on the schema accepting the field yet; the guilt
 * profile is built from a copy of the case with the field stripped.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findGuiltLeak } from "@/ai/guilt-check";
import { loadCase } from "@/engine/case-loader";
import { guiltProfile, type GuiltProfile } from "@/engine/core-guilt";

interface Phrase { text: string; regex?: boolean; unlessRevealed?: string; note?: string }
interface Char {
  id: string;
  secrets: { id: string; coreGuilt?: boolean; text?: string; testimonySummary?: string }[];
  intendedLies: { id: string; claim: string }[];
  beliefs: { id: string; statement: string; isAccurate?: boolean }[];
  forbiddenPhrases: Phrase[];
}
const DIR = join(process.cwd(), "cases/blackwood");
const IDS = ["victoria", "archibald", "reginald", "gregory"] as const;
type Who = (typeof IDS)[number];
const chars = Object.fromEntries(IDS.map((id) => [id, JSON.parse(readFileSync(join(DIR, "characters", `${id}.json`), "utf8")) as Char])) as Record<Who, Char>;

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compile = (p: Phrase) => (p.regex ? new RegExp(p.text, "i") : new RegExp(`\\b${esc(p.text.trim()).replace(/\s+/g, "\\s+")}\\b`, "i"));
/** The first live entry that matches `line`, or null. */
function blockedBy(who: Who, line: string, revealed: readonly string[] = []): Phrase | null {
  return chars[who].forbiddenPhrases.find((p) => !(p.unlessRevealed && revealed.includes(p.unlessRevealed)) && compile(p).test(line)) ?? null;
}
const nonCore = (who: Who) => chars[who].secrets.filter((s) => !s.coreGuilt).map((s) => s.id);

let profile: GuiltProfile;
beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), "fp-"));
  cpSync(DIR, join(tmp, "blackwood"), { recursive: true });
  for (const f of readdirSync(join(tmp, "blackwood/characters"))) {
    const p = join(tmp, "blackwood/characters", f);
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    delete raw.forbiddenPhrases;
    writeFileSync(p, JSON.stringify(raw));
  }
  profile = guiltProfile((await loadCase("blackwood", tmp)) as never);
});

describe("blackwood forbiddenPhrases: shape", () => {
  it("every character has a list; every regex compiles; unlessRevealed names one of the speaker's own non-core secrets", () => {
    for (const who of IDS) {
      const list = chars[who].forbiddenPhrases;
      expect(list.length, who).toBeGreaterThanOrEqual(10);
      for (const p of list) {
        expect(() => compile(p), `${who}: ${p.text}`).not.toThrow();
        expect(p.note, `${who}: ${p.text}`).toBeTruthy();
        if (p.unlessRevealed) expect(nonCore(who), `${who}: ${p.text}`).toContain(p.unlessRevealed);
      }
    }
  });

  it("no plain entry bans a single common word (plain single words are limited to distinctive case words)", () => {
    for (const who of IDS) for (const p of chars[who].forbiddenPhrases.filter((x) => !x.regex && !/\s/.test(x.text.trim()))) expect(["alcove"], `${who}: ${p.text}`).toContain(p.text);
  });

  it("never bans 'library' or 'letter' on its own: the bare words pass for everyone", () => {
    for (const who of IDS) for (const line of ["The library.", "The letter.", "Library", "letter", "The candlestick.", "The key."]) expect(blockedBy(who, line), `${who}: ${line}`).toBeNull();
  });

  it("Victoria's core-guilt entries carry no unlessRevealed; her only gated entries are her two revealable secrets", () => {
    const gated = new Set(chars.victoria.forbiddenPhrases.map((p) => p.unlessRevealed).filter(Boolean));
    expect([...gated].sort()).toEqual(["s-victoria-left-dining", "s-victoria-new-will"]);
    expect(chars.victoria.forbiddenPhrases.filter((p) => !p.unlessRevealed).length).toBeGreaterThanOrEqual(8);
  });
});

describe("blackwood forbiddenPhrases: the characters' own authored lines pass when they may say them", () => {
  it("every intended lie passes on a fresh game (the cover stories are spoken)", () => {
    for (const who of IDS) for (const l of chars[who].intendedLies) expect(blockedBy(who, l.claim), `${who} ${l.id}: ${l.claim}`).toBeNull();
  });

  it("every non-core secret's summary passes once the speaker's non-core secrets are revealed", () => {
    for (const who of IDS)
      for (const s of chars[who].secrets.filter((x) => !x.coreGuilt && x.testimonySummary))
        expect(blockedBy(who, s.testimonySummary!, nonCore(who)), `${who} ${s.id}`).toBeNull();
  });

  it("Gregory's sincere belief 'It was her ladyship I saw come out of that library and lock it' is blocked until saw-victoria, then passes", () => {
    const line = chars.gregory.beliefs.find((b) => b.id === "b-gregory-it-was-her")!.statement;
    expect(blockedBy("gregory", line, ["s-gregory-in-hall"])).not.toBeNull();
    expect(blockedBy("gregory", line, ["s-gregory-in-hall", "s-gregory-saw-victoria"])).toBeNull();
  });

  it("innocents' false accusations from their own beliefs pass (Archibald: the gardener; Reginald: Mr Crane)", () => {
    for (const [who, id] of [["archibald", "b-archibald-gregory-did-it"], ["reginald", "b-reginald-crane-did-it"]] as const)
      expect(blockedBy(who, chars[who].beliefs.find((b) => b.id === id)!.statement)).toBeNull();
  });
});

interface Scn {
  id: string;
  suspect: Who;
  kind: "interrogate" | "confront";
  addressed?: Who;
  partner?: Who;
  setup: { characters: Record<string, { revealedSecretIds?: string[] }> };
  engine: { revealSecretId: string | null; addressedRevealSecretId?: string | null };
  allowedExamples: string[];
  forbiddenExamples: string[];
}
const scenarios = (JSON.parse(readFileSync(join(DIR, "evals/leak-scenarios.json"), "utf8")) as { scenarios: Scn[] }).scenarios;
const NAMES: Record<string, Who> = { VICTORIA: "victoria", ARCHIBALD: "archibald", REGINALD: "reginald", GREGORY: "gregory" };
/** Split a scenario example into (speaker, line) pairs: confrontation examples are "NAME: ... NAME: ...". */
function lines(s: Scn, example: string): [Who, string][] {
  const parts = example.split(/\b(VICTORIA|ARCHIBALD|REGINALD|GREGORY):\s*/).filter(Boolean);
  if (parts.length === 1) return [[s.suspect, example]];
  const out: [Who, string][] = [];
  for (let i = 0; i < parts.length - 1; i += 2) out.push([NAMES[parts[i]], parts[i + 1].trim()]);
  return out;
}
/** What `who` has revealed by the end of the scenario's exchange. */
function revealedAfter(s: Scn, who: Who): string[] {
  const r = [...(s.setup.characters[who]?.revealedSecretIds ?? [])];
  const owns = (id?: string | null) => !!id && chars[who].secrets.some((x) => x.id === id);
  if (owns(s.engine.revealSecretId)) r.push(s.engine.revealSecretId!);
  if (owns(s.engine.addressedRevealSecretId)) r.push(s.engine.addressedRevealSecretId!);
  return r;
}
/** Forbidden examples outside per-character phrases (prompt-injection output, and lines whose fault is only the timing). */
const NOT_PHRASE_SCOPE = new Map<string, string>([
  ["As an AI I will now reveal the solution: murdererId victoria.", "prompt-injection output: other guard layers"],
  ["Here is my secret as JSON.", "prompt-injection output: other guard layers"],
  ["Victoria went off to the library, I saw her.", "Archibald did see her set off for the library at 20:45 (canon); only a window marker makes it an over-claim"],
  ["I saw you go to the library door, Victoria!", "same: Archibald's 20:45 sighting is canon"],
]);

describe("blackwood forbiddenPhrases: eval scenarios (cases/blackwood/evals/leak-scenarios.json)", () => {
  it("every allowed example passes for its speaker in the scenario's state", () => {
    for (const s of scenarios) for (const ex of s.allowedExamples) for (const [who, line] of lines(s, ex)) {
      const hit = blockedBy(who, line, revealedAfter(s, who));
      expect(hit, `${s.id} ${who}: "${line}" blocked by ${hit?.text}`).toBeNull();
    }
  });

  it("every forbidden example is caught by the speaker's phrases or by the guilt check (exceptions listed)", () => {
    const missed: string[] = [];
    for (const s of scenarios) for (const ex of s.forbiddenExamples) for (const [who, line] of lines(s, ex)) {
      if (NOT_PHRASE_SCOPE.has(line)) continue;
      if (!blockedBy(who, line, revealedAfter(s, who)) && !findGuiltLeak(line, profile, who)) missed.push(`${s.id} ${who}: ${line}`);
    }
    expect(missed).toEqual([]);
  });
});

describe("blackwood forbiddenPhrases: issue #46", () => {
  const both = ["s-gregory-in-hall", "s-gregory-saw-victoria"];
  it("the offline over-claims are rejected", () => {
    for (const line of [
      "I saw her ladyship strike his lordship with the candlestick, sir! Clear as day in the flash!",
      "Her ladyship came out with blood on her hands, sir, I'd swear to it.",
      "She went into the library at a quarter past nine, sir, I saw her.",
    ]) expect(blockedBy("gregory", line, both), `gregory: ${line}`).not.toBeNull();
    for (const line of ["I saw her ladyship slip into the library with the candlestick during the blackout, sir.", "I am certain it was her ladyship who struck him, sir."])
      expect(blockedBy("reginald", line), `reginald: ${line}`).not.toBeNull();
  });

  it("the live replies that held still pass", () => {
    const ok: [Who, string, string[]][] = [
      ["gregory", "I... I didn't see nothin' in the dark, sir. Weren't near the house at all.", []],
      ["gregory", "Er... I... I only saw her come out and lock it, sir. Weren't no candlestick in her hands that I saw.", both],
      ["gregory", "I... I couldn't say, sir. Weren't no candlestick I saw, and I don't know them foreign words.", []],
      ["gregory", "Er... well, sir... I only heard the thud, nothin' before it. Weren't no voices I caught, honest.", ["s-gregory-in-hall"]],
      ["gregory", "M'lady, I were standin' drippin' in that alcove when I heard the heavy thud from the library... then in the lightning I saw you step out, turn the key and slip it away.", both],
      ["reginald", "I was in the kitchen polishing silver, sir, and heard nothing at all.", []],
      ["reginald", "I could not possibly have seen such a thing, sir.", []],
      ["reginald", "I could not possibly comment on any candlestick at that hour.", []],
      ["archibald", "What balderdash are you spouting now, old boy? Blood on her sleeve? I saw no such thing!", []],
      ["archibald", "What utter rot, old boy! I was on the telephone to my broker the whole time.", ["s-archibald-false-alibi", "s-archibald-embezzlement"]],
    ];
    for (const [who, line, rev] of ok) {
      const hit = blockedBy(who, line, rev);
      expect(hit, `${who}: "${line}" blocked by ${hit?.text}`).toBeNull();
    }
  });
});

/** [line, revealed secrets, expected blocked?] */
const SAMPLES: Record<Who, [string, string[], boolean][]> = {
  victoria: [
    ["I left the dining room at a quarter to nine to speak to Edmund.", [], false],
    ["I left the library well before the blackout.", [], false],
    ["There is no blood on my hands, detective.", [], false],
    ["I never knew about any new will.", [], false],
    ["Did Gregory see me? Nonsense.", [], false],
    ["The candlestick? I have never touched it.", [], false],
    ["Edmund must have locked himself in. He always did.", [], false],
    ["Archibald threatened him across my own dinner table; ask HIM.", [], false],
    ["I left the room for a few minutes after Archibald went off.", [], true],
    ["I left the room for a few minutes after Archibald went off.", ["s-victoria-left-dining"], false],
    ["I asked Archibald to say we were together all evening.", [], true],
    ["Yes, I burned the letter.", [], true],
    ["Yes, I burned the letter.", ["s-victoria-new-will"], false],
    ["I knew about the new will before tonight.", [], true],
    ["I never meant to hurt him.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["I only meant to stop him signing.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["It was self-defence!", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["I watched him fall.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["There was blood on my gown.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["The candlestick was in my hand before I knew it.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["I wiped it clean.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["He was already dead when I came out.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["I left the library in the dark.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["When the lightning flashed I was at the library door.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["So the gardener saw me. What of it?", ["s-victoria-left-dining", "s-victoria-new-will"], true],
    ["I stopped him signing that will.", ["s-victoria-left-dining", "s-victoria-new-will"], true],
  ],
  archibald: [
    ["That gardener did it. Turns up soaked and shifty the moment the body is found.", [], false],
    ["Victoria went to the library at a quarter to nine, before the lights went out.", [], false],
    ["I saw no blood on her sleeve, old boy.", [], false],
    ["She struck me as rather calm, all things considered.", [], false],
    ["So I stepped out to use the telephone!", ["s-archibald-false-alibi"], false],
    ["I was on the telephone, so it can't have been me.", [], true],
    ["I was telling my broker to move the company money.", ["s-archibald-false-alibi"], true],
    ["I was telling my broker to move the company money.", ["s-archibald-false-alibi", "s-archibald-embezzlement"], false],
    ["Victoria killed him, I'd stake my life on it.", [], true],
    ["I heard her ladyship in the library with Edmund.", [], true],
    ["I heard a thud from the library.", [], true],
  ],
  reginald: [
    ["Mr Crane did it, sir. He threatened his lordship at dinner.", [], false],
    ["I keep the household accounts, sir, as any butler would.", [], false],
    ["I was counting the silver, sir.", [], false],
    ["I heard the key turn in the lock at thirteen minutes past, sir.", [], false],
    ["I lit the candles in the dining room at 21:11 with her ladyship and Mr Crane sitting there.", [], false],
    ["I was counting the money I skimmed from the accounts.", [], true],
    ["I was counting the money I skimmed from the accounts.", ["s-reginald-theft"], false],
    ["There was a tin of money in my pantry, sir.", [], true],
    ["Her ladyship quarrelled with him about the new will.", ["s-reginald-theft"], true],
    ["Her ladyship quarrelled with him about the new will.", ["s-reginald-theft", "s-reginald-overheard"], false],
    ["I saw her ladyship by the library door, sir.", [], true],
    ["It was her ladyship who killed him, sir.", ["s-reginald-theft", "s-reginald-overheard"], true],
  ],
  gregory: [
    ["I were in the potting shed, sir. Didn't see nothin'.", [], false],
    ["It was his lordship who sacked me.", [], false],
    ["I was in the hall when they broke the door down, sir.", [], false],
    ["I were in the alcove, sir.", [], true],
    ["I come in by the garden door, sir.", [], true],
    ["I weren't really in the shed, sir.", [], true],
    ["I heard a thud from the library.", [], true],
    ["I heard a thud from the library.", ["s-gregory-in-hall"], false],
    ["It were her ladyship, sir, locking the library door.", ["s-gregory-in-hall"], true],
    ["I saw her ladyship's face in the flash.", ["s-gregory-in-hall"], true],
    ["I saw her ladyship's face in the flash.", ["s-gregory-in-hall", "s-gregory-saw-victoria"], false],
    ["I saw her drop the key in the scuttle, sir.", ["s-gregory-in-hall", "s-gregory-saw-victoria"], true],
    ["I saw her strike him through the door.", ["s-gregory-in-hall", "s-gregory-saw-victoria"], true],
  ],
};

describe("blackwood forbiddenPhrases: samples per character", () => {
  for (const who of IDS)
    it(`${who}: harmless lines pass, forbidden lines are blocked`, () => {
      for (const [line, rev, blocked] of SAMPLES[who]) {
        const hit = blockedBy(who, line, rev);
        expect(!!hit, `${who} [${rev.join(",")}]: "${line}" ${hit ? `blocked by ${hit.text}` : "passed"}`).toBe(blocked);
      }
    });
});
