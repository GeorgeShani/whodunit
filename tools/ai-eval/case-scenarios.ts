/**
 * Per-case scenario files for npm run eval:ai: cases/<id>/evals/*.json, each { scenarios: [...] } in the shape
 * Agatha's leak-scenarios.json uses (group, turn, noSolution, setup as data, engine expectations, forbidden.phrases).
 * Loaded when present; a case without an evals folder contributes nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Scenario, Turn } from "./scenarios";

interface DataScenario {
  id: string;
  title?: string;
  suspect?: string;
  group: Scenario["group"];
  turn: Turn;
  noSolution?: boolean;
  addressed?: string;
  partner?: string;
  setup?: {
    discoveredEvidenceIds?: string[];
    characters?: Record<string, { stress?: number; evidenceShownIds?: string[]; testimonyShownIds?: string[]; revealedSecretIds?: string[] }>;
  };
  engine?: { revealSecretId?: string | null; addressedRevealSecretId?: string | null };
  forbidden?: { phrases?: string[] };
}

export function toScenario(d: DataScenario, source: string): Scenario {
  const expectReveal: Record<string, string | null> = {};
  if (d.engine && "revealSecretId" in d.engine && d.suspect) expectReveal[d.suspect] = d.engine.revealSecretId ?? null;
  if (d.engine && "addressedRevealSecretId" in d.engine && d.addressed) expectReveal[d.addressed] = d.engine.addressedRevealSecretId ?? null;
  return {
    id: d.id,
    group: d.group,
    description: d.title ?? d.id,
    source,
    ...(d.noSolution ? { noSolution: true } : {}),
    ...(d.forbidden?.phrases?.length ? { forbidden: d.forbidden.phrases } : {}),
    ...(Object.keys(expectReveal).length ? { expectReveal } : {}),
    turn: d.turn,
    setup: (_g, h) => {
      const s = d.setup ?? {};
      if (s.discoveredEvidenceIds) h.discover(...s.discoveredEvidenceIds);
      for (const [ch, rt] of Object.entries(s.characters ?? {})) {
        if (rt.revealedSecretIds?.length) h.reveal(ch, ...rt.revealedSecretIds);
        if (rt.evidenceShownIds?.length) h.shown(ch, ...rt.evidenceShownIds);
        if (rt.testimonyShownIds?.length) h.showTestimony(ch, ...rt.testimonyShownIds);
        if (rt.stress !== undefined) h.stress(ch, rt.stress);
      }
    },
  };
}

/** Every scenario in cases/<caseId>/evals/*.json (sorted by file name), or [] when there is no evals folder. */
export function loadCaseScenarios(caseId: string, casesDir = path.resolve("cases")): Scenario[] {
  const dir = path.join(casesDir, caseId, "evals");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      const j = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { scenarios?: DataScenario[] };
      return (j.scenarios ?? []).map((d) => toScenario(d, `cases/${caseId}/evals/${f}`));
    });
}

/** The full eval set for a case: the built-in scenarios plus the case's own files (ids must be unique). */
export function allScenarios(builtIn: Scenario[], caseId: string, casesDir?: string): Scenario[] {
  const all = [...builtIn, ...loadCaseScenarios(caseId, casesDir)];
  const seen = new Set<string>();
  for (const s of all) {
    if (seen.has(s.id)) throw new Error(`eval: duplicate scenario id ${s.id}`);
    seen.add(s.id);
  }
  return all;
}
