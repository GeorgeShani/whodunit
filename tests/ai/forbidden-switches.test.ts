/** E12/E13: forbidden phrases switched on by a revealed secret, and lifted by any character's secret or a shown card. */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply } from "@/ai/guard";
import { findForbiddenPhrase, forbiddenStateOf } from "@/ai/forbidden-phrases";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences as validateCase, checkCaseWarnings } from "@/engine/case-validation";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { ForbiddenPhraseSchema, type ForbiddenPhrase } from "@/engine/types";
import { FIXTURES_DIR } from "../helpers/fixture";

let hl: LoadedCase;
beforeAll(async () => {
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});
const P = (text: string, extra: Partial<ForbiddenPhrase> = {}): ForbiddenPhrase => ({ text, regex: false, ...extra });
const issuesAt = (c: LoadedCase, key: string) => validateCase(c).filter((i) => (i.path ?? "").includes(key));

/** A Marlow turn with his own revealed secrets, other characters' revealed secrets and shown items. */
function turn(c: LoadedCase, o: { own?: string[]; others?: string[]; reveal?: boolean } = {}) {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds = c.evidence.map((e) => e.id);
  g.characters["cook-marlow"].revealedSecretIds = o.own ?? [];
  for (const id of o.others ?? []) {
    const owner = c.characters.find((ch) => ch.secrets.some((s) => s.id === id))!;
    g.characters[owner.id].revealedSecretIds.push(id);
  }
  g.revealedSecretIds = [...(o.own ?? []), ...(o.others ?? [])];
  return prepareTurn({ caseData: c, game: g, characterId: "cook-marlow", question: "Where were you?" });
}
function withPhrase(fp: ForbiddenPhrase): LoadedCase {
  const c = structuredClone(hl);
  c.characters.find((ch) => ch.id === "cook-marlow")!.forbiddenPhrases.push(fp);
  return c;
}
const LINE = { dialogue: "I was in the galley scrubbing pots all night, sir.", admits: [] as string[] };

describe("E12 onlyAfterRevealed", () => {
  it("schema: a non-empty id list", () => {
    expect(ForbiddenPhraseSchema.safeParse(P("x", { onlyAfterRevealed: ["a"] })).success).toBe(true);
    expect(ForbiddenPhraseSchema.safeParse(P("x", { onlyAfterRevealed: [] })).success).toBe(false);
  });
  it("matching: off until a listed secret is revealed, then on", () => {
    const fp = P("scrubbing pots", { onlyAfterRevealed: ["s1", "s2"] });
    expect(findForbiddenPhrase(LINE.dialogue, [fp], [])).toBeNull();
    expect(findForbiddenPhrase(LINE.dialogue, [fp], ["s9"])).toBeNull();
    expect(findForbiddenPhrase(LINE.dialogue, [fp], ["s2"])).not.toBeNull();
    expect(findForbiddenPhrase(LINE.dialogue, [fp], { revealedIds: ["s1"] })).not.toBeNull();
  });
  it("guard: the broken story passes before the reveal and is rejected after it (own secret)", () => {
    const c = withPhrase(P("scrubbing pots", { onlyAfterRevealed: ["marlow-secret"] }));
    expect(checkReply(LINE, turn(c).guard)?.reason).not.toBe("forbidden_phrase");
    expect(checkReply(LINE, turn(c, { own: ["marlow-secret"] }).guard)?.reason).toBe("forbidden_phrase");
  });
  it("guard: switched on by ANOTHER character's revealed secret too", () => {
    const c = withPhrase(P("scrubbing pots", { onlyAfterRevealed: ["finch-secret"] }));
    expect(checkReply(LINE, turn(c).guard)?.reason).not.toBe("forbidden_phrase");
    const t = turn(c, { others: ["finch-secret"] });
    expect(forbiddenStateOf(t.guard).revealedIds).toContain("finch-secret");
    expect(checkReply(LINE, t.guard)?.reason).toBe("forbidden_phrase");
  });
  it("validator: unknown ids are errors; switch-and-lift on the same id is an error; all-core is a warning", () => {
    expect(issuesAt(withPhrase(P("x", { onlyAfterRevealed: ["nope"] })), "onlyAfterRevealed").some((i) => /unknown secret/.test(i.message))).toBe(true);
    expect(issuesAt(withPhrase(P("x", { onlyAfterRevealed: ["marlow-secret"], unlessRevealed: "marlow-secret" })), "onlyAfterRevealed").some((i) => /never applies/.test(i.message))).toBe(true);
    expect(issuesAt(withPhrase(P("x", { onlyAfterRevealed: ["finch-secret"] })), "forbiddenPhrases")).toEqual([]);
    const core = [...coreGuiltSecretIds(hl)][0]!;
    const w = checkCaseWarnings(withPhrase(P("x", { onlyAfterRevealed: [core] })));
    expect(w.some((x) => (x.path ?? "").includes("onlyAfterRevealed") && /never applies/.test(x.message))).toBe(true);
  });
});
