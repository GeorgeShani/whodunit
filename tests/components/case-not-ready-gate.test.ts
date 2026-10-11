/** E5: the CASE NOT READY checklist has exactly one row per accuse-gate condition, so all rows ticked == unlocked. */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { CaseNotReady } from "@/components/progress/CaseNotReady";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { accuseProgress, leadStates } from "@/engine/progress";
import { AccuseGateSchema, type AccuseGate, type GameState } from "@/engine/types";

/** Gate condition -> checklist row. A new gate condition without a row fails the first test. */
const ROW_OF: Record<Exclude<keyof AccuseGate, "lockedLines">, string> = {
  minEvidence: "clues",
  minSuspectsQuestioned: "suspects",
  minRevealedSecrets: "secrets",
  closedLeadIds: "leads",
};

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

describe("accuse checklist covers the gate (E5)", () => {
  it("every gate condition in the schema has a checklist row, and every row is a gate condition", () => {
    const conditions = Object.keys(AccuseGateSchema.shape).filter((k) => k !== "lockedLines").sort();
    expect(conditions).toEqual(Object.keys(ROW_OF).sort());
    const g = createInitialGameState(c);
    expect(Object.keys(accuseProgress(c, g).checklist).sort()).toEqual(Object.values(ROW_OF).sort());
  });

  /** A spread of states: nothing, everything, and each condition alone missing (data-driven from the case's gate). */
  function states(): GameState[] {
    const gate = c.accuseGate!;
    const full = () => {
      const g = createInitialGameState(c);
      g.discoveredEvidenceIds = c.evidence.map((e) => e.id);
      g.revealedSecretIds = c.characters.flatMap((ch) => ch.secrets.map((s) => s.id));
      for (const ch of c.characters) {
        g.characters[ch.id].revealedSecretIds = ch.secrets.map((s) => s.id);
        g.characters[ch.id].interrogationCount = 10;
        (g.characters[ch.id] as { exchanges?: number }).exchanges = 10;
      }
      return g;
    };
    const out = [createInitialGameState(c), full()];
    const noClues = full();
    noClues.discoveredEvidenceIds = [];
    out.push(noClues);
    const noSecrets = full();
    noSecrets.revealedSecretIds = [];
    out.push(noSecrets);
    if (gate.minSuspectsQuestioned) {
      const quiet = full();
      for (const ch of c.characters) quiet.characters[ch.id].interrogationCount = 0;
      out.push(quiet);
    }
    return out;
  }

  it("for every sampled state: unlocked exactly when every row with a requirement is met, and leads count only the gate's own", () => {
    const gate = c.accuseGate!;
    for (const g of states()) {
      const p = accuseProgress(c, g);
      const rows = Object.values(p.checklist).filter((r): r is { have: number; need: number } => Boolean(r));
      expect(p.unlocked).toBe(rows.every((r) => r.have >= r.need));
      const st = leadStates(c, g);
      expect(p.checklist.leads).toEqual({ have: (gate.closedLeadIds ?? []).filter((id) => st[id] === "closed").length, need: (gate.closedLeadIds ?? []).length });
    }
  });

  it("the dialog shows a Leads row (counts only) when the gate needs leads, so it is never all-ticked while locked", () => {
    const accuse = {
      unlocked: false,
      citeTestimony: false,
      line: "Not yet.",
      checklist: { clues: { have: 3, need: 3 }, suspects: { have: 2, need: 2 }, secrets: { have: 1, need: 1 }, leads: { have: 1, need: 2 } },
    };
    const out = renderToStaticMarkup(h(CaseNotReady, { accuse, onClose: () => {} }));
    expect(out).toContain("Leads");
    expect(out).toContain("1/2");
    expect((out.match(/aria-label="done"/g) ?? []).length).toBe(3);
    const noLeads = renderToStaticMarkup(h(CaseNotReady, { accuse: { ...accuse, checklist: { ...accuse.checklist, leads: { have: 0, need: 0 } } }, onClose: () => {} }));
    expect(noLeads).not.toContain("Leads");
  });
});
