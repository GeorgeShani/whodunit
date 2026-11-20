/**
 * H5 (Gremlin r8/r9): Bilge lists f-zippelli-trunk-bilge in knownFactIds, with the same wording as
 * Zippelli's own trunk fact. A phrase block is not enough: the fact must be absent from
 * buildCharacterContext at game start, and present only after l-zippelli-trunk is broken
 * (crock-13 shown to Zippelli). hiddenUntil already authors that gate (T-60); this locks it.
 * Skips without the local, gitignored cases/tallyho/solution.json.
 */
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCharacterContext } from "@/engine/context-builder";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import type { GameState } from "@/engine/types";

const HAS_SOLUTION = existsSync("cases/tallyho/solution.json");
const TRUNK = "f-zippelli-trunk-bilge";
const TRUNK_WORDS = /false wall|padded trays for ['']cargo['']/i;

let c: LoadedCase;
describe.skipIf(!HAS_SOLUTION)("Tallyho H5: Bilge's Zippelli trunk fact is gated", () => {
  beforeAll(async () => {
    c = await loadCase("tallyho");
  });

  it("is in his knownFactIds and hiddenUntil l-zippelli-trunk, not his own smuggling secret", () => {
    const bilge = c.characters.find((ch) => ch.id === "bilge")!;
    expect(bilge.knownFactIds).toContain(TRUNK);
    const fact = c.facts.find((f) => f.id === TRUNK)!;
    expect(fact.statement).toMatch(TRUNK_WORDS);
    expect(fact.hiddenUntil).toEqual({ secretIds: [], lieIds: ["l-zippelli-trunk"] });
    expect(bilge.secrets.find((s) => s.id === "s-bilge-smuggling")!.relatedFactIds).not.toContain(TRUNK);
  });

  it("is absent from buildCharacterContext at game start, wording included", () => {
    const ctx = buildCharacterContext({ caseData: c, game: createInitialGameState(c) }, "bilge");
    expect(ctx.knowledge.map((k) => k.id)).not.toContain(TRUNK);
    expect(JSON.stringify(ctx)).not.toMatch(TRUNK_WORDS);
  });

  it("is still absent after only his own smuggling secret is revealed", () => {
    const game = revealBilgeSmuggling(createInitialGameState(c));
    const ctx = buildCharacterContext({ caseData: c, game }, "bilge");
    expect(ctx.knowledge.map((k) => k.id)).not.toContain(TRUNK);
    expect(JSON.stringify(ctx)).not.toMatch(TRUNK_WORDS);
    expect(ctx.knowledge.map((k) => k.id)).toContain("f-route-dawn-bilge");
  });

  it("is present after crock-13 is shown to Zippelli, which breaks l-zippelli-trunk", () => {
    const game = breakZippelliTrunk(createInitialGameState(c));
    const ctx = buildCharacterContext({ caseData: c, game }, "bilge");
    expect(ctx.knowledge.map((k) => k.id)).toContain(TRUNK);
    expect(ctx.knowledge.find((k) => k.id === TRUNK)!.statement).toMatch(TRUNK_WORDS);
  });
});

function revealBilgeSmuggling(game: GameState): GameState {
  if (!game.discoveredEvidenceIds.includes("route-sheet")) game.discoveredEvidenceIds.push("route-sheet");
  const rt = game.characters.bilge;
  if (!rt.evidenceShownIds.includes("route-sheet")) rt.evidenceShownIds.push("route-sheet");
  if (!rt.revealedSecretIds.includes("s-bilge-smuggling")) rt.revealedSecretIds.push("s-bilge-smuggling");
  if (!game.revealedSecretIds.includes("s-bilge-smuggling")) game.revealedSecretIds.push("s-bilge-smuggling");
  return game;
}

function breakZippelliTrunk(game: GameState): GameState {
  if (!game.discoveredEvidenceIds.includes("crock-13")) game.discoveredEvidenceIds.push("crock-13");
  const rt = game.characters.zippelli;
  if (!rt.evidenceShownIds.includes("crock-13")) rt.evidenceShownIds.push("crock-13");
  return game;
}
