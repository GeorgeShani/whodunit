/** Blackwood's own progression data (#36): lead visibility (#38) and the accuse gate failing solely on the alibi lead. */
import { beforeAll, describe, expect, it } from "vitest";
import { handleAccuse } from "@/engine/accuse-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { searchLocation } from "@/engine/investigation";
import { accuseProgress, leadStates, publicProgress, visibleLeadStates } from "@/engine/progress";
import { saveSession } from "@/engine/session";
import { TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

describe("a lead that closes before it ever opened (#38)", () => {
  // Searching the hall finds the muddy footprint, which closes lead-boots. Gregory has not been pressed yet, so the player never saw it open.
  const afterHall = () => {
    const g = createInitialGameState(c);
    g.searchedLocationIds = ["hall"];
    g.discoveredEvidenceIds = [...g.discoveredEvidenceIds, "muddy-footprint"];
    return g;
  };

  it("the engine still counts it closed (gates and lead atoms see it), but it is not shown", () => {
    const g = afterHall();
    expect(leadStates(c, g)["lead-boots"]).toBe("closed");
    expect(visibleLeadStates(c, g)["lead-boots"]).toBe("hidden");
    const p = publicProgress(c, g, visibleLeadStates(c, createInitialGameState(c)));
    expect(p.leads.map((l) => l.id)).not.toContain("lead-boots");
    expect(JSON.stringify(p)).not.toContain("The boots had been in the hall");
  });

  it("reproduction through real searches: garden (lantern opens) then hall (footprint closes lantern and, unseen, boots)", () => {
    const g = createInitialGameState(c);
    searchLocation(c, g, "garden");
    const before = visibleLeadStates(c, g);
    expect(before["lead-lantern"]).toBe("open");
    expect(before["lead-boots"]).toBe("hidden");
    expect(searchLocation(c, g, "hall").newlyFound.map((e) => e.id)).toEqual(["muddy-footprint"]);
    const p = publicProgress(c, g, before);
    expect(p.leads.filter((l) => l.state === "closed").map((l) => l.id)).toEqual(["lead-lantern"]);
    expect(p.newLeadIds.sort()).toEqual(["lead-eyewitness", "lead-lantern"]);
  });

  it("no NEW LEAD / LEAD SOLVED for it; leads the player did see open still announce", () => {
    const before = createInitialGameState(c);
    const p = publicProgress(c, afterHall(), visibleLeadStates(c, before));
    expect(p.newLeadIds).not.toContain("lead-boots");
    expect(p.newLeadIds).toContain("lead-eyewitness"); // opened by the hall search itself
  });

  it("once it would have opened it appears already solved, still without a toast", () => {
    const before = afterHall();
    const after = afterHall();
    after.characters.gregory.interrogationCount = 2;
    const p = publicProgress(c, after, visibleLeadStates(c, before));
    expect(p.leads.find((l) => l.id === "lead-boots")).toMatchObject({ state: "closed", closedLine: "The boots had been in the hall after all." });
    expect(p.newLeadIds).not.toContain("lead-boots");
  });

  it("a lead the player saw open still toasts when it closes", () => {
    const opened = createInitialGameState(c);
    opened.characters.gregory.interrogationCount = 2;
    expect(visibleLeadStates(c, opened)["lead-boots"]).toBe("open");
    const solved = createInitialGameState(c);
    solved.characters.gregory.interrogationCount = 2;
    solved.discoveredEvidenceIds = [...solved.discoveredEvidenceIds, "muddy-footprint"];
    const p = publicProgress(c, solved, visibleLeadStates(c, opened));
    expect(p.newLeadIds).toContain("lead-boots");
    expect(p.leads.find((l) => l.id === "lead-boots")?.state).toBe("closed");
  });

  it("a lead with no opensWhen that closes on the first clue is shown as solved (it was open from the start)", () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds = [...g.discoveredEvidenceIds, "silver-candlestick"];
    const p = publicProgress(c, g, visibleLeadStates(c, createInitialGameState(c)));
    expect(p.leads.find((l) => l.id === "lead-weapon")?.state).toBe("closed");
    expect(p.newLeadIds).toContain("lead-weapon");
  });
});

describe("the accuse gate failing solely on the alibi lead (closedLeadIds)", () => {
  const ready = () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds = ["silver-candlestick", "muddy-footprint", "burned-letter", "library-key"];
    for (const id of ["reginald", "gregory", "archibald"]) g.characters[id].interrogationCount = 2;
    g.revealedSecretIds = ["s-reginald-overheard", "s-gregory-in-hall"]; // two cracks, neither one closes the alibi lead
    return g;
  };
  const accuse = (g: ReturnType<typeof ready>) =>
    handleAccuse(
      { caseId: "blackwood", stateToken: saveSession(g, TEST_ENV), accusation: { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key", "burned-letter"] } },
      { caseData: c, env: TEST_ENV },
    );

  it("every count is met and only the alibi lead is open: 403 with the leads line, counts only", async () => {
    const g = ready();
    expect(accuseProgress(c, g)).toMatchObject({
      unlocked: false,
      line: "One of tonight's stories hasn't been put to the test yet. Somebody is still telling it with a straight face.",
      checklist: { clues: { have: 4, need: 3 }, suspects: { have: 3, need: 3 }, secrets: { have: 2, need: 2 } },
    });
    const r = await accuse(g);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("accuse_locked");
    expect(r.body.line).toMatch(/stories hasn't been put to the test/);
    expect(r.body.outcome).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/s-archibald-false-alibi|s-gregory-saw-victoria|closedLeadIds|closesWhen/);
  });

  it.each(["s-reginald-theft", "s-archibald-false-alibi", "s-gregory-saw-victoria"])("any one of the alibi cracks (%s) closes the lead and opens the gate", async (secret) => {
    const g = ready();
    g.revealedSecretIds = [...g.revealedSecretIds, secret];
    expect(accuseProgress(c, g).unlocked).toBe(true);
    expect((await accuse(g)).status).not.toBe(403);
  });

  it("the lead line outranks nothing: a missing clue is reported before the alibi", () => {
    const g = ready();
    g.discoveredEvidenceIds = ["silver-candlestick"];
    expect(accuseProgress(c, g).line).toMatch(/hunch and a hat/);
  });
});
