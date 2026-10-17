/**
 * Case-two plan 3.9: the accomplice's guilt gets the murderer's protection (DX1, DX2), the guard-data validator rules
 * (DX4/V33, DX10/V34) and the forbidden-phrase switches unlessBroken / array unlessRevealed (DX7). Offline only: no
 * model calls. The Tallyho block skips until cases/_tallyho/solution.json (gitignored, regenerated locally) names an
 * accomplice with an accompliceAct.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { compileForbiddenPhrase, findForbiddenPhrase, forbiddenStateOf, isPhraseLive } from "@/ai/forbidden-phrases";
import { checkReply } from "@/ai/guard";
import { findGuiltLeak, findReplyGuiltLeakAny, speakerNamesOf } from "@/ai/guilt-check";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseWarnings, checkGuardDataWarnings } from "@/engine/case-validation";
import { accompliceView, coreGuiltSecretIds, derivedCoreGuilt, guiltProfile, guiltProfiles, type CulpritAct } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { ForbiddenPhraseSchema } from "@/engine/types";

let bw: LoadedCase;
beforeAll(async () => {
  bw = await loadCase("blackwood");
});
const clone = (c: LoadedCase): LoadedCase => structuredClone(c);
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An in-memory Blackwood variant with an accomplice whose act is one of their own secrets' timed, placed facts. */
function withAccomplice(withAct = true) {
  const c = clone(bw);
  const facts = new Map([...c.facts, ...c.timeline].map((f) => [f.id, f]));
  for (const ch of c.characters) {
    if (ch.id === c.solution.murdererId) continue;
    for (const s of ch.secrets) {
      const f = s.relatedFactIds.map((id) => facts.get(id)).find((x) => x?.locationId && (x.time ?? x.from));
      if (!f) continue;
      c.solution.accompliceId = ch.id;
      if (withAct) c.solution.accompliceAct = { locationId: f.locationId!, time: (f.time ?? f.from)! };
      return { c, ch, s, f };
    }
  }
  throw new Error("no character with a timed, placed secret fact");
}

describe("DX1/DX2: the accomplice's core guilt and guilt profile (case-agnostic)", () => {
  it("a single-culprit case is untouched: exactly the murderer's profile, no accomplice view", () => {
    expect(guiltProfiles(bw)).toEqual([guiltProfile(bw)]);
    expect(accompliceView(bw)).toBeNull();
  });

  it("derives core guilt for the accomplice's secret covering their act, and builds their profile from it", () => {
    const { c, ch, s, f } = withAccomplice();
    expect(derivedCoreGuilt(c, ch, s)).toBe(true);
    expect(coreGuiltSecretIds(c).has(s.id)).toBe(true);
    const [m, a] = guiltProfiles(c);
    expect(m).toEqual(guiltProfile(c));
    expect(a.role).toBe("accomplice");
    expect(a.murdererId).toBe(ch.id);
    expect(a.weaponNames).toEqual([]);
    const at = c.solution.accompliceAct!.time.split(":").map(Number);
    expect(a.window[0]).toBeLessThanOrEqual(at[0] * 60 + at[1]);
    expect(a.window[1]).toBeGreaterThanOrEqual(at[0] * 60 + at[1]);
    expect(f.involvesCharacterIds.includes(ch.id) || f.locationId === c.solution.accompliceAct!.locationId).toBe(true);
  });

  it("without accompliceAct: no accomplice profile and nothing derived (only data-flagged coreGuilt counts)", () => {
    const { c, ch, s } = withAccomplice(false);
    expect(guiltProfiles(c)).toHaveLength(1);
    expect(derivedCoreGuilt(c, ch, s)).toBe(false);
  });

  it("the accomplice confessing the killing in their own words is caught by either profile; nobody else's line is", () => {
    const { c, ch } = withAccomplice();
    const victim = c.victim.name.split(/\s+/).find((w) => w.length >= 4 && !/^(lord|lady|sir)$/i.test(w))!;
    const ps = guiltProfiles(c);
    expect(findReplyGuiltLeakAny({ dialogue: `I killed ${victim}.` }, "", ps, ch.id, { speakerNames: speakerNamesOf(c, ch.id) })).not.toBeNull();
    expect(findReplyGuiltLeakAny({ dialogue: "I heard nothing at all that night." }, "", ps, ch.id, { speakerNames: speakerNamesOf(c, ch.id) })).toBeNull();
  });
});

