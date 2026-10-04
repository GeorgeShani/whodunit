/** Regression tests for QA issue #27 (confrontation hygiene, per-pair jabs/defensiveOn) on the real Blackwood case. */
import { beforeAll, describe, expect, it } from "vitest";
import { addressesWrongPerson, repeatsEarlier, scrubStalePartners } from "@/ai/confront-check";
import { buildSystemPrompt, buildUserMessage } from "@/ai/prompts/interrogation";
import { loadCase } from "@/engine/case-loader";
import { checkCaseReferences } from "@/engine/case-validation";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { RelationshipSchema } from "@/engine/types";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

function victoriaAfterGregory() {
  const game = createInitialGameState(c);
  const rt = game.characters.victoria;
  rt.memory.push(
    { turn: 1, speaker: "player", text: "(Face to face with Gregory) Where were you?" },
    { turn: 1, speaker: "character", text: "Gregory, you filthy liar, you were in the garden all night long!" },
    { turn: 2, speaker: "player", text: "Where were you at nine?" },
    { turn: 2, speaker: "character", text: "In the dining room with my husband, as I said." },
  );
  game.turn = 3;
  return buildCharacterContext({ caseData: c, game }, "victoria");
}

describe("schema (#27)", () => {
  it("accepts jabs and defensiveOn, and rejects unknown keys", () => {
    const base = { targetCharacterId: "x", trust: 1, fear: 1, affection: 1, resentment: 1, suspicion: 1 };
    const ok = RelationshipSchema.parse({ ...base, jabs: [{ text: "You and your brandy." }], defensiveOn: [{ topic: "money", text: "snaps" }] });
    expect(ok.jabs?.[0].when).toBe("any");
    expect(RelationshipSchema.safeParse({ ...base, jabs: [{ text: "x", nope: 1 }] }).success).toBe(false);
  });
  it("validator: an unknown jab aboutFactId is an error", () => {
    const bad = structuredClone(c);
    bad.characters[0].relationships[0] = { ...bad.characters[0].relationships[0], jabs: [{ text: "Ha.", aboutFactId: "nope", when: "any" }] };
    expect(checkCaseReferences(bad).some((i) => i.message.includes('unknown fact "nope"'))).toBe(true);
  });
});

describe("prompt (#27)", () => {
  it("uses only the character's own relationship jabs, fact-bound ones only when known", () => {
    const game = createInitialGameState(c);
    const ch = c.characters.find((x) => x.id === "victoria")!;
    const partner = c.characters.find((x) => x.id === "archibald")!;
    const known = buildCharacterContext({ caseData: c, game }, "victoria");
    const rel = known.relationships.find((r) => r.targetCharacterId === partner.id)!;
    expect(ch.relationships.some((r) => r.targetCharacterId === partner.id)).toBe(true);
    rel.jabs = [
      { text: "UNBOUND-JAB", when: "confrontation" },
      { text: "UNKNOWN-FACT-JAB", aboutFactId: "never-heard-of-it", when: "any" },
    ];
    rel.defensiveOn = [{ topic: "the brandy", text: "goes stiff" }];
    const sys = buildSystemPrompt(known, { exposedLieIds: [], confrontation: { partnerName: partner.name, role: "reacting", partnerLine: "You lie." } });
    expect(sys).toContain("UNBOUND-JAB");
    expect(sys).not.toContain("UNKNOWN-FACT-JAB");
    expect(sys).toContain("the brandy (goes stiff)");
    expect(sys).toContain("Answer " + partner.name);
    expect(sys).toContain("Never repeat a sentence");
    expect(sys).toContain(`Speak ONLY to ${partner.name}`);
  });
  it("shows no jabs outside a confrontation", () => {
    const ctx = buildCharacterContext({ caseData: c, game: createInitialGameState(c) }, "victoria");
    ctx.relationships[0].jabs = [{ text: "UNBOUND-JAB", when: "confrontation" }];
    expect(buildSystemPrompt(ctx, { exposedLieIds: [] })).not.toContain("UNBOUND-JAB");
  });
});

describe("stale partner names (#27)", () => {
  it("blanks the previous partner's name when facing someone else", () => {
    const ctx = victoriaAfterGregory();
    const user = buildUserMessage(ctx, "Well?", { partnerName: "Archibald Crane" });
    expect(user).not.toMatch(/Gregory/);
    expect(user).toContain("the other person");
    expect(user).toContain("In the dining room with my husband");
  });
  it("keeps the names when facing the same partner again", () => {
    const ctx = victoriaAfterGregory();
    expect(buildUserMessage(ctx, "Well?", { partnerName: "Gregory" })).toMatch(/Gregory/);
    expect(scrubStalePartners(ctx, "Gregory")).toEqual(ctx.memory);
  });
  it("is untouched outside confrontations", () => {
    expect(buildUserMessage(victoriaAfterGregory(), "Well?")).toMatch(/Gregory/);
  });
});

describe("checks (#27)", () => {
  it("rejects a sentence already said face to face, accepts a new one", () => {
    const ctx = victoriaAfterGregory();
    expect(repeatsEarlier("You were in the garden all night long! And you know it.", ctx)).toBeNull(); // different words
    expect(repeatsEarlier("Gregory, you filthy liar, you were in the garden all night long!", ctx)).toBeTruthy();
    expect(repeatsEarlier("In the dining room with my husband, as I said.", ctx)).toBeNull(); // one-on-one story, may be repeated
  });
  it("rejects addressing a third person by name", () => {
    const ctx = victoriaAfterGregory();
    expect(addressesWrongPerson("Gregory, how dare you!", ctx, "Archibald Crane")).toBeTruthy();
    expect(addressesWrongPerson("You mean it, Gregory?", ctx, "Archibald Crane")).toBeTruthy();
    expect(addressesWrongPerson("I saw Gregory in the garden.", ctx, "Archibald Crane")).toBeNull();
    expect(addressesWrongPerson("Gregory, how dare you!", ctx, "Gregory")).toBeNull();
    expect(addressesWrongPerson("Archibald, darling, say something.", ctx, "Archibald Crane")).toBeNull();
  });
});
