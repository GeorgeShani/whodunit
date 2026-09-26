/** Fact time ranges (from/to), their prompt tags and canon check, and the new validator rules. */
import { beforeAll, describe, expect, it } from "vitest";
import { canonTimes, checkTimes } from "@/ai/canon-check";
import { knowledgeLines } from "@/ai/prompts/interrogation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { checkCaseReferences, checkCaseWarnings } from "@/engine/case-validation";
import { createInitialGameState } from "@/engine/game-state";
import { FactSchema } from "@/engine/types";
import { FIXTURES_DIR } from "../helpers/fixture";

let hl: LoadedCase;
beforeAll(async () => {
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});
const base = { id: "f", statement: "s", category: "background" };

describe("FactSchema time shape", () => {
  it("accepts no time, a point, or a from/to window; rejects mixes and half windows", () => {
    expect(FactSchema.safeParse(base).success).toBe(true);
    expect(FactSchema.safeParse({ ...base, time: "21:00" }).success).toBe(true);
    expect(FactSchema.safeParse({ ...base, from: "21:13", to: "21:30" }).success).toBe(true);
    expect(FactSchema.safeParse({ ...base, time: "21:00", from: "21:13", to: "21:30" }).success).toBe(false);
    expect(FactSchema.safeParse({ ...base, from: "21:13" }).success).toBe(false);
    expect(FactSchema.safeParse({ ...base, hiddenUntil: {} }).success).toBe(false);
  });

  it("validator: from must not be after to within the game day (midnight-crossing windows are fine)", () => {
    const c = structuredClone(hl);
    c.facts.push(FactSchema.parse({ ...base, id: "backwards", from: "21:30", to: "21:13" }));
    c.facts.push(FactSchema.parse({ ...base, id: "late", from: "23:50", to: "00:10" }));
    const issues = checkCaseReferences(c);
    expect(issues.map((i) => i.path)).toContain("facts.2(backwards)");
    expect(issues.some((i) => i.path?.includes("late"))).toBe(false);
  });
});

describe("prompt tags and canon check use fact ranges", () => {
  it("tags a ranged fact [HH:MM-HH:MM, Place]", () => {
    const ctx = buildCharacterContext({ caseData: hl, game: createInitialGameState(hl) }, "finch");
    const line = knowledgeLines(ctx).find((l) => l.includes("HL_LAMP_DARK"));
    expect(line).toMatch(/^- \[22:28-22:50 \(.+\), Lamp Room\] HL_LAMP_DARK/);
  });

  it("any time inside the range counts as known; outside does not", () => {
    const ctx = buildCharacterContext({ caseData: hl, game: createInitialGameState(hl) }, "finch");
    const allowed = canonTimes(ctx, { exposedLieIds: [] }, "When was the lamp out?");
    expect(checkTimes("The lamp in the lamp room was dark at twenty to eleven.", allowed).ok).toBe(true);
    expect(checkTimes("The lamp room went dark at 22:29.", allowed).ok).toBe(true);
    expect(checkTimes("The lamp room went dark at 22:55.", allowed).ok).toBe(false);
  });
});

describe("validator: testimony and hiding references", () => {
  const edit = (fn: (c: LoadedCase) => void) => {
    const c = structuredClone(hl);
    fn(c);
    return c;
  };
  const q = (c: LoadedCase) => c.characters.find((x) => x.id === "keeper-quill")!;
  const m = (c: LoadedCase) => c.characters.find((x) => x.id === "cook-marlow")!;

  it("the fixture is clean", () => {
    expect(checkCaseReferences(hl)).toEqual([]);
    expect(checkCaseWarnings(hl)).toEqual([]);
  });

  it("unknown breaksOnSecretIds / breaksOnFactIds / hiddenUntil refs are errors", () => {
    const c = edit((c) => {
      q(c).intendedLies[0].breaksOnSecretIds.push("no-such-secret");
      q(c).intendedLies[0].breaksOnFactIds.push("no-such-fact");
      c.timeline[0].hiddenUntil = { secretIds: ["ghost"], lieIds: ["ghost-lie"] };
    });
    const msgs = checkCaseReferences(c).map((i) => i.message);
    expect(msgs).toEqual(expect.arrayContaining(['unknown secret "no-such-secret"', 'unknown fact "no-such-fact"', 'unknown secret "ghost"', 'unknown intended lie "ghost-lie"']));
  });

  it("warns: self-referential testimony, unrevealable secrets, reveal-order cycles, missing summaries, unbreakable lies", () => {
    const c = edit((c) => {
      q(c).intendedLies[0].breaksOnSecretIds = ["quill-secret"]; // own secret
      q(c).intendedLies[0].brokenByEvidenceIds = [];
      const saw = m(c).secrets.find((s) => s.id === "marlow-saw-quill")!;
      saw.revealConditions = { evidenceIds: ["wet-logbook"], mode: "any", afterSecretIds: ["marlow-saw-quill"] }; // cycle
      q(c).intendedLies[1].breaksOnFactIds = ["marlow-sees-quill"];
      delete m(c).secrets[0].testimonySummary;
      q(c).intendedLies[1].breaksOnSecretIds = ["marlow-secret"];
    });
    const w = checkCaseWarnings(c).map((i) => i.message).join("\n");
    expect(w).toMatch(/self-referential: "quill-secret"/);
    expect(w).toMatch(/reveal-order cycle/);
    expect(w).toMatch(/no testimonySummary/);
    const c2 = edit((c) => {
      const saw = m(c).secrets.find((s) => s.id === "marlow-saw-quill")!;
      saw.revealConditions = { evidenceIds: ["wet-logbook"], mode: "any", afterSecretIds: ["marlow-saw-quill"] };
      q(c).intendedLies[1].breaksOnFactIds = ["marlow-sees-quill"];
    });
    expect(checkCaseWarnings(c2).map((i) => i.message).join("\n")).toMatch(/lie can never break/);
  });

  it('warns when knowledgeGate is "explicit" but nothing uses hiddenUntil', () => {
    const c = edit((c) => {
      c.knowledgeGate = "explicit";
      c.timeline.forEach((t) => delete t.hiddenUntil);
    });
    expect(checkCaseWarnings(c).some((w) => w.path === "knowledgeGate")).toBe(true);
  });
});