describe("DX4 / V33: a revealable secret that its owner can't say", () => {
  it("Blackwood: no guard-data warnings", () => {
    expect(checkGuardDataWarnings(bw)).toEqual([]);
  });
  it("warns when a revealable secret's text trips the guilt check for its owner", () => {
    const c = clone(bw);
    const core = coreGuiltSecretIds(c);
    const ch = c.characters.find((x) => x.id !== c.solution.murdererId && x.secrets.some((s) => !core.has(s.id)))!;
    const s = ch.secrets.find((x) => !core.has(x.id))!;
    s.description = `I killed ${c.victim.name}, there in the dark.`;
    const w = checkGuardDataWarnings(c);
    expect(w.map((i) => i.path)).toContain(`secrets(${s.id}).description`);
    expect(w.find((i) => i.path === `secrets(${s.id}).description`)!.message).toMatch(/soft-lock/);
  });
});

describe("DX10 / V34: forbidden phrase vs visible fact, mixed-owner keys", () => {
  it("warns when an unlessRevealed phrase blocks a fact the character always sees", () => {
    const c = clone(bw);
    const facts = new Map([...c.facts, ...c.timeline].map((f) => [f.id, f]));
    let found: { ch: (typeof c.characters)[number]; id: string } | undefined;
    for (const ch of c.characters) {
      const linked = new Set([...ch.secrets.flatMap((s) => s.relatedFactIds), ...ch.intendedLies.map((l) => l.aboutFactId)]);
      const id = ch.knownFactIds.find((x) => !facts.get(x)?.hiddenUntil && !linked.has(x) && ch.secrets.length > 0);
      if (id) {
        found = { ch, id };
        break;
      }
    }
    expect(found).toBeDefined();
    const { ch, id } = found!;
    ch.forbiddenPhrases.push(ForbiddenPhraseSchema.parse({ text: esc(facts.get(id)!.statement.slice(0, 18)), regex: true, unlessRevealed: ch.secrets[0].id }));
    const w = checkGuardDataWarnings(c);
    expect(w.some((i) => i.path === `forbiddenPhrases.${ch.forbiddenPhrases.length - 1}` && i.message.includes(id))).toBe(true);
  });

  it("warns when a hidden fact's keys belong to different knowers", () => {
    const c = clone(bw);
    const f = [...c.facts, ...c.timeline].find((x) => c.characters.filter((ch) => ch.knownFactIds.includes(x.id) && ch.secrets.length).length >= 2)!;
    const [a, b] = c.characters.filter((ch) => ch.knownFactIds.includes(f.id) && ch.secrets.length);
    f.hiddenUntil = { secretIds: [a.secrets[0].id, b.secrets[0].id], lieIds: [] };
    expect(checkGuardDataWarnings(c).some((i) => i.path === `${f.id}.hiddenUntil` && i.message.includes(a.id) && i.message.includes(b.id))).toBe(true);
  });
});

describe("DX7: unlessRevealed as an array, unlessBroken", () => {
  const p = (x: object) => ForbiddenPhraseSchema.parse({ text: "the junction switch", ...x });
  it("schema accepts a single id or an array; unlessBroken needs at least one id", () => {
    expect(p({ unlessRevealed: "s-a" }).unlessRevealed).toBe("s-a");
    expect(p({ unlessRevealed: ["s-a", "s-b"] }).unlessRevealed).toEqual(["s-a", "s-b"]);
    expect(() => p({ unlessRevealed: [] })).toThrow();
    expect(() => p({ unlessBroken: [] })).toThrow();
  });
  it("lifted once ANY listed secret is revealed, or ANY listed lie breaks (this exchange included)", () => {
    const multi = p({ unlessRevealed: ["s-a", "s-b"] });
    expect(isPhraseLive(multi, { revealedIds: [] })).toBe(true);
    expect(isPhraseLive(multi, { revealedIds: ["s-b"] })).toBe(false);
    const broken = p({ unlessBroken: ["l-x"] });
    const state = (status: string, exposed: string[] = []) =>
      forbiddenStateOf({ ctx: { secrets: [], intendedLies: [{ id: "l-x", status }] }, directives: { exposedLieIds: exposed } });
    expect(findForbiddenPhrase("I threw the junction switch.", [broken], state("maintain"))).not.toBeNull();
    expect(findForbiddenPhrase("I threw the junction switch.", [broken], state("exposed"))).toBeNull();
    expect(findForbiddenPhrase("I threw the junction switch.", [broken], state("retired"))).toBeNull();
    expect(findForbiddenPhrase("I threw the junction switch.", [broken], state("maintain", ["l-x"]))).toBeNull();
    expect(compileForbiddenPhrase(broken).test("the Junction  Switch")).toBe(true);
  });
  it("the validator rejects an unlessBroken id that isn't the speaker's own lie", async () => {
    const { checkCaseReferences } = await import("@/engine/case-validation");
    const c = clone(bw);
    const ch = c.characters[0];
    ch.forbiddenPhrases.push(ForbiddenPhraseSchema.parse({ text: "zzz", unlessBroken: ["l-nobody"], unlessRevealed: [ch.secrets[0].id] }));
    expect(checkCaseReferences(c).some((i) => i.path === `forbiddenPhrases.${ch.forbiddenPhrases.length - 1}.unlessBroken.0`)).toBe(true);
    expect(checkCaseReferences(c).some((i) => i.path?.startsWith(`forbiddenPhrases.${ch.forbiddenPhrases.length - 1}.unlessRevealed`))).toBe(false);
  });
});

