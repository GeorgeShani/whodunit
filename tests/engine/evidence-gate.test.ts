/**
 * hiddenUntil.evidenceIds: a fact stays out of context until the listed
 * evidence is found or shown (same rule as guard.gatedTopics). The fixture
 * mimics Tallyho's ev-chart-flip / heel-chart / Ottilie, without editing cases/.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences, formatIssue } from "@/engine/case-validation";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { searchLocation } from "@/engine/investigation";
import { knowledgeGate } from "@/engine/knowledge-gate";
import { EvidenceSchema, FactSchema, HiddenUntilSchema, LocationSchema } from "@/engine/types";
import { encodeStateToken } from "@/engine/state-token";
import { FIXTURES_DIR } from "../helpers/fixture";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let base: LoadedCase;
beforeAll(async () => {
  base = await loadCase("harbor-light", FIXTURES_DIR);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const FLIP = "The heel chart was flipped to hide the true course.";

/** Harbor-light plus an Ottilie-like gate: ev-chart-flip hidden until heel-chart is found in the engine room. */
function withChartGate(): LoadedCase {
  const c = structuredClone(base);
  c.locations.push(
    LocationSchema.parse({ id: "engine-room", name: "The Engine Room", description: "Pistons and a chart table." }),
  );
  c.evidence.push(
    EvidenceSchema.parse({
      id: "heel-chart",
      name: "Heel Chart",
      description: "A chart of the ship's heel, penciled at the edges.",
      kind: "document",
      locationId: "engine-room",
      initiallyAvailable: false,
    }),
  );
  c.facts.push(
    FactSchema.parse({
      id: "ev-chart-flip",
      statement: FLIP,
      category: "object",
      hiddenUntil: { evidenceIds: ["heel-chart"] },
    }),
  );
  c.characters.find((x) => x.id === "cook-marlow")!.knownFactIds.push("ev-chart-flip");
  return c;
}

const known = (c: LoadedCase, game = createInitialGameState(c), who = "cook-marlow") =>
  buildCharacterContext({ caseData: c, game }, who).knowledge.map((k) => k.id);

describe("HiddenUntilSchema evidenceIds", () => {
  it("accepts evidenceIds alone, keeps secretIds-only facts backward compatible, and rejects an empty gate", () => {
    expect(HiddenUntilSchema.parse({ evidenceIds: ["heel-chart"] })).toMatchObject({
      secretIds: [],
      lieIds: [],
      evidenceIds: ["heel-chart"],
    });
    const secretsOnly = HiddenUntilSchema.parse({ secretIds: ["s-reginald-theft"] });
    expect(secretsOnly).toEqual({ secretIds: ["s-reginald-theft"], lieIds: [] });
    expect(secretsOnly).not.toHaveProperty("evidenceIds");
    expect(HiddenUntilSchema.safeParse({}).success).toBe(false);
    expect(HiddenUntilSchema.safeParse({ secretIds: [], lieIds: [], evidenceIds: [] }).success).toBe(false);
  });

  it("the validator reports unknown evidence ids", () => {
    const c = withChartGate();
    const fact = c.facts.find((f) => f.id === "ev-chart-flip")!;
    fact.hiddenUntil = { secretIds: [], lieIds: [], evidenceIds: ["ghost-chart"] };
    const out = checkCaseReferences(c).map(formatIssue).join("\n");
    expect(out).toMatch(/hiddenUntil\.evidenceIds\.0: unknown evidence "ghost-chart"/);
  });
});

describe("Gremlin's Ottilie checks, on a fixture that mimics ev-chart-flip", () => {
  it("before the engine-room search the fact is not in her context", () => {
    const c = withChartGate();
    const game = createInitialGameState(c);
    expect(game.discoveredEvidenceIds).not.toContain("heel-chart");
    expect(known(c, game, "cook-marlow")).not.toContain("ev-chart-flip");
  });

  it("after the engine-room search the fact is in her context", () => {
    const c = withChartGate();
    const game = createInitialGameState(c);
    const found = searchLocation(c, game, "engine-room");
    expect(found.newlyFound.map((e) => e.id)).toContain("heel-chart");
    expect(game.discoveredEvidenceIds).toContain("heel-chart");
    expect(known(c, game, "cook-marlow")).toContain("ev-chart-flip");
  });

  it("confronting her with the found chart still works", async () => {
    const c = withChartGate();
    const game = createInitialGameState(c);
    searchLocation(c, game, "engine-room");
    mockGrok({ content: goodReply({ dialogue: "I will look at that chart." }) }, { content: goodReply({ dialogue: "I was not in the engine room." }) });
    const prompts: string[] = [];
    const r = await handleConfront(
      {
        caseId: c.id,
        characterIds: ["cook-marlow", "finch"],
        question: "Explain this chart.",
        presentedEvidenceId: "heel-chart",
        stateToken: encodeStateToken(game, TEST_ENV),
      },
      { caseData: c, env: TEST_ENV, onPrompt: (p) => prompts.push(`${p.system}\n${p.user}`) },
    );
    expect(r.status).toBe(200);
    expect(r.body.error).toBeUndefined();
    expect(r.body.lines?.length).toBeGreaterThan(0);
    const joined = prompts.join("\n");
    expect(joined).toContain(FLIP);
    expect(joined).toMatch(/heel chart/i);
  });

  it("does not leak the fact into other characters, even after the search", () => {
    const c = withChartGate();
    const game = createInitialGameState(c);
    expect(known(c, game, "keeper-quill")).not.toContain("ev-chart-flip");
    expect(known(c, game, "finch")).not.toContain("ev-chart-flip");
    searchLocation(c, game, "engine-room");
    expect(known(c, game, "cook-marlow")).toContain("ev-chart-flip");
    expect(known(c, game, "keeper-quill")).not.toContain("ev-chart-flip");
    expect(known(c, game, "finch")).not.toContain("ev-chart-flip");
  });

  it("also lifts the fact when the clue is shown, matching gatedTopics found-or-shown", () => {
    const c = withChartGate();
    const cook = c.characters.find((x) => x.id === "cook-marlow")!;
    const game = createInitialGameState(c);
    expect(knowledgeGate(c, cook, game.characters["cook-marlow"], game.characters).withheldFactIds.has("ev-chart-flip")).toBe(true);
    // Shown in signed state, not yet in discoveredEvidenceIds (the guard treats shown as found).
    game.characters["cook-marlow"].evidenceShownIds = ["heel-chart"];
    expect(knowledgeGate(c, cook, game.characters["cook-marlow"], game.characters).withheldFactIds.has("ev-chart-flip")).toBe(false);
  });
});
