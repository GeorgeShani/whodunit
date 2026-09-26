/**
 * The engine and AI layers must stay case-agnostic: no ids or names from any
 * shipped case may appear in engine/ or ai/ source (case content lives only
 * under cases/). Grep-style, over every .ts file.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { listPublicCaseIds } from "@/engine/case-registry";

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith(".ts") ? [path.join(dir, d.name)] : [],
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

let files: { file: string; text: string }[];
let terms: string[];
beforeAll(async () => {
  files = [...walk("engine"), ...walk("ai")].map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const cases = await Promise.all(listPublicCaseIds().map((id) => loadCase(id)));
  terms = cases.flatMap(caseTerms);
});

describe("engine/ and ai/ are case-agnostic", () => {
  it("scans real files and real case terms", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(terms).toEqual(expect.arrayContaining(["blackwood", "reginald", "Victoria", "silver-candlestick"]));
  });

  it("contains no case-specific ids or names", () => {
    const hits: string[] = [];
    for (const { file, text } of files) {
      for (const t of terms) {
        const re = new RegExp(`(?<![A-Za-z0-9_-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`, "i");
        if (re.test(text)) hits.push(`${file}: ${t}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
