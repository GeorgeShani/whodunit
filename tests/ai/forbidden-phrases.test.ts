/** #46 per-character forbiddenPhrases: schema, validator, matching rules and guard enforcement (fixture case). */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply } from "@/ai/guard";
import { compileForbiddenPhrase, findForbiddenPhrase } from "@/ai/forbidden-phrases";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences as validateCase } from "@/engine/case-validation";
import { createInitialGameState } from "@/engine/game-state";
import { CharacterSchema, ForbiddenPhraseSchema } from "@/engine/types";
import { FIXTURES_DIR } from "../helpers/fixture";

let hl: LoadedCase;
beforeAll(async () => {
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});

describe("schema", () => {
  it("defaults to an empty list and regex:false", () => {
    expect(ForbiddenPhraseSchema.parse({ text: "x" })).toEqual({ text: "x", regex: false });
    const marlow = hl.characters.find((c) => c.id === "cook-marlow")!;
    expect(marlow.forbiddenPhrases.length).toBe(2);
    expect(hl.characters.find((c) => c.id === "keeper-quill")!.forbiddenPhrases).toEqual([]);
  });
  it("rejects an invalid regex and unknown keys", () => {
    expect(ForbiddenPhraseSchema.safeParse({ text: "(unclosed", regex: true }).success).toBe(false);
    expect(ForbiddenPhraseSchema.safeParse({ text: "(unclosed" }).success).toBe(true); // plain text is escaped
    expect(ForbiddenPhraseSchema.safeParse({ text: "x", bogus: 1 }).success).toBe(false);
    expect(CharacterSchema.shape.forbiddenPhrases).toBeDefined();
  });
  it("validator: unlessRevealed must be the speaker's own secret", () => {
    const bad = structuredClone(hl);
    bad.characters.find((c) => c.id === "finch")!.forbiddenPhrases.push({ text: "rum", regex: false, unlessRevealed: "marlow-secret" });
    expect(validateCase(bad).some((i) => /forbiddenPhrases\.\d+\.unlessRevealed/.test(i.path) && /unknown own secret/.test(i.message))).toBe(true);
    expect(validateCase(hl).filter((i) => i.path.includes("forbiddenPhrases"))).toEqual([]);
  });
});

describe("matching", () => {
  const P = (text: string, regex = false, unlessRevealed?: string) => ({ text, regex, ...(unlessRevealed ? { unlessRevealed } : {}) });
  it("plain text: case-insensitive whole words, any whitespace", () => {
    expect(findForbiddenPhrase("I SMUGGLE   Rum, aye.", [P("smuggle rum")], [])).not.toBeNull();
    expect(findForbiddenPhrase("They smuggle rumour about.", [P("smuggle rum")], [])).toBeNull();
    expect(findForbiddenPhrase("Contraband? I don't smuggle.", [P("smuggle rum")], [])).toBeNull();
  });
  it("regex: native RegExp with 'i' (lookbehind works)", () => {
    const re = P("(?<!\\bnever\\s)\\bsaw\\s+her\\b", true);
    expect(compileForbiddenPhrase(re).flags).toContain("i");
    expect(findForbiddenPhrase("I SAW HER, sir.", [re], [])).not.toBeNull();
    expect(findForbiddenPhrase("I never saw her, sir.", [re], [])).toBeNull();
  });
  it("unlessRevealed lifts the entry once the secret is revealed", () => {
    expect(findForbiddenPhrase("I smuggle rum.", [P("smuggle rum", false, "s1")], ["s1"])).toBeNull();
    expect(findForbiddenPhrase("I smuggle rum.", [P("smuggle rum", false, "s1")], ["s2"])).not.toBeNull();
  });
});

describe("guard enforcement", () => {
  function marlowTurn(revealed: string[] = [], move: Record<string, string> = {}) {
    const g = createInitialGameState(hl);
    g.discoveredEvidenceIds = hl.evidence.map((e) => e.id);
    g.characters["cook-marlow"].revealedSecretIds = revealed;
    g.revealedSecretIds = [...revealed];
    return prepareTurn({ caseData: hl, game: g, characterId: "cook-marlow", question: "What do you keep in the galley?", move });
  }
  it("rejects a match with forbidden_phrase (a contract reason)", () => {
    expect(checkReply({ dialogue: "Fine, I smuggle rum for the captain.", admits: [] }, marlowTurn().guard)?.reason).toBe("forbidden_phrase");
    expect(checkReply({ dialogue: "Aye, I saw the keeper down at the dock throw something in.", admits: [] }, marlowTurn().guard)?.reason).toBe("forbidden_phrase");
  });
  it("lifted once the secret was revealed earlier", () => {
    expect(checkReply({ dialogue: "I smuggle rum for the captain, as I told you.", admits: [] }, marlowTurn(["marlow-secret"]).guard)?.reason).not.toBe("forbidden_phrase");
  });
  it("a secret revealed in the CURRENT exchange counts as revealed", () => {
    const evId = hl.characters.find((c) => c.id === "cook-marlow")!.secrets.find((s) => s.id === "marlow-secret")!.revealConditions?.evidenceIds[0];
    const p = evId ? marlowTurn([], { presentedEvidenceId: evId }) : null;
    if (p && p.plan.revealSecretId === "marlow-secret") {
      expect(checkReply({ dialogue: "All right! I smuggle rum for the captain.", admits: ["marlow-secret"] }, p.guard)?.reason).not.toBe("forbidden_phrase");
    } else {
      // Fall back to forcing the directive: the guard reads directives.revealSecret.
      const q = marlowTurn();
      q.guard.directives = { ...q.guard.directives, revealSecret: { id: "marlow-secret", description: "x" } } as typeof q.guard.directives;
      expect(checkReply({ dialogue: "All right! I smuggle rum for the captain.", admits: ["marlow-secret"] }, q.guard)?.reason).not.toBe("forbidden_phrase");
    }
  });
});
