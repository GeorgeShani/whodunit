import { beforeAll, describe, expect, it } from "vitest";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { addContradiction, contradictionLines, itemKey, itemName, presentQuestion, whereFound } from "@/components/evidence/notebook-model";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { encodeStateToken } from "@/engine/state-token";
import { deepScan } from "../helpers/leak-scan";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const token = (discovered: string[], revealed: Record<string, string[]> = {}) => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push(...discovered);
  for (const [who, ids] of Object.entries(revealed)) {
    g.characters[who].revealedSecretIds.push(...ids);
    g.revealedSecretIds.push(...ids);
  }
  return encodeStateToken(g, TEST_ENV);
};
const run = (body: Record<string, unknown>, env: Record<string, string | undefined> = TEST_ENV) => handleInterrogate(body, { caseData: c, env });

describe("present evidence: deterministic contradictions (Phase 5)", () => {
  it("a clue that breaks a lie returns the engine's contradiction verdict", async () => {
    mockGrok({ content: goodReply({ dialogue: "Where did you get that?!", emotion: "shocked" }) });
    const r = await run({ characterId: "victoria", question: "Explain this.", presentedEvidenceId: "library-key", stateToken: token(["library-key"]) });
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("model");
    expect(r.body.contradiction).toEqual({
      characterId: "victoria",
      characterName: "Victoria Blackwood",
      item: { kind: "evidence", id: "library-key" },
      lieCount: 3,
    });
  });

  it("only the first time: showing the same clue again is not a new contradiction", async () => {
    mockGrok({});
    const first = await run({ characterId: "gregory", question: "Look.", presentedEvidenceId: "muddy-footprint", stateToken: token(["muddy-footprint"]) });
    expect(first.body.contradiction?.lieCount).toBe(1);
    const again = await run({ characterId: "gregory", question: "Look again.", presentedEvidenceId: "muddy-footprint", stateToken: first.body.stateToken });
    expect(again.body.contradiction).toBeUndefined();
  });

  it("an irrelevant item gets a normal model reply and no contradiction", async () => {
    const { calls } = mockGrok({ content: goodReply({ dialogue: "A candlestick, sir? It's a candlestick." }) });
    const r = await run({ characterId: "gregory", question: "Seen this?", presentedEvidenceId: "silver-candlestick", stateToken: token(["silver-candlestick"]) });
    expect(r.body.source).toBe("model");
    expect(r.body.response.dialogue).toBe("A candlestick, sir? It's a candlestick.");
    expect(r.body.contradiction).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("testimony that breaks a lie is a contradiction too", async () => {
    mockGrok({});
    const r = await run({
      characterId: "victoria",
      question: "Gregory saw you.",
      presentedTestimonyId: "s-gregory-saw-victoria",
      stateToken: token([], { gregory: ["s-gregory-in-hall", "s-gregory-saw-victoria"] }),
    });
    expect(r.body.contradiction).toMatchObject({ characterId: "victoria", item: { kind: "testimony", id: "s-gregory-saw-victoria" } });
    expect(r.body.contradiction!.lieCount).toBeGreaterThanOrEqual(3);
  });

  it("the verdict is the engine's, so it stands even when the model is unavailable (fallback reply)", async () => {
    mockGrok({});
    const r = await run(
      { characterId: "victoria", question: "Explain this.", presentedEvidenceId: "burned-letter", stateToken: token(["burned-letter"]) },
      { GAME_STATE_SECRET: TEST_ENV.GAME_STATE_SECRET },
    );
    expect(r.body.source).toBe("fallback");
    expect(r.body.contradiction?.item.id).toBe("burned-letter");
  });

  it("the verdict names no lie, secret or solution detail", async () => {
    mockGrok({});
    const r = await run({ characterId: "victoria", question: "Explain.", presentedEvidenceId: "library-key", stateToken: token(["library-key"]) });
    const { keys, strings } = deepScan(r.body.contradiction);
    expect([...keys].sort()).toEqual(["characterId", "characterName", "id", "item", "kind", "lieCount"]);
    for (const l of c.characters.flatMap((ch) => ch.intendedLies)) {
      expect(strings.has(l.id)).toBe(false);
    }
  });
});

describe("notebook model", () => {
  const ev = [{ id: "library-key", name: "Library key", locationId: "dining-room" }];
  const t = [{ id: "s-x", characterName: "Gregory", summary: "I saw her." }];
  it("notes contradictions per card, idempotently", () => {
    const c1 = { characterId: "victoria", characterName: "Lady Victoria Blackwood", item: { kind: "evidence" as const, id: "library-key" }, lieCount: 3 };
    let notes = addContradiction({}, c1);
    expect(addContradiction(notes, c1)).toBe(notes);
    notes = addContradiction(notes, { ...c1, characterId: "archibald", characterName: "Archibald Crane" });
    expect(contradictionLines(notes, { kind: "evidence", id: "library-key" })).toEqual([
      "Contradicts Lady Victoria Blackwood's story",
      "Contradicts Archibald Crane's story",
    ]);
    expect(contradictionLines(notes, { kind: "testimony", id: "library-key" })).toEqual([]);
    expect(itemKey({ kind: "testimony", id: "s-x" })).toBe("testimony:s-x");
  });
  it("names items, where they were found, and the present line", () => {
    expect(whereFound(ev[0], [{ id: "dining-room", name: "The Dining Room" }])).toBe("Found in The Dining Room");
    expect(whereFound({ locationId: "nowhere" }, [])).toBe("In the case file");
    expect(itemName({ kind: "evidence", id: "library-key" }, ev, t)).toBe("Library key");
    expect(itemName({ kind: "testimony", id: "s-x" }, ev, t)).toBe("Gregory's testimony");
    expect(presentQuestion({ kind: "evidence", id: "library-key" }, ev, t)).toBe("Care to explain this? (Library key)");
    expect(presentQuestion({ kind: "testimony", id: "s-x" }, ev, t)).toContain('Gregory has told me this: "I saw her."');
  });
});
