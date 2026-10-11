/**
 * Cross-secret leaks (Dexter's find after #51): a fact unlocked by secret A must not carry a phrase the speaker's
 * forbiddenPhrases gate on secret B. Since #51 the reveal turn's context includes A's own facts, so such a fact is in
 * WHAT YOU KNOW on that turn, the model repeats it, the guard rejects it and the turn ends in the canned fallback
 * (s-archibald-breakdown: loc-archibald-2115..2117 said "to his broker", which belongs to s-archibald-embezzlement).
 *
 * Generic sweep: for every character and every revealable secret A, in the state "A's prerequisites revealed and A
 * revealing this exchange" (and again with A already revealed), nothing the model is given (visible facts, beliefs,
 * revealed secret descriptions, A's own testimony summary) may match a live forbidden phrase.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { findForbiddenPhrase } from "@/ai/forbidden-phrases";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

/** A secret and every secret it requires first (afterSecretIds / revealConditions.afterSecretIds), prerequisites first. */
function chain(chId: string, secretId: string): string[] {
  const ch = c.characters.find((x) => x.id === chId)!;
  const s = ch.secrets.find((x) => x.id === secretId)!;
  const before = [...((s as { afterSecretIds?: string[] }).afterSecretIds ?? []), ...(s.revealConditions?.afterSecretIds ?? [])];
  return [...new Set([...before.flatMap((b) => chain(chId, b)), secretId])];
}

/** Every text the model is handed for `chId` with `revealed` already admitted and `revealing` admitted this exchange. */
function surface(chId: string, revealed: string[], revealing: string[]) {
  const g = createInitialGameState(c);
  g.characters[chId].revealedSecretIds = [...revealed];
  g.revealedSecretIds = [...revealed];
  const ctx = buildCharacterContext({ caseData: c, game: g }, chId, { revealingSecretIds: revealing });
  const ch = c.characters.find((x) => x.id === chId)!;
  const own = [...revealed, ...revealing];
  return [
    ...ctx.knowledge.map((k) => ({ where: `fact ${k.id}`, text: k.statement })),
    ...ctx.beliefs.map((b) => ({ where: `belief ${b.id}`, text: b.statement })),
    ...ctx.secrets.map((s) => ({ where: `secret ${s.id}`, text: s.description })),
    ...ch.secrets.filter((s) => own.includes(s.id) && s.testimonySummary).map((s) => ({ where: `testimony ${s.id}`, text: s.testimonySummary! })),
  ];
}

function hits(chId: string, revealed: string[], revealing: string[]) {
  const ch = c.characters.find((x) => x.id === chId)!;
  const live = [...revealed, ...revealing];
  return surface(chId, revealed, revealing)
    .map((s) => ({ ...s, hit: findForbiddenPhrase(s.text, ch.forbiddenPhrases, live) }))
    .filter((s) => s.hit)
    .map((s) => `${chId} ${s.where}: "${s.hit!.match}" (gated on ${s.hit!.phrase.unlessRevealed ?? "always"}) in: ${s.text}`);
}

describe("Archibald's false-alibi reveal turn (s-archibald-breakdown regression)", () => {
  it("with the embezzlement locked, nothing he is given mentions the broker, the money or moving it", () => {
    expect(hits("archibald", [], ["s-archibald-false-alibi"])).toEqual([]);
    expect(hits("archibald", ["s-archibald-false-alibi"], [])).toEqual([]);
    const text = surface("archibald", [], ["s-archibald-false-alibi"]).map((s) => s.text).join("\n");
    expect(text).not.toMatch(/\bbrokers?\b|embezzl|company\s+money|before\s+midnight/i);
    // He still knows what the admission concedes: the telephone 21:15-21:20 and the butler at 21:18.
    const ids = surface("archibald", [], ["s-archibald-false-alibi"]).map((s) => s.where);
    for (const id of ["loc-archibald-2115", "loc-archibald-2116", "loc-archibald-2117", "loc-archibald-2118", "loc-archibald-2120", "ev-pantry-exchange"]) expect(ids).toContain(`fact ${id}`);
    expect(ids).not.toContain("fact ev-archibald-phone");
  });

  it("the broker content lives only in facts linked to s-archibald-embezzlement and opens with it", () => {
    const arch = c.characters.find((x) => x.id === "archibald")!;
    const broker = [...c.facts, ...c.timeline].filter((f) => /\bbrokers?\b/i.test(f.statement)).map((f) => f.id);
    expect(broker).toEqual(["ev-archibald-phone"]);
    const linkedTo = arch.secrets.filter((s) => s.relatedFactIds.includes("ev-archibald-phone") || false).map((s) => s.id);
    expect(linkedTo).toEqual(["s-archibald-embezzlement"]);
    const ids = surface("archibald", ["s-archibald-false-alibi"], ["s-archibald-embezzlement"]).map((s) => s.where);
    expect(ids).toContain("fact ev-archibald-phone");
  });

  it("Reginald's 'moving it all before midnight' stays gated behind his theft admission", () => {
    const fresh = surface("reginald", [], []).map((s) => s.where);
    expect(fresh).not.toContain("fact ev-reginald-hears-phone");
    expect(surface("reginald", [], ["s-reginald-theft"]).map((s) => s.where)).toContain("fact ev-reginald-hears-phone");
  });
});

describe("generic sweep: a fact unlocked by secret A never carries a phrase gated on secret B", () => {
  it("every character, every revealable secret, on the reveal turn and after it", () => {
    const core = coreGuiltSecretIds(c);
    const found: string[] = [];
    for (const ch of c.characters) {
      found.push(...hits(ch.id, [], []));
      for (const s of ch.secrets.filter((x) => !core.has(x.id))) {
        const ids = chain(ch.id, s.id);
        const before = ids.slice(0, -1);
        found.push(...hits(ch.id, before, [s.id]), ...hits(ch.id, ids, []));
      }
      const all = ch.secrets.filter((x) => !core.has(x.id)).map((x) => x.id);
      found.push(...hits(ch.id, all, []));
    }
    expect([...new Set(found)]).toEqual([]);
  });
});
