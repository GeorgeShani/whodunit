/**
 * The code must stay case-agnostic: no ids or names from any shipped case may appear in engine/, ai/, components/,
 * lib/ or app/ source (case content lives only under cases/). Grep-style, over every .ts/.tsx file. Phase 3 widened
 * the scan from engine/ and ai/; ALLOWED lists the few deliberate exceptions.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { listPublicCaseIds } from "@/engine/case-registry";

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : [],
  );

/** Distinctive terms from a case: ids and proper names (common words like "hall" are skipped). */
function caseTerms(c: LoadedCase): string[] {
  const names = [c.victim.name, ...c.characters.map((ch) => ch.name)].flatMap((n) => n.split(/[\s.]+/)).filter((w) => w.length >= 4 && /^[A-Z]/.test(w));
  const ids = [
    c.id,
    c.victim.id,
    ...c.characters.map((ch) => ch.id),
    ...c.evidence.map((e) => e.id),
    ...c.characters.flatMap((ch) => [...ch.secrets.map((s) => s.id), ...ch.intendedLies.map((l) => l.id), ...ch.beliefs.map((b) => b.id)]),
    ...c.timeline.map((t) => t.id),
    ...c.facts.map((f) => f.id),
  ];
  const generic = new Set(["Lord", "Lady", "Mister", "Miss"]);
  return [...new Set([...names, ...ids])].filter((t) => !generic.has(t));
}

/** file -> terms it may name, with the reason. */
const ALLOWED: Record<string, string[]> = {
  // The case "/" serves (and the legacy default for a token without a case id): which case is the default is a product decision.
  [path.join("lib", "cases.ts")]: ["blackwood", "Blackwood"],
};

let files: { file: string; text: string }[];
let terms: string[];
beforeAll(async () => {
  files = ["engine", "ai", "components", "lib", "app"].flatMap(walk).map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const cases = await Promise.all(listPublicCaseIds().map((id) => loadCase(id)));
  terms = cases.flatMap(caseTerms);
});

describe("engine/, ai/, components/, lib/ and app/ are case-agnostic", () => {
  it("scans real files and real case terms", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(terms).toEqual(expect.arrayContaining(["blackwood", "reginald", "Victoria", "silver-candlestick"]));
  });

  it("contains no case-specific ids or names", () => {
    const hits: string[] = [];
    for (const { file, text } of files) {
      for (const t of terms) {
        const re = new RegExp(`(?<![A-Za-z0-9_-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`, "i");
        if (re.test(text) && !ALLOWED[file]?.includes(t)) hits.push(`${file}: ${t}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
