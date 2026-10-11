/** E8 (CA-27): a non-culprit stating one of the culprit's acts as fact is an over-claim, unless a held secret or card covers it. */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply, coveredActs } from "@/ai/guard";
import { findGuiltLeak } from "@/ai/guilt-check";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import {
  guiltProfile,
  pronounOf,
  type CulpritAct,
  type GuiltProfile,
} from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { FIXTURES_DIR } from "../helpers/fixture";

let bw: LoadedCase;
let hl: LoadedCase;
let p: GuiltProfile;
beforeAll(async () => {
  bw = await loadCase("blackwood");
  hl = await loadCase("harbor-light", FIXTURES_DIR);
  p = guiltProfile(bw);
});
const NONE = { overClaim: { covered: new Set<CulpritAct>() } };
const innocent = () =>
  bw.characters.find((c) => c.id !== bw.solution.murdererId)!.id;

describe("E8 over-claim: data from the profile", () => {
  it("murderer names, pronoun and cover acts come from case data", () => {
    expect(p.murdererNames).toEqual(
      expect.arrayContaining(["victoria", "her ladyship", "lady victoria"]),
    );
    expect(p.murdererNames).not.toContain("blackwood"); // shared with the victim: never a subject
    expect(p.murdererPronoun).toBe("she");
    expect(p.coverActs?.["s-gregory-saw-victoria"]).toEqual(
      expect.arrayContaining(["key", "scene"]),
    );
    expect(
      Object.keys(p.coverActs ?? {}).every(
        (id) =>
          !bw.characters
            .find((c) => c.id === bw.solution.murdererId)!
            .secrets.some((s) => s.id === id),
      ),
    ).toBe(true);
  });
  it("pronoun: the data field wins, else a guess from titles, else none", () => {
    expect(pronounOf({ name: "Jane Doe", aliases: [], pronoun: "he" })).toBe(
      "he",
    );
    expect(pronounOf({ name: "Jane Doe", aliases: ["Mrs Doe"] })).toBe("she");
    expect(pronounOf({ name: "Sir John", aliases: [] })).toBe("he");
    expect(pronounOf({ name: "Pat Quill", aliases: [] })).toBeUndefined();
    expect(
      pronounOf({ name: "Pat Quill", aliases: [], pronoun: "they" }),
    ).toBeUndefined();
  });
});

describe("E8 over-claim: matches", () => {
  const OVER = [
    ["She did it.", "confession"],
    ["Victoria's the one who struck him.", "killing"],
    ["Victoria is the one who struck him down.", "killing"],
    ["Her ladyship killed him with the candlestick.", "killing"],
    ["It was Lady Victoria who struck him.", "confession"],
    ["Lady Victoria is the murderer, plain as day.", "confession"],
    ["She locked the library door and took the key.", "key"],
    ["She'd locked the door before anyone came.", "key"],
    ["Her ladyship hid the key, mark my words.", "key"],
    ["She picked up the candlestick and swung it.", "weapon"],
    ["Lady Victoria went into the library at seventeen past nine.", "scene"],
    ["She came out of the library in the dark.", "scene"],
    // E15a: a negation in an EARLIER clause does not cover a later stated act.
    ["Nobody saw anything, but Victoria killed him.", "killing"],
    ["Victoria killed him, and nobody saw it.", "killing"],
  ] as const;
  for (const [line, kind] of OVER)
    it(`"${line}" -> over-claim (${kind})`, () => {
      const l = findGuiltLeak(line, p, innocent(), NONE);
      expect(l?.overClaim).toBe(true);
      expect(l?.kind).toBe(kind);
    });
});

