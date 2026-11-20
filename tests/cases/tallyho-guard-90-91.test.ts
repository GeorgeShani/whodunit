/**
 * Tallyho authored `guard` block and #90 forbiddenPhrases (issues #90 / #91).
 * Gremlin's r9 probe lines run through checkReply / checkOutputGuard with no model.
 *
 * #90: engine `aliveUntil` (until 22:14) plus an always-on phrase net.
 * #91: engine `gatedTopics` unlocked by heel-chart (found or shown). No phrase entry,
 * so the line is allowed once the chart is in the signed state.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findForbiddenPhrase } from "@/ai/forbidden-phrases";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences, checkCaseWarnings } from "@/engine/case-validation";
import { checkOutputGuard } from "@/engine/output-guard";
import type { ForbiddenPhrase } from "@/engine/types";
import { getPublicCaseView } from "@/engine/public-view";
import {
  MUST_PASS,
  SHOULD_BLOCK_ALIVE,
  SHOULD_BLOCK_ALIVE_PARAPHRASES,
  SHOULD_BLOCK_GATED,
  SHOULD_BLOCK_GATED_PARAPHRASES,
  SHOULD_PASS_FRAMED,
  SHOULD_PASS_LIST,
  SUSPECTS,
} from "../fixtures/output-guard/probe-guard";
import { r7Verdict } from "../helpers/r7-guard";

const HAS_SOLUTION = existsSync("cases/tallyho/solution.json");
const CHAR_DIR = join(process.cwd(), "cases/tallyho/characters");

const phrasesOf: Record<string, ForbiddenPhrase[]> = Object.fromEntries(
  SUSPECTS.map((id) => {
    const raw = JSON.parse(readFileSync(join(CHAR_DIR, `${id}.json`), "utf8")) as { forbiddenPhrases: ForbiddenPhrase[] };
    return [id, raw.forbiddenPhrases];
  }),
);

function phraseHit(who: string, line: string) {
  return findForbiddenPhrase(line, phrasesOf[who], { revealedIds: [], shownIds: [], brokenLieIds: [] });
}

/** Close #90 paraphrases beyond Dexter's fixture list. */
const EXTRA_ALIVE = [
  "I had a word with the Commodore after she rolled to port.",
  "I spoke to him after the list changed.",
  "After quarter past ten I saw the Commodore.",
  "I saw the Commodore at half ten.",
  "After she rolled to port I bumped into the Commodore.",
];

describe("Tallyho authored guard block (case.json)", () => {
  it("declares aliveUntil 22:14 and a heel-chart gated topic, with no lone 'heel' term", () => {
    const raw = JSON.parse(readFileSync("cases/tallyho/case.json", "utf8")) as {
      victim: { id: string };
      guard: {
        aliveUntil: { victimId: string; until: string; appearancePhrases: string[]; aliases: string[] };
        gatedTopics: { unlockedBy: string; terms: string[]; patterns?: string[] }[];
      };
    };
    expect(raw.guard.aliveUntil.victimId).toBe(raw.victim.id);
    expect(raw.guard.aliveUntil.until).toBe("22:14");
    expect(raw.guard.aliveUntil.aliases).toEqual(expect.arrayContaining(["the Commodore", "the Old Man", "Barnacle", "Uncle", "Owner"]));
    expect(raw.guard.aliveUntil.appearancePhrases).toEqual(expect.arrayContaining(["watch", "horn", "Voice-Horn", "sounded", "read"]));
    expect(raw.guard.gatedTopics).toHaveLength(1);
    expect(raw.guard.gatedTopics[0].unlockedBy).toBe("heel-chart");
    expect(raw.guard.gatedTopics[0].terms).toEqual(expect.arrayContaining(["heel recorder", "heel chart", "recorder reading"]));
    expect(raw.guard.gatedTopics[0].terms.some((t) => t.trim().toLowerCase() === "heel")).toBe(false);
  });
});