const SOL = "cases/_tallyho/solution.json";
const sol = existsSync(SOL) ? JSON.parse(readFileSync(SOL, "utf8")) : {};
const READY = typeof sol.accompliceId === "string" && !!sol.accompliceAct;

describe.skipIf(!READY)("Tallyho: the stager's guilt (draft data, real lines)", () => {
  let c: LoadedCase;
  beforeAll(async () => {
    c = await loadCase("_tallyho");
  });
  /** `bare`: the case's own forbiddenPhrases dropped, so the generic guard (not the data) has to catch the line. */
  const turn = (who: string, bare = false) => {
    const data = bare ? { ...c, characters: c.characters.map((x) => ({ ...x, forbiddenPhrases: [] })) } : c;
    return prepareTurn({ caseData: data, game: createInitialGameState(data), characterId: who, question: "What happened at the Plunge?" }).guard;
  };
  const NONE = { overClaim: { covered: new Set<CulpritAct>() } };

  it("the stager's cheer secret is core guilt by derivation, and the case stays warning-free", { timeout: 120_000 }, () => {
    const acc = c.characters.find((x) => x.id === c.solution.accompliceId)!;
    const cheer = acc.secrets.find((s) => s.relatedFactIds.includes("ev-cheer-played"))!;
    expect(cheer.coreGuilt).toBeUndefined();
    expect(coreGuiltSecretIds(c).has(cheer.id)).toBe(true);
    expect(checkCaseWarnings(c)).toEqual([]);
    const [, a] = guiltProfiles(c);
    expect(a).toMatchObject({ role: "accomplice", murdererId: acc.id, weaponNames: [] });
    expect(a.coreObjects).toEqual(expect.arrayContaining(["cheer", "junction switch"]));
  });

  it.each([
    "At 22:38 I started the Cheer-Box and threw the junction switch.",
    "I played the cheer on the Cheer-Box, if you must know.",
    "Captain Bilge threw the junction switch himself, and I'm proud of it.",
  ])("the stager can't admit the act: %s", (line) => {
    expect(checkReply({ dialogue: line, admits: [] }, turn(c.solution.accompliceId!, true))?.reason).toBe("guilt_leak");
  });

  it.each([
    "I was at the wheel all evening, as any captain would be.",
    "At 22:30 I was on the bridge, at the wheel.",
    "I stood the first watch, as I always do.",
    "Behind that curtain I was being violently sick in a bucket. A captain's dignity: do not ask.",
  ])("the stager's ordinary lines pass the guilt check: %s", (line) => {
    const id = c.solution.accompliceId!;
    expect(findReplyGuiltLeakAny({ dialogue: line }, "", guiltProfiles(c), id, { speakerNames: speakerNamesOf(c, id) })).toBeNull();
  });

  it.each([
    ["ottilie", "The Captain started the Cheer-Box and threw the junction switch."],
    ["ottilie", "Captain Bilge played the cheer from the chartroom."],
    ["percy", "The skipper threw the switch, I'd stake my life on it."],
  ])("E8 for the accomplice: an innocent (%s) can't state the act as fact: %s", (who, line) => {
    expect(checkReply({ dialogue: line, admits: [] }, turn(who, true))?.reason).toBe("over_claim");
    expect(["over_claim", "forbidden_phrase"]).toContain(checkReply({ dialogue: line, admits: [] }, turn(who))?.reason);
  });

  it.each([
    ["ottilie", "I wonder whether the Captain started the Cheer-Box."],
    ["ottilie", "The Captain handed me the wheel at 22:36 and stepped through the curtain."],
    ["gherkina", "I heard the cheer at 22:38 like everyone else."],
  ])("suspicion and what an innocent saw still pass (%s): %s", (who, line) => {
    const [, a] = guiltProfiles(c);
    expect(findGuiltLeak(line, a, who, { speakerNames: speakerNamesOf(c, who), ...NONE })).toBeNull();
  });

  it("the murderer's profile still reads only the murderer (and the stager is an innocent speaker to it)", () => {
    const [m] = guiltProfiles(c);
    expect(m.murdererId).toBe(c.solution.murdererId);
    expect(m.role).toBeUndefined();
  });
});
