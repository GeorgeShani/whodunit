/**
 * #52 delivery variety: openers, actions and whole sentences must not repeat word for word across replies. Prompt
 * block, deterministic rewrite (no model call), guard `repeat` for a reply with nothing new, rotating deflections.
 * Lines are Gremlin's r6 repros.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { deliveryBlock, deliveryRepeats, openerOf, repeatsRecentReply, sameAction, varyDelivery } from "@/ai/delivery";
import { checkReply, safeDeflection } from "@/ai/guard";
import { prepareTurn } from "@/ai/perform-turn";
import { buildUserMessage } from "@/ai/prompts/interrogation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import type { CharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { commitTurn, planTurn } from "@/engine/interrogation";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { FIXTURES_DIR } from "../helpers/fixture";

let c: LoadedCase;
let hl: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});

const SPANISH = "My dear detective, I fear my Spanish is quite rusty—perhaps we should stick to English? I couldn't possibly have done any such thing; I was with Mr. Crane the entire time after the candles were lit until that dreadful scream.";
const LIGHTS = "My dear detective, the lights went out at ten minutes past nine, while Mr. Crane and I were sitting together in the dining room by the fire.";
const GEORGIAN = "My dear detective, I must confess my Georgian is even rustier than my Spanish—perhaps we should remain in civilised English? I couldn't possibly have done any such thing; I was with Mr. Crane the entire time after the candles were lit until that dreadful scream.";

const withMemory = (g: GameState, ch: string, xs: { a: string; action?: string }[]) => {
  for (const x of xs) {
    g.turn += 1;
    g.characters[ch].memory.push({ turn: g.turn, speaker: "player", text: "A question?" }, { turn: g.turn, speaker: "character", text: x.a, ...(x.action ? { action: x.action } : {}) });
  }
  return g;
};
const ctxFor = (g: GameState, ch: string, question = "Anything else?"): { ctx: CharacterContext; guard: ReturnType<typeof prepareTurn>["guard"] } => {
  const p = prepareTurn({ caseData: c, game: g, characterId: ch, question });
  return { ctx: p.ctx, guard: p.guard };
};

describe("openerOf", () => {
  it.each([
    ["My dear detective, the lights went out.", "my dear detective"],
    ["W-well, sir... I were in the hall.", "well sir"],
    ["W-well sir, it were m'lady.", "well sir"],
    ["Oh, detective, how theatrical.", "oh detective"],
    ["I beg your pardon, sir? I saw no such thing.", "i beg your pardon"],
  ])("%s -> %s", (line, op) => expect(openerOf(line)).toBe(op));
});

describe("varyDelivery (deterministic, no model call)", () => {
  it("Victoria: a third 'My dear detective,' in a row is trimmed; a second one is left alone", () => {
    const two = ctxFor(withMemory(createInitialGameState(c), "victoria", [{ a: SPANISH }, { a: LIGHTS }]), "victoria").ctx;
    const r = varyDelivery({ dialogue: "My dear detective, one hears all manner of things in a storm." }, two, 3);
    expect(r.dialogue).toBe("One hears all manner of things in a storm.");
    const one = ctxFor(withMemory(createInitialGameState(c), "victoria", [{ a: LIGHTS }]), "victoria").ctx;
    expect(varyDelivery({ dialogue: "My dear detective, one hears all manner of things." }, one, 2).dialogue).toMatch(/^My dear detective,/);
  });

  it("Victoria r6 Georgian turn: the whole alibi sentence reused from the Spanish turn is dropped, the new part stays", () => {
    const { ctx } = ctxFor(withMemory(createInitialGameState(c), "victoria", [{ a: SPANISH }]), "victoria");
    const r = varyDelivery({ dialogue: GEORGIAN }, ctx, 2);
    expect(r.dialogue).toContain("Georgian is even rustier");
    expect(r.dialogue).not.toContain("I was with Mr. Crane the entire time");
    expect(deliveryRepeats({ dialogue: GEORGIAN }, ctx).some((x) => x.startsWith("sentence:"))).toBe(true);
    expect(deliveryRepeats({ dialogue: r.dialogue }, ctx)).toEqual([]);
  });

  it("Reginald's 'few words' tail is dropped together with its short follow-up", () => {
    const { ctx } = ctxFor(withMemory(createInitialGameState(c), "reginald", [{ a: "Her ladyship and his lordship had a few words, sir. Nothing out of the ordinary." }]), "reginald");
    const r = varyDelivery({ dialogue: "I beg your pardon, sir? I saw no such thing. Her ladyship and his lordship had a few words, sir. Nothing out of the ordinary." }, ctx, 2);
    expect(r.dialogue).toBe("I beg your pardon, sir? I saw no such thing.");
  });

  it("Gregory: the same action as last time is swapped for an unused quirk/tell (never one near a recent action)", () => {
    const same = "wrings his cap and glances at the hall door";
    const { ctx } = ctxFor(withMemory(createInitialGameState(c), "gregory", [{ a: "W-well, sir... I heard the thud.", action: same }, { a: "W-well sir, it were m'lady.", action: same }]), "gregory");
    const r = varyDelivery({ dialogue: "I didn't see no candlestick, sir.", action: same }, ctx, 3);
    expect(r.action).toBeDefined();
    expect(sameAction(r.action!, same)).toBe(false);
    const g = c.characters.find((x) => x.id === "gregory")!;
    expect([...g.personality.quirks, ...g.personality.tells]).toContain(r.action);
    expect(r.action).not.toMatch(/wrings his cap|hall door/);
  });

  it("a fresh reply is untouched; the first reply of a conversation is untouched", () => {
    const { ctx } = ctxFor(withMemory(createInitialGameState(c), "victoria", [{ a: LIGHTS, action: "dabs her eyes" }]), "victoria");
    const fresh = { dialogue: "Darling, I heard nothing but thunder.", action: "laughs a half-beat too long" };
    expect(varyDelivery(fresh, ctx, 2)).toEqual({ ...fresh, changes: [] });
    const first = ctxFor(createInitialGameState(c), "victoria").ctx;
    expect(varyDelivery({ dialogue: LIGHTS, action: "x" }, first, 0).changes).toEqual([]);
  });

  it("never leaves a reply empty: a reply that only repeats is left for the guard", () => {
    const { ctx } = ctxFor(withMemory(createInitialGameState(c), "victoria", [{ a: LIGHTS }]), "victoria");
    expect(varyDelivery({ dialogue: LIGHTS }, ctx, 2).dialogue).toBe(LIGHTS);
  });
});

describe("guard: repeat (nothing new) one on one", () => {
  it("a reply whose every sentence repeats a recent one is rejected; not on a reveal turn", () => {
    const g = withMemory(createInitialGameState(c), "victoria", [{ a: LIGHTS }]);
    const { guard } = ctxFor(g, "victoria", "Where were you when the lights went out?");
    expect(checkReply({ dialogue: "The lights went out at ten minutes past nine, while Mr. Crane and I were sitting together in the dining room by the fire." }, guard)?.reason).toBe("repeat");
    expect(checkReply({ dialogue: "By the fire with Mr. Crane, darling, as I said." }, guard)).toBeNull();
    expect(repeatsRecentReply("A wholly new remark about the weather tonight.", guard.ctx)).toBeNull();
    const reveal = { ...guard, directives: { ...guard.directives, revealSecret: { id: "s-victoria-new-will", description: "x" } } };
    expect(checkReply({ dialogue: "The lights went out at ten minutes past nine, while Mr. Crane and I were sitting together in the dining room by the fire." }, reveal)?.reason).not.toBe("repeat");
  });
});

describe("prompt: VARY YOUR DELIVERY", () => {
  it("absent on the first reply; lists recent openers, actions and sentences afterwards", () => {
    const first = ctxFor(createInitialGameState(c), "victoria").ctx;
    expect(deliveryBlock(first, 0)).toBe("");
    expect(buildUserMessage(first, "Hello?")).not.toContain("VARY YOUR DELIVERY");
    const { ctx } = ctxFor(withMemory(createInitialGameState(c), "victoria", [{ a: SPANISH, action: "dabs at dry eyes with lace handkerchief" }, { a: LIGHTS, action: "dabs at her eyes with a lace handkerchief" }]), "victoria");
    const msg = buildUserMessage(ctx, "Did you hear anything?");
    expect(msg).toContain("VARY YOUR DELIVERY");
    expect(msg).toContain('Do not open with: "My dear detective"');
    expect(msg).toContain('"dabs at her eyes with a lace handkerchief"');
    expect(msg).toContain("I couldn't possibly have done any such thing");
    // Suggested fresh actions are the character's own and never one of the recent ones.
    expect(msg).toMatch(/Actions you have not used lately: .*"laughs a half-beat too long"|Actions you have not used lately: .*"swoons onto the nearest chaise"/);
    expect(msg.split("Actions you have not used lately:")[1]).not.toContain("dabs dry eyes");
  });

  it("authored voice openers are offered (fixture case), never the one just used", () => {
    const g = createInitialGameState(hl);
    g.turn = 1;
    g.characters["keeper-quill"].memory.push({ turn: 1, speaker: "player", text: "Hello?" }, { turn: 1, speaker: "character", text: "Aye, Inspector, the lamp was lit at dusk." });
    const p = prepareTurn({ caseData: hl, game: g, characterId: "keeper-quill", question: "And then?" });
    expect(p.ctx.voice.openers.length).toBe(4);
    const line = p.user.split("\n").find((l) => l.startsWith("- Openers in your voice"))!;
    expect(line).toBeDefined();
    expect(line).not.toContain("Aye, Inspector");
  });

  it("a told story is restated with the same facts in fresh words (no 'repeat it the same way')", () => {
    const g = createInitialGameState(c);
    g.characters.victoria.liesToldIds.push(c.characters.find((x) => x.id === "victoria")!.intendedLies[0]!.id);
    const p = prepareTurn({ caseData: c, game: g, characterId: "victoria", question: "x" });
    expect(p.system).not.toContain("repeat it the same way");
    expect(p.system).toContain("keep exactly the same facts, in fresh words");
  });
});

describe("fallback deflections rotate", () => {
  it("never the deflection said last time; authored voice.deflections first, unsafe ones skipped", () => {
    const g = withMemory(createInitialGameState(c), "victoria", [{ a: "I have said all I intend to say on that subject.", action: "dabs dry eyes with a lace handkerchief" }]);
    const { ctx } = ctxFor(g, "victoria");
    for (let t = 0; t < 8; t++) {
      const d = safeDeflection(ctx, "unknown_name", t);
      expect(d.dialogue).not.toBe("I have said all I intend to say on that subject.");
      expect(d.action).not.toBe("dabs dry eyes with a lace handkerchief");
    }
    const q = prepareTurn({ caseData: hl, game: createInitialGameState(hl), characterId: "keeper-quill", question: "x" }).ctx;
    expect(q.voice.deflections).toContain(safeDeflection(q, "unknown_name", 0).dialogue);
    const unsafe = (l: string) => !/tide/.test(l);
    for (let t = 0; t < 6; t++) expect(safeDeflection(q, "unknown_name", t, unsafe).dialogue).not.toMatch(/tide/);
  });
});

describe("memory keeps the action (token round trip)", () => {
  it("commitTurn stores the action with the reply and the token carries it", () => {
    const env = { GAME_STATE_SECRET: "test-secret-0123456789abcdef-0123" };
    const g = createInitialGameState(c);
    const plan = planTurn(c, g, "gregory", { playerText: "Where were you?" });
    commitTurn(g, plan, { playerText: "Where were you?", dialogue: "In the shed, sir.", emotion: "nervous", intensity: 0.5, stressDelta: 0, trustDelta: 0, performed: true, action: "wrings his cap" });
    expect(g.characters.gregory.memory.at(-1)).toMatchObject({ speaker: "character", text: "In the shed, sir.", action: "wrings his cap" });
    const d = decodeStateToken(encodeStateToken(g, env), c, env);
    expect(d.ok && d.game.characters.gregory.memory.at(-1)?.action).toBe("wrings his cap");
    vi.restoreAllMocks();
  });
});