describe("Tallyho #90 forbiddenPhrases, no model", () => {
  it("every suspect has the #90 regex entry and no #91 or unlessShown stand-in", () => {
    for (const id of SUSPECTS) {
      const list = phrasesOf[id];
      const n90 = list.filter((p) => p.note?.startsWith("#90"));
      const n91 = list.filter((p) => p.note?.startsWith("#91"));
      expect(n90, id).toHaveLength(1);
      expect(n91, id).toHaveLength(0);
      expect(n90[0].regex).toBe(true);
      expect(n90[0].unlessShown).toBeUndefined();
      expect(n90[0].unlessRevealed).toBeUndefined();
    }
  });

  it("blocks Gremlin's 'alive after the lurch' samples and close paraphrases", () => {
    const lines = [
      "The Commodore was still alive after the lurch, I heard him myself.",
      "I saw him in the corridor after the lurch.",
      "I had a word with the Commodore after the lurch.",
      "He spoke to me after the lurch.",
      "The Commodore called out after the Great Lurch.",
      "The Commodore was alive when the ship listed to port.",
      "After the ship swung over he was still with us.",
      "After ten past ten he was still alive, I am sure of it.",
      "He was alive after twenty past ten.",
      "He was up and about after twenty past ten; I heard his voice.",
      ...EXTRA_ALIVE,
    ];
    for (const id of SUSPECTS) {
      for (const line of lines) {
        expect(phraseHit(id, line), `${id}: ${line}`).not.toBeNull();
        expect(phraseHit(id, line)!.phrase.note, `${id}: ${line}`).toMatch(/^#90/);
      }
    }
  });

  it("does not gag list talk, appearance-framed clocks, or believed / normal lines", () => {
    const pass = [...SHOULD_PASS_LIST, ...SHOULD_PASS_FRAMED, ...MUST_PASS, "The galley horn cheered at the shark, so the Commodore was alive long after ten. Wasn't he?", "A master does not leave his wheel."];
    for (const id of SUSPECTS) {
      for (const line of pass) {
        expect(phraseHit(id, line), `${id}: ${line}`).toBeNull();
      }
    }
  });
});

describe.skipIf(!HAS_SOLUTION)("Tallyho checkReply / checkOutputGuard (#90 / #91), no model", () => {
  let c: LoadedCase;
  beforeAll(async () => {
    c = await loadCase("tallyho");
  });

  it("the authored block validates with zero guard issues and stays off the public view", { timeout: 120_000 }, () => {
    expect(c.guard?.aliveUntil?.until).toBe("22:14");
    expect(c.guard?.gatedTopics?.[0]?.unlockedBy).toBe("heel-chart");
    expect(checkCaseReferences(c).filter((i) => (i.path ?? "").startsWith("guard"))).toEqual([]);
    expect(checkCaseWarnings(c)).toEqual([]);
    const view = getPublicCaseView(c, { discoveredEvidenceIds: c.evidence.map((e) => e.id) });
    expect(JSON.stringify(view)).not.toMatch(/"aliveUntil"|"gatedTopics"|"alivePhrases"/);
  });

  it("#90: Gremlin block lines and paraphrases are rejected for every suspect on a fresh state", () => {
    for (const id of SUSPECTS) {
      for (const line of [...SHOULD_BLOCK_ALIVE, ...SHOULD_BLOCK_ALIVE_PARAPHRASES, ...EXTRA_ALIVE]) {
        const v = r7Verdict(c, id, line);
        expect(v, `${id}: ${line}`).not.toBeNull();
        expect(["alive_after", "forbidden_phrase", "staged_time", "unknown_time"]).toContain(v!.reason);
      }
    }
  });

  it("#91: heel-recorder talk is gated_topic before heel-chart is found, and allowed after", () => {
    for (const id of SUSPECTS) {
      for (const line of [...SHOULD_BLOCK_GATED, ...SHOULD_BLOCK_GATED_PARAPHRASES]) {
        const before = r7Verdict(c, id, line);
        expect(before?.reason, `before ${id}: ${line}`).toBe("gated_topic");
        const after = r7Verdict(c, id, line, { ev: ["heel-chart"] });
        expect(after?.reason, `after ${id}: ${line}`).not.toBe("gated_topic");
        // The canonical recorder line must be fully allowed once the chart is found.
        // Some paraphrases may still trip an unrelated check (e.g. period word "tape").
        if (line === "The heel recorder shows she went from starboard to port at 22:14.") {
          expect(after, `after ${id}: ${line}`).toBeNull();
        }
      }
    }
  });

  it("ordinary list / lurch talk is allowed before and after heel-chart is found", () => {
    for (const ev of [undefined, ["heel-chart"] as string[]]) {
      for (const id of SUSPECTS) {
        for (const line of SHOULD_PASS_LIST.filter((l) => !/flipped at 22:14/.test(l))) {
          expect(r7Verdict(c, id, line, ev ? { ev } : {}), `${id} ev=${ev ?? "none"}: ${line}`).toBeNull();
        }
      }
    }
  });

  it("she heeled to starboard is not caught as a gated term (no lone 'heel')", () => {
    const line = "She heeled to starboard in the squall and flipped at 22:14.";
    expect(checkOutputGuard(line, c, {}, [])).toBeNull();
  });

  it("beliefs and appearance-framed lines pass the new checks; Bilge's watch belief is allowed", () => {
    for (const id of SUSPECTS) {
      for (const line of [...SHOULD_PASS_FRAMED, ...MUST_PASS]) {
        const found = [] as string[];
        expect(checkOutputGuard(line, c, { beliefs: c.characters.find((ch) => ch.id === id)?.beliefs }, found), `${id}: ${line}`).toBeNull();
      }
    }
    expect(r7Verdict(c, "bilge", "The Old Man's watch says 22:41, and a watch does not lie. That settles the hour.")).toBeNull();
    expect(r7Verdict(c, "boris", "The galley horn cheered at the shark, so the Commodore was alive long after ten. Wasn't he?")).toBeNull();
    expect(r7Verdict(c, "gherkina", "Barnabas was sulking behind his door, and the corridor horn simply carried his trumpet from wherever he was bellowing.")).toBeNull();
    // Same-sentence delivery of Percy's belief (the authored period form is already staged_time).
    expect(r7Verdict(c, "percy", "Uncle was alive at 22:38, I heard him cheer the shark myself, so whoever it was came after.")).toBeNull();
    const leak = "The Commodore was still alive after the lurch, I heard him myself.";
    expect(r7Verdict(c, "bilge", leak)?.reason).toMatch(/alive_after|forbidden_phrase/);
  });
});
