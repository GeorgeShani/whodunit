/** E9 (CA-37): a guilt-path rejection falls back to the SAME pool as any other rejection (no culprit tell). */
import { beforeAll, describe, expect, it } from "vitest";
import { safeDeflection } from "@/ai/guard";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { encodeStateToken } from "@/engine/state-token";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

describe("E9 one deflection pool", () => {
  it("for every character, calm and rattled, guilt_leak / admits_core_guilt pick exactly what unknown_name picks", () => {
    for (const ch of c.characters) {
      for (const stress of [10, 80]) {
        const g = createInitialGameState(c);
        g.characters[ch.id].stress = stress;
        const ctx = buildCharacterContext({ caseData: c, game: g }, ch.id);
        for (let t = 0; t < 8; t++) {
          const other = safeDeflection(ctx, "unknown_name", t);
          expect(safeDeflection(ctx, "guilt_leak", t), `${ch.id} s${stress} t${t}`).toEqual(other);
          expect(safeDeflection(ctx, "admits_core_guilt", t)).toEqual(other);
        }
      }
    }
  });

  it("actions come from the character's own pool, filtered by isSafeAction for every reason alike", () => {
    const ctx = buildCharacterContext({ caseData: c, game: createInitialGameState(c) }, c.solution.murdererId);
    const own = [...(ctx.voice?.actions ?? []), ...(ctx.persona.personality.quirks ?? []), ...(ctx.persona.personality.tells ?? [])];
    const banned = own[0]!;
    for (let t = 0; t < 6; t++) {
      for (const reason of ["guilt_leak", "unknown_name"] as const) {
        const d = safeDeflection(ctx, reason, t, () => true, (a) => a !== banned);
        expect(own).toContain(d.action);
        expect(d.action).not.toBe(banned);
      }
    }
  });

  it("end to end (the murderer): a twice-rejected guilt leak and a twice-rejected invented name give the same fallback", async () => {
    const m = c.solution.murdererId;
    const run = async (dialogue: string) => {
      mockGrok({ content: goodReply({ dialogue }) });
      const g = createInitialGameState(c);
      const r = await handleInterrogate({ characterId: m, question: "Where were you?", stateToken: encodeStateToken(g, TEST_ENV) }, { caseData: c, env: TEST_ENV });
      return { dialogue: r.body.response.dialogue, action: r.body.response.action, emotion: r.body.response.emotion };
    };
    const guilt = await run(`I killed ${c.victim.name} myself, with the candlestick.`);
    const name = await run("Colonel Mustard told me everything, darling.");
    expect(guilt.dialogue).not.toMatch(/killed/);
    expect(guilt).toEqual(name);
  });
});
