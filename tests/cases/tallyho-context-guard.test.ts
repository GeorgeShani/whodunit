/**
 * Permanent audit: Tallyho character context must not (a) state the victim was
 * alive after 22:14 except canonical beliefs, or (b) mention the heel instrument
 * before heel-chart is found. Case data that still violates this is marked
 * it.fails so Agatha can fix the ids; this file does not edit cases/.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import { buildCharacterContext, type CharacterContext } from "@/engine/context-builder";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import type { CaseState } from "@/engine/game-state";

const CHARACTERS = ["gherkina", "bilge", "percy", "zippelli", "ottilie", "boris"] as const;
const UNTIL_MIN = 22 * 60 + 14;
const CANONICAL_BELIEFS = new Set(["b-bilge-watch", "b-percy-alive", "b-boris-alive", "b-gherkina-sulking"]);

const VICTIM_RE = /\b(?:commodore|barnacle|barnabas|old man|marmalade king|the owner|\buncle\b)\b/i;
const ALIVE_RE =
  /\b(?:alive|living|still\s+(?:alive|breathing|with\s+us)|up\s+and\s+about|spoke|spoken|talked|had\s+a\s+word|called\s+out|chatted|saw|seen|met|cheered|survived|barking\s+orders)\b/i;
const APPEARANCE_RE = /\b(?:watch|clock|horn|horns|voice-horn|cheer-box|cylinder|trumpet|programme|sounded)\b/i;
const HEEL_INSTRUMENT_RE =
  /\b(?:heel[- ]?(?:recorder|chart|log|strip)|inclinometer|clinometer|inclinograph|angle[- ]of[- ]heel|recorder(?:'s)?\s+pen|pencils?\s+['']?lurch)\b/i;

type Item = { field: string; id: string; text: string };
type StateName = "fresh" | "mid-no-heel" | "mid-with-heel" | "heel-only";

function itemsOf(ctx: CharacterContext): Item[] {
  return [
    ...ctx.knowledge.map((k) => ({ field: "knowledge", id: k.id, text: k.statement })),
    ...ctx.beliefs.map((b) => ({ field: "beliefs", id: b.id, text: b.statement })),
  ];
}

function clockAfterUntil(text: string): boolean {
  for (const m of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const min = Number(m[1]) * 60 + Number(m[2]);
    // Evening 24h times only (Tallyho's evening is after noon).
    if (min > UNTIL_MIN && min >= 12 * 60) return true;
  }
  return false;
}

function unframedAliveAfter(item: Item): boolean {
  if (item.field === "beliefs" && CANONICAL_BELIEFS.has(item.id)) return false;
  if (!VICTIM_RE.test(item.text) || !ALIVE_RE.test(item.text)) return false;
  if (APPEARANCE_RE.test(item.text)) return false;
  return clockAfterUntil(item.text) || /\b(?:after\s+the\s+(?:great\s+)?lurch|listed\s+to\s+port)\b/i.test(item.text);
}

function statesOf(c: LoadedCase): { name: StateName; heel: boolean; game: CaseState["game"] }[] {
  const mid = (heel: boolean) => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds = [...new Set([...g.discoveredEvidenceIds, "smashed-watch", "midnight-notes", "marmalade-run", "cheer-cylinder", ...(heel ? (["heel-chart"] as const) : [])])];
    return g;
  };
  const heelOnly = createInitialGameState(c);
  heelOnly.discoveredEvidenceIds = [...new Set([...heelOnly.discoveredEvidenceIds, "heel-chart"])];
  return [
    { name: "fresh", heel: false, game: createInitialGameState(c) },
    { name: "mid-no-heel", heel: false, game: mid(false) },
    { name: "mid-with-heel", heel: true, game: mid(true) },
    { name: "heel-only", heel: true, game: heelOnly },
  ];
}

function collect(c: LoadedCase, heelFound: boolean | "any", pred: (item: Item, ch: string, st: StateName) => boolean) {
  const hits: string[] = [];
  for (const st of statesOf(c)) {
    if (heelFound !== "any" && st.heel !== heelFound) continue;
    for (const ch of CHARACTERS) {
      const ctx = buildCharacterContext({ caseData: c, game: st.game }, ch);
      for (const item of itemsOf(ctx)) {
        if (pred(item, ch, st.name)) hits.push(`${st.name}/${ch}/${item.field}:${item.id}`);
      }
    }
  }
  return [...new Set(hits)].sort();
}

describe("Tallyho context audit (root cause)", () => {
  let c: LoadedCase;
  beforeAll(async () => {
    c = await loadCase("tallyho");
  });

  it("does not put unframed 'alive after 22:14' claims in knowledge or non-canonical beliefs", () => {
    expect(collect(c, "any", (item) => unframedAliveAfter(item))).toEqual([]);
  });

  it("does not put heel-instrument wording in anyone else's context before heel-chart is found", () => {
    // ev-chart-flip is a gated on heel-chart via hiddenUntil.evidenceIds — covered by the test below.
    expect(collect(c, false, (item, ch) => HEEL_INSTRUMENT_RE.test(item.text) && !(ch === "ottilie" && item.id === "ev-chart-flip"))).toEqual([]);
  });

  it("ev-chart-flip is withheld from Ottilie until heel-chart is found", () => {
    const hits = collect(c, false, (item, ch) => ch === "ottilie" && item.id === "ev-chart-flip");
    expect(hits, "Agatha: gate timeline ev-chart-flip with hiddenUntil.evidenceIds: [\"heel-chart\"]").toEqual([]);
  });
});
