/** The prompt-surface audit (tools/prompt-audit.ts): passes on the shipped cases, and catches a planted leak. */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { auditCase } from "@/tools/prompt-audit";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

describe("prompt-surface audit", () => {
  it("case one: no culprit prompt holds core-guilt content, across every state", () => {
    const r = auditCase(c);
    expect(r.failures).toEqual([]);
    expect(r.coreSecretIds).toContain("s-victoria-murder");
    const culprit = r.rows.filter((x) => x.characterId === "victoria");
    expect(culprit.length).toBeGreaterThan(10);
    for (const row of culprit) expect(row.facts).not.toContain("loc-victoria-2117");
  });

  it("FAILS when a core-guilt secret's text is planted in the culprit's persona", () => {
    const bad = structuredClone(c);
    const v = bad.characters.find((x) => x.id === "victoria")!;
    v.goals = [...v.goals, v.secrets.find((s) => s.id === "s-victoria-murder")!.description];
    const r = auditCase(bad);
    expect(r.failures.some((f) => /description in prompt text/.test(f.problem))).toBe(true);
    expect(r.failures.some((f) => /murder minute/.test(f.problem))).toBe(true);
  });

  it("stays green when a core fact loses its hiddenUntil: layer 4 of the knowledge gate still withholds it", () => {
    const bad = structuredClone(c);
    const f = bad.timeline.find((x) => x.id === "ev-murder") ?? bad.facts.find((x) => x.id === "ev-murder")!;
    delete (f as { hiddenUntil?: unknown }).hiddenUntil;
    const r = auditCase(bad);
    expect(r.failures).toEqual([]);
  });
});
