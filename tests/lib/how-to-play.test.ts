/**
 * docs/HOW_TO_PLAY.md -> structured manual (lib/how-to-play.ts): parsing, the notes-for-Dexter strip, spoiler-freedom
 * against every public case, and the numbers it quotes against the engine's own constants.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { tipsSection } from "@/components/help/ManualContent";
import { MAX_QUESTION_CHARS } from "@/ai/interrogate-schema";
import { getPublicCase, listPublicCaseIds } from "@/engine/case-registry";
import { MAX_CONFRONTATION_TOTAL, MAX_CONFRONTATION_TURNS } from "@/engine/constants";
import { HINT_COOLDOWN_TURNS } from "@/engine/hints";
import { STRESS_BANDS } from "@/engine/stress";
import { manualText, parseInline, parseManual, type Manual } from "@/lib/how-to-play";
import { getManual, HOW_TO_PLAY_PATH } from "@/lib/how-to-play.server";

let manual: Manual;
let text: string;
let md: string;
beforeAll(() => {
  md = readFileSync(HOW_TO_PLAY_PATH, "utf8");
  manual = getManual();
  text = manualText(manual);
});

describe("parseManual (docs/HOW_TO_PLAY.md is the single source)", () => {
  it("one section per ## heading of the player copy, in order; the title from #", () => {
    const player = md.slice(0, md.search(/^## Notes for Dexter/m));
    const headings = [...player.replace(/<!--[\s\S]*?-->/g, "").matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim());
    expect(manual.title).toBe("How to Play WHODUNIT?!");
    expect(manual.sections.map((s) => s.title)).toEqual(headings);
    expect(manual.sections[0]!.id).toBe("quick-start");
    expect(new Set(manual.sections.map((s) => s.id)).size).toBe(manual.sections.length);
  });

  it("drops the top comment and the Notes for Dexter section (not player copy)", () => {
    expect(text).not.toMatch(/Dexter|NOTES FOR|Spoiler rule|Suggested placement|ending-payload|<!--/);
    expect(manual.sections.some((s) => /notes for/i.test(s.title))).toBe(false);
  });

  it("keeps every list item, table row and bold-only sub-heading", () => {
    const quick = manual.sections[0]!.blocks[0]!;
    expect(quick.type).toBe("ol");
    expect(quick.type === "ol" && quick.items.length).toBe(6);
    const stress = manual.sections.find((s) => s.id === "stress-and-breakdowns")!;
    const table = stress.blocks.find((b) => b.type === "table");
    expect(table && table.type === "table" && table.rows.length).toBe(5);
    expect(stress.blocks.filter((b) => b.type === "h").map((b) => b.type === "h" && b.text[0]!.v)).toEqual(["What raises stress", "What lowers it", "Breakdowns"]);
    // "**Tip:** soothing…" is a paragraph, not a heading.
    expect(stress.blocks.at(-1)!.type).toBe("p");
  });

  it("inline: bold, italic and code; plain text untouched", () => {
    expect(parseInline("Hit **🔍 Investigate** and *search* `x`.")).toEqual([
      { t: "text", v: "Hit " },
      { t: "strong", v: "🔍 Investigate" },
      { t: "text", v: " and " },
      { t: "em", v: "search" },
      { t: "text", v: " " },
      { t: "code", v: "x" },
      { t: "text", v: "." },
    ]);
    expect(parseInline("2 * 3 = 6")).toEqual([{ t: "text", v: "2 * 3 = 6" }]);
  });

  it("a broken source fails loudly instead of shipping a blank manual", () => {
    expect(() => parseManual("no headings at all")).toThrow(/title/);
    expect(() => parseManual("# Title\n\nJust text.")).toThrow(/sections/);
    expect(parseManual("# T\n\n## A\n\nx\n\n## Notes for Dexter\n\nsecret").sections.map((s) => s.title)).toEqual(["A"]);
  });
});

describe("spoiler-free and case-agnostic", () => {
  it("names nothing from any public case (people, victim, rooms, clues, motives)", async () => {
    for (const id of listPublicCaseIds()) {
      const c = await getPublicCase(id);
      const names = [
        ...c.characters.flatMap((ch) => [ch.name, ...ch.name.split(/\s+/).filter((w) => w.length >= 4)]),
        c.victim.name,
        ...c.victim.aliases,
        ...c.locations.map((l) => l.name.replace(/^The\s+/i, "")),
        ...c.evidence.map((e) => e.name),
        ...c.motives.map((m) => m.label),
        c.title,
      ];
      const hits = names.filter((n) => n.length >= 4 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
      expect(hits, `case ${id}`).toEqual([]);
    }
  });
});

describe("numbers and labels the manual quotes match the engine", () => {
  it("question length, confrontation caps, accuse citation limits, stress band names", () => {
    expect(text).toContain(`up to ${MAX_QUESTION_CHARS} characters`);
    expect(text).toContain(`at most ${MAX_CONFRONTATION_TURNS} exchanges`);
    expect(text).toContain(`${MAX_CONFRONTATION_TOTAL} confrontation exchanges`);
    expect(text).toContain("1 to 5");
    expect(text).toContain("1 to 3");
    expect(HINT_COOLDOWN_TURNS).toBeGreaterThan(1); // "needs a few turns to recharge"
    const stress = manual.sections.find((s) => s.id === "stress-and-breakdowns")!;
    const table = stress.blocks.find((b) => b.type === "table")!;
    if (table.type !== "table") throw new Error("no table");
    expect(table.rows.map((r) => r[0]!.map((x) => x.v).join(""))).toEqual(STRESS_BANDS.map((b) => b.label));
  });
});

describe("tips for this case", () => {
  it("present: one list item per tip; absent, empty or blank: no section", () => {
    const s = tipsSection(["One.", "Two."])!;
    expect(s.title).toBe("Tips for this case");
    expect(s.blocks).toEqual([{ type: "ul", items: [[{ t: "text", v: "One." }], [{ t: "text", v: "Two." }]] }]);
    expect(tipsSection(undefined)).toBeNull();
    expect(tipsSection([])).toBeNull();
    expect(tipsSection(["  "])).toBeNull();
  });
});
