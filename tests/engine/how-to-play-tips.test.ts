/** case.json `howToPlayTips` (optional, PUBLIC): schema limits, the public view, and validate:case warnings. */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import { CaseEnvelopeSchema, HowToPlayTipSchema, MAX_HOW_TO_PLAY_TIPS, type LoadedCase } from "@/engine/case-schema";
import { checkCaseWarnings, howToPlayTipWarnings } from "@/engine/case-validation";
import { getPublicCaseView } from "@/engine/public-view";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const envelope = (extra: object) => {
  const env: Record<string, unknown> = { ...c };
  for (const k of ["timeline", "evidence", "characters", "solution", "endings"]) delete env[k];
  return CaseEnvelopeSchema.safeParse({ ...env, ...extra });
};

describe("howToPlayTips schema", () => {
  it("optional; 1-8 tips of 1-200 characters, trimmed", () => {
    expect(envelope({}).success).toBe(true);
    expect(envelope({ howToPlayTips: [] }).success).toBe(true);
    expect(envelope({ howToPlayTips: ["Clocks here run fast."] }).success).toBe(true);
    expect(MAX_HOW_TO_PLAY_TIPS).toBe(8);
    expect(envelope({ howToPlayTips: Array.from({ length: 8 }, (_, i) => `Tip ${i}`) }).success).toBe(true);
    expect(envelope({ howToPlayTips: Array.from({ length: 9 }, (_, i) => `Tip ${i}`) }).success).toBe(false);
    expect(envelope({ howToPlayTips: ["x".repeat(200)] }).success).toBe(true);
    expect(envelope({ howToPlayTips: ["x".repeat(201)] }).success).toBe(false);
    expect(envelope({ howToPlayTips: ["   "] }).success).toBe(false);
    expect(envelope({ howToPlayTips: [""] }).success).toBe(false);
    expect(envelope({ howToPlayTips: [42] }).success).toBe(false);
    expect(envelope({ howToPlayTips: "one tip" }).success).toBe(false);
    expect(HowToPlayTipSchema.parse("  padded  ")).toBe("padded");
  });
});

describe("public view", () => {
  it("meta.howToPlayTips only when the case has tips", () => {
    expect("howToPlayTips" in getPublicCaseView({ ...c, howToPlayTips: undefined }).meta).toBe(false);
    expect("howToPlayTips" in getPublicCaseView({ ...c, howToPlayTips: [] }).meta).toBe(false);
    expect(getPublicCaseView({ ...c, howToPlayTips: ["A tip."] }).meta.howToPlayTips).toEqual(["A tip."]);
  });
});

describe("validate:case warnings", () => {
  const tipWarnings = (tips: string[]) => howToPlayTipWarnings({ ...c, howToPlayTips: tips });

  it("validate:case reports them (checkCaseWarnings runs the tip check)", () => {
    const w = checkCaseWarnings({ ...c, howToPlayTips: ["Search twice!", "search twice"] }).filter((x) => x.path?.startsWith("howToPlayTips"));
    expect(w.map((x) => x.path)).toEqual(["howToPlayTips.1"]);
  }, 30_000);

  it("none for spoiler-free, distinct tips (or none at all)", () => {
    expect(tipWarnings([])).toEqual([]);
    expect(tipWarnings(["The storm keeps everyone indoors.", "Search rooms again after a confession."])).toEqual([]);
  });

  it("duplicates (ignoring case and punctuation)", () => {
    const w = tipWarnings(["Search twice!", "search twice"]);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe("howToPlayTips.1");
    expect(w[0]!.message).toMatch(/duplicates howToPlayTips\.0/);
  });

  it("a tip naming the culprit, the weapon or the true motive", () => {
    const murderer = c.characters.find((x) => x.id === c.solution.murdererId)!;
    const weapon = c.evidence.find((e) => e.id === c.solution.weaponId)!;
    const motive = c.motives.find((m) => m.id === c.solution.motiveId)!;
    for (const tip of [`Keep an eye on ${murderer.name}.`, `Keep an eye on ${murderer.name.split(" ")[0]}.`, `Where did ${weapon.name} end up?`, `Think about ${motive.label}.`]) {
      const w = tipWarnings([tip]);
      expect(w, tip).toHaveLength(1);
      expect(w[0]!.message).toMatch(/spoiler-free/);
    }
    // Shared words are no giveaway: the case's own name, the victim's surname, a title.
    expect(tipWarnings([`Nobody leaves ${c.title.split(" ").at(-1)} tonight.`, `${c.victim.name} had many enemies.`, "A lady never tells."])).toEqual([]);
    // An innocent suspect's name is not a giveaway.
    const innocent = c.characters.find((x) => x.id !== c.solution.murdererId)!;
    expect(tipWarnings([`${innocent.name} knows the house well.`])).toEqual([]);
  });
});
