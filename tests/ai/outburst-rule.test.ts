/** C1: the breakdown instruction (prompt + retry note) states exactly the rule isOutburst checks, from one constant. */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply } from "@/ai/guard";
import { prepareTurn } from "@/ai/perform-turn";
import { buildSystemPrompt } from "@/ai/prompts/interrogation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { isOutburst, OUTBURST_RULE, outburstRuleText } from "@/engine/stress";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const caps = (n: number) => "W".repeat(n);

describe("C1 outburst rule", () => {
  it("the checker follows OUTBURST_RULE exactly (mark + a shouted word of minCapitalLetters)", () => {
    const n = OUTBURST_RULE.minCapitalLetters;
    expect(isOutburst(OUTBURST_RULE.example)).toBe(true);
    expect(isOutburst(OUTBURST_RULE.tooShort)).toBe(false);
    expect(isOutburst(`${caps(n)}${OUTBURST_RULE.mark}`)).toBe(true);
    expect(isOutburst(`${caps(n - 1)}${OUTBURST_RULE.mark}`)).toBe(false); // one letter short
    expect(isOutburst(`${caps(n)}.`)).toBe(false); // no mark
    expect(isOutburst(`Shouting${OUTBURST_RULE.mark}`)).toBe(false); // not all capitals
  });

  it("the rule text names the mark, the letter count, a passing example and the near miss", () => {
    const t = outburstRuleText();
    expect(t).toContain(`(${OUTBURST_RULE.mark})`);
    expect(t).toContain(`${OUTBURST_RULE.minCapitalLetters} or more letters`);
    expect(t).toContain(OUTBURST_RULE.example);
    expect(t).toContain(OUTBURST_RULE.tooShort);
    expect(t).toMatch(/CAPITALS/);
  });

  it("the breakdown prompt carries the exact rule text (no vaguer 'capitals allowed')", () => {
    const g = createInitialGameState(c);
    const sys = buildSystemPrompt(buildCharacterContext({ caseData: c, game: g }, "archibald"), { exposedLieIds: [], breakdown: true });
    expect(sys).toContain(outburstRuleText());
    expect(sys).not.toMatch(/capitals allowed/i);
    const calm = buildSystemPrompt(buildCharacterContext({ caseData: c, game: g }, "archibald"), { exposedLieIds: [] });
    expect(calm).not.toContain(outburstRuleText());
  });

  it("the no_outburst retry note carries the same rule text", () => {
    const g = createInitialGameState(c);
    const p = prepareTurn({ caseData: c, game: g, characterId: "gregory", question: "Well?" });
    const guard = { ...p.guard, directives: { ...p.guard.directives, breakdown: true } };
    const v = checkReply({ dialogue: "I'm sure I don't know, sir.", admits: [] }, guard);
    expect(v?.reason).toBe("no_outburst");
    expect(v?.note).toContain(outburstRuleText());
    expect(checkReply({ dialogue: `Oh, sir! ${OUTBURST_RULE.example}`, admits: [] }, guard)?.reason).not.toBe("no_outburst");
  });
});
