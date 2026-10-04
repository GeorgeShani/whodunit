/** Regression tests for QA issue #27 (confrontation hygiene, per-pair jabs/defensiveOn) on the real Blackwood case. */
import { beforeAll, describe, expect, it } from "vitest";
import { addressesWrongPerson, avoidPhrasingsBlock, nearDuplicate, repeatsEarlier, scrubStalePartners, variedConfrontationFallback } from "@/ai/confront-check";
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
    expect(repeatsEarlier("I never trusted you anywhere near the decanters. And you know it.", ctx)).toBeNull(); // new words
    expect(repeatsEarlier("You were in the garden all night long! And you know it.", ctx)).toBeTruthy(); // a clipped copy is still a repeat
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

// The exact line Gremlin's round 3 saw repeated almost word for word in 2 of 3 exchanges (#27 leftover).
const FIRE = "I was right here with Victoria by the dining-room fire, sir, the whole time the lights were out.";
const FIRE_AGAIN = "I was right here with Victoria by the dining-room fire, the entire time the lights were out, sir.";

function archibaldAfterVictoria(lines: string[]) {
  const game = createInitialGameState(c);
  const rt = game.characters.archibald;
  lines.forEach((text, i) => {
    rt.memory.push({ turn: i + 1, speaker: "player", text: "(Face to face with Victoria Blackwood) What were you doing?" }, { turn: i + 1, speaker: "character", text });
  });
  game.turn = lines.length + 1;
  return buildCharacterContext({ caseData: c, game }, "archibald");
}

describe("near-duplicate repeats (#27 leftover)", () => {
  it("treats the reworded dining-room-fire line as a repeat", () => {
    expect(nearDuplicate(FIRE.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim(), FIRE_AGAIN.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim())).toBe(true);
    const ctx = archibaldAfterVictoria([FIRE]);
    expect(repeatsEarlier(FIRE, ctx)).toBeTruthy(); // verbatim
    expect(repeatsEarlier(FIRE_AGAIN, ctx)).toBeTruthy(); // almost word for word
    expect(repeatsEarlier(`${FIRE_AGAIN} Ask her yourself.`, ctx)).toBeTruthy();
  });
  it("accepts a genuinely different reply about the same facts", () => {
    const ctx = archibaldAfterVictoria([FIRE]);
    expect(repeatsEarlier("Ask Victoria about the candles, not me. She was the one who snuffed them, if anyone did.", ctx)).toBeNull();
    expect(repeatsEarlier("Pah! You would take the word of a man who cannot remember his own whisky.", ctx)).toBeNull();
  });
  it("catches the same sentence twice inside one reply", () => {
    expect(repeatsEarlier(`${FIRE} Truly. ${FIRE_AGAIN}`, archibaldAfterVictoria([]))).toBeTruthy();
  });
  it("puts DO NOT REUSE with the suspect's own earlier lines into the confrontation prompt only", () => {
    const ctx = archibaldAfterVictoria([FIRE, "Pah! A man may sit by a fire without being cross-examined."]);
    const block = avoidPhrasingsBlock(ctx);
    expect(block).toContain("DO NOT REUSE");
    expect(block).toContain(FIRE);
    expect(buildUserMessage(ctx, "Well?", { partnerName: "Victoria Blackwood" })).toContain("DO NOT REUSE");
    expect(buildUserMessage(ctx, "Well?")).not.toContain("DO NOT REUSE");
    expect(avoidPhrasingsBlock(archibaldAfterVictoria([]))).toBe("");
  });
  it("includes recent one-on-one replies in the avoid list", () => {
    const game = createInitialGameState(c);
    game.characters.archibald.memory.push({ turn: 1, speaker: "player", text: "Where were you?" }, { turn: 1, speaker: "character", text: "By the study window, watching the rain come down." });
    game.turn = 2;
    expect(avoidPhrasingsBlock(buildCharacterContext({ caseData: c, game }, "archibald"))).toContain("By the study window, watching the rain come down.");
  });
  it("falls back to varied lines aimed at the partner, never echoing earlier ones, never confessing", () => {
    const ctx = archibaldAfterVictoria([FIRE]);
    const seen = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      const v = variedConfrontationFallback(ctx, "Victoria Blackwood", seed);
      expect(v.dialogue).toContain("Victoria");
      expect(repeatsEarlier(v.dialogue, ctx)).toBeNull();
      expect(v.dialogue).not.toMatch(/confess|killed|murdered|I did it/i);
      seen.add(v.dialogue);
    }
    expect(seen.size).toBeGreaterThan(2);
  });
});
