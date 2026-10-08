/**
 * #47 "a card cracks its own secret": in an exchange where a clue or testimony card is presented, the only secrets
 * that can come out are those mapped to that item through revealConditions. Stress still accrues; a stress-threshold
 * reveal it enables waits for the next ordinary exchange. A breakdown reveals nothing beyond the item's own secret.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { commitTurn, planTurn } from "@/engine/interrogation";
import { isMappedToPresentation } from "@/engine/secrets";
import type { GameState } from "@/engine/types";
import { FIXTURES_DIR } from "../helpers/fixture";

let c: LoadedCase;
let hl: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});

const performed = () => ({ playerText: "", dialogue: "…", emotion: "nervous" as const, intensity: 0.5, stressDelta: 0, trustDelta: 0, performed: true });
function cardsOut(): GameState {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds = c.evidence.map((e) => e.id);
  g.characters.reginald.revealedSecretIds = ["s-reginald-theft", "s-reginald-overheard"];
  g.characters.gregory.revealedSecretIds = ["s-gregory-in-hall", "s-gregory-saw-victoria"];
  g.revealedSecretIds = ["s-reginald-theft", "s-reginald-overheard", "s-gregory-in-hall", "s-gregory-saw-victoria"];
  return g;
}

describe("#47 a presented card reveals only the secret mapped to it", () => {
  it("Victoria at 60 shown Reginald's overheard card reveals the new will, not the stress-path left-dining", () => {
    const g = cardsOut();
    g.characters.victoria.stress = 60;
    const plan = planTurn(c, g, "victoria", { presentedTestimonyId: "s-reginald-overheard" });
    expect(g.characters.victoria.stress).toBeGreaterThanOrEqual(70); // the card's stress still accrues past the left-dining threshold
    expect(plan.revealSecretId).toBe("s-victoria-new-will");
    commitTurn(g, plan, performed());
    // The deferred stress-threshold reveal arrives on the next ordinary exchange.
    const next = planTurn(c, g, "victoria", { playerText: "Where did you go when you left the dining room?" });
    expect(next.revealSecretId).toBe("s-victoria-left-dining");
  });

  it("Gregory's eyewitness card (mapped to no Victoria secret) reveals nothing; left-dining waits for the next question", () => {
    const g = cardsOut();
    g.characters.victoria.stress = 60;
    const plan = planTurn(c, g, "victoria", { presentedTestimonyId: "s-gregory-saw-victoria" });
    expect(plan.engineStressDelta).toBeGreaterThan(0);
    expect(plan.newlyExposedLieIds.length).toBeGreaterThan(0); // the card still breaks her lies
    expect(plan.revealSecretId).toBeNull();
    commitTurn(g, plan, performed());
    expect(planTurn(c, g, "victoria", { playerText: "Well?" }).revealSecretId).toBe("s-victoria-left-dining");
  });

  it("a breakdown triggered by a card reveals nothing beyond that card's own secret", () => {
    const g = cardsOut();
    g.characters.victoria.stress = 90;
    const plan = planTurn(c, g, "victoria", { presentedTestimonyId: "s-gregory-saw-victoria" });
    expect(plan.breakdown).toBe(true);
    expect(plan.revealSecretId).toBeNull();
    const g2 = cardsOut();
    g2.characters.victoria.stress = 90;
    const p2 = planTurn(c, g2, "victoria", { presentedTestimonyId: "s-reginald-overheard" });
    expect(p2.breakdown).toBe(true);
    expect(p2.revealSecretId).toBe("s-victoria-new-will");
  });

  it("a clue with no mapped secret for this character reveals nothing even past a stress threshold", () => {
    const g = cardsOut();
    g.characters.victoria.stress = 68;
    const plan = planTurn(c, g, "victoria", { presentedEvidenceId: "muddy-footprint" });
    expect(plan.revealSecretId).toBeNull();
  });

  it("a mapped clue still reveals its own secret (mode-any evidence path unchanged)", () => {
    const g = cardsOut();
    const plan = planTurn(c, g, "victoria", { presentedEvidenceId: "burned-letter" });
    expect(plan.revealSecretId).toBe("s-victoria-new-will");
  });

  it("isMappedToPresentation reads evidenceIds and testimonyIds (fixture case too)", () => {
    for (const ch of [...c.characters, ...hl.characters])
      for (const s of ch.secrets) {
        for (const ev of s.revealConditions?.evidenceIds ?? []) expect(isMappedToPresentation(s, { presentedEvidenceId: ev })).toBe(true);
        for (const t of s.revealConditions?.testimonyIds ?? []) expect(isMappedToPresentation(s, { presentedTestimonyId: t })).toBe(true);
        expect(isMappedToPresentation(s, { presentedEvidenceId: "no-such-clue" })).toBe(false);
      }
  });
});