describe("E8 over-claim: innocent negatives pass", () => {
  const PASS = [
    "I think she did it.",
    "Perhaps her ladyship struck him.",
    "Maybe Victoria locked the door, I couldn't say.",
    "She might have taken the key.",
    "She must have gone into the library.",
    "I suspect Lady Victoria killed him.",
    "Did Victoria kill him?",
    "You think she did it?",
    "Victoria never killed anyone.",
    "She did not lock that door.",
    "Her ladyship was in the dining room all evening.",
    "She poured the port at dinner.",
    "Lady Victoria's candlestick was on the desk.",
    "She took her tea in the hall.",
    "She struck a match and lit the candles.",
    "It was her ladyship who rang for tea.",
    "It was her ladyship.",
    "She's been crying all night.",
    "She went into the library before dinner to fetch a book.",
    "Lord Blackwood locked the door himself.",
    "Gregory locked the shed and took the key.",
    // E15a: a negated frame before the subject denies or un-witnesses the act.
    "Nobody saw Victoria strike him, old boy, nobody at all.",
    "No one saw her ladyship lock the door.",
    "No-one heard Victoria go into the library in the dark.",
    "Not a soul saw Lady Victoria take the key.",
    "I never saw her ladyship pick up the candlestick.",
    "None of us saw Victoria kill him.",
    "I don't believe her ladyship killed him.",
  ];
  for (const line of PASS)
    it(`"${line}" passes`, () => {
      expect(findGuiltLeak(line, p, innocent(), NONE)).toBeNull();
    });
  it("off without opts.overClaim (the eval's no_guilt assertion is unchanged)", () => {
    expect(
      findGuiltLeak("She locked the library door.", p, innocent()),
    ).toBeNull();
  });
  it("the murderer is never checked as her own third person (her first-person rules apply instead)", () => {
    expect(
      findGuiltLeak(
        "She locked the library door.",
        p,
        bw.solution.murdererId,
        NONE,
      )?.overClaim,
    ).toBeUndefined();
  });
});

describe("E8 over-claim: cover", () => {
  it("a held covering secret lifts only the acts its facts describe", () => {
    const cov = {
      overClaim: { covered: new Set(p.coverActs!["s-gregory-saw-victoria"]) },
    };
    expect(
      findGuiltLeak("She locked the library door.", p, "gregory", cov),
    ).toBeNull();
    expect(
      findGuiltLeak(
        "She came out of the library in the dark.",
        p,
        "gregory",
        cov,
      ),
    ).toBeNull();
    expect(
      findGuiltLeak("She killed him with the candlestick.", p, "gregory", cov)
        ?.overClaim,
    ).toBe(true);
  });

  const turn = (
    who: string,
    opts: { revealed?: string[]; shown?: string[]; present?: string } = {},
  ) => {
    const g = createInitialGameState(bw);
    g.discoveredEvidenceIds = bw.evidence.map((e) => e.id);
    g.characters[who].revealedSecretIds = opts.revealed ?? [];
    g.revealedSecretIds = [
      ...(opts.revealed ?? []),
      ...(opts.shown ?? []),
      ...(opts.present ? [opts.present] : []),
    ];
    if (opts.present) g.characters.gregory.revealedSecretIds = [opts.present];
    g.characters[who].testimonyShownIds = opts.shown ?? [];
    return prepareTurn({
      caseData: bw,
      game: g,
      characterId: who,
      question: "Who locked the door?",
      move: opts.present ? { presentedTestimonyId: opts.present } : {},
    });
  };
  const LINE = {
    dialogue: "She locked the library door and walked off.",
    admits: [] as string[],
  };

  it("guard: over_claim (a contract reason) with a corrective note that quotes only the line", () => {
    const v = checkReply(LINE, turn("reginald").guard);
    expect(v?.reason).toBe("over_claim");
    expect(v?.note).toContain(LINE.dialogue);
    expect(v?.note).not.toMatch(/victoria|murder/i);
  });
  it("guard: lifted by the speaker's own revealed secret", () => {
    const t = turn("gregory", { revealed: ["s-gregory-saw-victoria"] });
    expect(coveredActs(t.guard)).toContain("key");
    expect(checkReply(LINE, t.guard)?.reason).not.toBe("over_claim");
  });
  it("guard: lifted by a testimony card shown or presented to the speaker", () => {
    const shown = turn("reginald", { shown: ["s-gregory-saw-victoria"] });
    expect(shown.guard.ctx.testimonyShown.map((t) => t.id)).toContain(
      "s-gregory-saw-victoria",
    );
    expect(checkReply(LINE, shown.guard)?.reason).not.toBe("over_claim");
    const pres = turn("reginald", { present: "s-gregory-saw-victoria" });
    expect(pres.guard.directives.presentedTestimony?.id).toBe(
      "s-gregory-saw-victoria",
    );
    expect(checkReply(LINE, pres.guard)?.reason).not.toBe("over_claim");
  });
});

describe("E8 over-claim: case-agnostic (a second case)", () => {
  it("the murderer's own name drives the check in another case", () => {
    const hp = guiltProfile(hl);
    const m = hl.characters.find((c) => c.id === hl.solution.murdererId)!;
    const other = hl.characters.find((c) => c.id !== m.id)!.id;
    const first = m.name.split(/\s+/)[0]!;
    expect(findGuiltLeak(`${first} did it.`, hp, other, NONE)?.overClaim).toBe(
      true,
    );
    expect(
      findGuiltLeak(`Perhaps ${first} did it.`, hp, other, NONE),
    ).toBeNull();
  });
});
