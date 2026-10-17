/**
 * Case-two plan phase 3: `setting` (era rule, roster, vocabulary) and `orderLandmarks` / `orderWords` as case data.
 * The defaults must reproduce the first case byte for byte (the golden snapshots pin the full prompts too).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { findModernWord } from "@/ai/canon-check";
import { checkOrder, defaultOrderLandmarks, landmarksOf, orderConfig, orderLines } from "@/ai/order-check";
import { buildSystemPrompt, ERA_RULE, eraRule } from "@/ai/prompts/interrogation";
import { caseWorld } from "@/ai/world";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { OrderLandmarkSchema, resolveSetting, SettingSchema, type Setting } from "@/engine/presentation";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const ctxOf = (id: string, unlock: string[] = []) => {
  const game = createInitialGameState(c);
  if (unlock.length) game.characters[id].revealedSecretIds = unlock;
  return buildCharacterContext({ caseData: c, game }, id);
};
const SHIP: Setting = SettingSchema.parse({
  place: "aboard a private steam yacht at sea in a storm",
  decade: "the 1930s",
  dateLine: "the summer of 1936",
  site: "the ship",
  household: "the passengers",
  authority: { noun: "the purser", policeAboard: false, note: "the police take over when we make port" },
  roster: "Others aboard:",
  vocabulary: { allowed: ["disc", "gramophone", "wireless", "telegraph", "galley", "purser", "okay"], banned: ["phones", "apps", "tape recorder"] },
});

describe("setting: the era rule and roster", () => {
  it("no setting gives today's rule byte for byte", () => {
    expect(eraRule(resolveSetting(undefined))).toBe(ERA_RULE);
    const sys = buildSystemPrompt(ctxOf("victoria"), { exposedLieIds: [] });
    expect(sys).toBe(buildSystemPrompt(ctxOf("victoria"), { exposedLieIds: [] }, caseWorld(c)));
    expect(sys).toContain(`7. ${ERA_RULE}`);
    expect(sys).toContain("Others in the house: ");
  });
  it("a setting builds its own era sentence, ordinary words and roster line", () => {
    const rule = eraRule(resolveSetting(SHIP));
    expect(rule.startsWith("You live aboard a private steam yacht at sea in a storm in the summer of 1936.")).toBe(true);
    expect(rule).toContain("ordinary here, and you may mention them freely: disc, gramophone, wireless, telegraph, galley, purser, okay.");
    expect(rule).not.toMatch(/telephone|1920s|okay-as-slang/);
    expect(rule).toContain("tape recorder");
    const sys = buildSystemPrompt(ctxOf("victoria"), { exposedLieIds: [] }, caseWorld({ setting: SHIP }));
    expect(sys).toContain("Others aboard: ");
    expect(sys).not.toContain("Others in the house:");
  });
});

describe("setting: vocabulary (DX17)", () => {
  const v = resolveSetting(SHIP);
  it("bans the case's words, whole-word and plural-aware, and phrases", () => {
    expect(findModernWord("Check my phone, detective.", "", v)).toBe("phone");
    expect(findModernWord("All those phones!", "", v)).toBe("phones");
    expect(findModernWord("Is that a tape  recorder?", "", v)).toBe("tape  recorder");
    expect(findModernWord("The telephone in the wireless room.", "", v)).toBeNull();
    expect(findModernWord("Put a disc on the gramophone.", "", v)).toBeNull();
  });
  it("allowed wins over the default list; meta words stay banned", () => {
    expect(findModernWord("Okay, detective.", "")).toBe("Okay");
    expect(findModernWord("Okay, detective.", "", v)).toBeNull();
    expect(findModernWord("Send me an email.", "", v)).toBe("email");
    expect(findModernWord("Are you an AI?", "", v)).toBe("AI");
  });
  it("the default (no vocabulary) is unchanged", () => {
    expect(findModernWord("Check my phone.", "")).toBeNull();
    expect(findModernWord("Check my phone.", "", resolveSetting(undefined))).toBeNull();
  });
});

describe("orderLandmarks as data", () => {
  it("the default five, written as data, behave exactly like the built-in list", () => {
    const data = { orderLandmarks: defaultOrderLandmarks().map((l) => OrderLandmarkSchema.parse(l)) };
    const cfg = orderConfig(data);
    expect(cfg).not.toBe(orderConfig(undefined));
    for (const id of ["archibald", "gregory", "reginald", "victoria"]) {
      expect(landmarksOf(ctxOf(id), cfg)).toEqual(landmarksOf(ctxOf(id)));
      expect(orderLines(ctxOf(id), cfg)).toEqual(orderLines(ctxOf(id)));
    }
    const arch = ctxOf("archibald", ["s-archibald-false-alibi"]);
    for (const line of [
      "From after the lights went out till Reginald lit the candles proper, I slipped away to use the servants' telephone.",
      "From after the candles till the scream, I stepped out to use the servants' telephone.",
      "I slipped away after the candles were lit.",
    ])
      expect(checkOrder(line, arch, null, cfg)).toEqual(checkOrder(line, arch));
  });
  it("an empty list turns the check off; a case list replaces the defaults", () => {
    expect(orderLines(ctxOf("archibald"), orderConfig({ orderLandmarks: [] }))).toEqual([]);
    const scream = orderConfig({ orderLandmarks: [{ id: "cry", label: "the cry", say: ["(?:the\\s+)?(?:cry|scream)"], fact: ["scream"] }] });
    expect(landmarksOf(ctxOf("archibald"), scream).map((l) => [l.id, l.minute])).toEqual([["cry", 21 * 60 + 30]]);
  });
  it("orderWords add absence/movement words (DX5)", () => {
    const arch = ctxOf("archibald", ["s-archibald-false-alibi"]);
    const line = "I went below before the lights went out.";
    expect(checkOrder(line, arch).ok).toBe(true); // "went below" is not an absence claim by default
    const cfg = orderConfig({ orderWords: { absence: ["went\\s+below"] } });
    expect(checkOrder(line, arch, null, cfg).ok).toBe(false);
  });
  it("rejects unsafe patterns", () => {
    expect(OrderLandmarkSchema.safeParse({ id: "x", label: "x", say: ["(a+)+"], fact: ["x"] }).success).toBe(false);
    expect(OrderLandmarkSchema.safeParse({ id: "x", label: "x", say: ["(unclosed"], fact: ["x"] }).success).toBe(false);
  });
});
