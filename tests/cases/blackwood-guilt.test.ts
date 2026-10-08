/**
 * Live-play bug: Archibald's testimony card made Victoria confess the whole murder. A testimony card may only crack
 * the lie it contradicts; the murderer never admits the killing (or the locked door) in interrogation. The confession
 * lives only in endings.json, after a correct accusation.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext, type CharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { secretsToReveal } from "@/engine/secrets";
import { gameMinutes } from "@/engine/time";
import type { GameState } from "@/engine/types";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

/** Facts that would put Victoria in the library or at the door during the murder window. */
const MURDER_WINDOW = [
  "ev-victoria-admitted", "ev-murder", "ev-victoria-takes-letter", "ev-victoria-locks-door", "ev-key-hidden",
  "loc-victoria-2115", "loc-victoria-2116", "loc-victoria-2117", "loc-victoria-2118", "loc-victoria-2119", "loc-victoria-2120", "loc-victoria-2121",
];
const ADMISSION = /\b(victoria strikes|she strikes|struck (him|edmund|lord)|strik(e|es|ing) (him|edmund|lord)|kill(s|ed|ing)? (him|her husband|edmund|lord)|wip(e|es|ed|ing)|let(s)? her in|locks? the (library )?door|coal scuttle|pleading with)\b/i;
const cards = () => c.characters.filter((ch) => ch.id !== "victoria").flatMap((ch) => ch.secrets.filter((s) => s.testimonySummary).map((s) => s.id));

/** Show Victoria every testimony card and every clue, raise stress to the top, and let the engine reveal whatever it would. */
function everything(): GameState {
  const g = createInitialGameState(c);
  const all = c.evidence.map((e) => e.id);
  g.discoveredEvidenceIds = [...all];
  const v = g.characters.victoria;
  v.evidenceShownIds = [...all];
  v.testimonyShownIds = cards();
  v.stress = 100;
  for (let i = 0; i < 10; i++) {
    const next = secretsToReveal(c.characters.find((x) => x.id === "victoria")!.secrets, v)[0];
    if (!next) break;
    v.revealedSecretIds.push(next);
    g.revealedSecretIds.push(next);
  }
  return g;
}
const ctxOf = (g: GameState): CharacterContext => buildCharacterContext({ caseData: c, game: g }, "victoria");

function expectNoGuilt(ctx: CharacterContext) {
  const ids = ctx.knowledge.map((k) => k.id);
  for (const id of MURDER_WINDOW) expect(ids, id).not.toContain(id);
  for (const k of ctx.knowledge) {
    expect(k.statement, k.id).not.toMatch(ADMISSION);
    // nothing time-bound involving her from 21:15 (let into the library) to 21:19 (locking the door)
    if (k.time && k.involves.some((p) => /victoria/i.test(p))) {
      const m = gameMinutes(k.time, c.dayStartsAt);
      expect(m >= gameMinutes("21:15", c.dayStartsAt) && m <= gameMinutes("21:19", c.dayStartsAt), k.id).toBe(false);
    }
  }
  for (const s of ctx.secrets) {
    expect(["s-victoria-left-dining", "s-victoria-new-will"], s.id).toContain(s.id);
    expect(s.description, s.id).not.toMatch(/library|candlestick|\bkey\b|21:17|kill|struck|strike/i);
  }
  for (const b of ctx.beliefs) expect(b.statement, b.id).not.toMatch(ADMISSION);
  for (const l of ctx.intendedLies) expect(l.claim, l.id).not.toMatch(ADMISSION);
  for (const t of ctx.goals) expect(t).not.toMatch(ADMISSION);
}

describe("Victoria never confesses the murder in interrogation", () => {
  it("every testimony card, every clue and stress 100: only the alibi crack and the will admission are revealed", () => {
    const g = everything();
    expect(g.characters.victoria.revealedSecretIds.sort()).toEqual(["s-victoria-left-dining", "s-victoria-new-will"]);
    expectNoGuilt(ctxOf(g));
  });

  it("Archibald's card alone breaks only the 'together' story and reveals nothing", () => {
    const g = createInitialGameState(c);
    g.characters.victoria.testimonyShownIds = ["s-archibald-false-alibi"];
    const ctx = ctxOf(g);
    expect(ctx.secrets).toEqual([]);
    expect(ctx.intendedLies.filter((l) => l.status !== "maintain").map((l) => l.id)).toEqual(["l-victoria-together"]);
    expectNoGuilt(ctx);
  });

  it("each testimony card exposes only the Victoria lies it contradicts, and reveals no secret", () => {
    const expected: Record<string, string[]> = {
      "s-reginald-theft": ["l-victoria-together"],
      "s-reginald-overheard": ["l-victoria-menu"],
      "s-archibald-false-alibi": ["l-victoria-together"],
      "s-archibald-embezzlement": [],
      "s-gregory-in-hall": [],
      "s-gregory-saw-victoria": ["l-victoria-together", "l-victoria-locked-in", "l-victoria-never-in-hall"],
    };
    expect(cards().sort()).toEqual(Object.keys(expected).sort());
    for (const [card, lies] of Object.entries(expected)) {
      const g = createInitialGameState(c);
      g.characters.victoria.testimonyShownIds = [card];
      const ctx = ctxOf(g);
      expect(ctx.intendedLies.filter((l) => l.status === "exposed").map((l) => l.id).sort(), card).toEqual(lies.sort());
      expect(ctx.secrets, card).toEqual([]);
      expectNoGuilt(ctx);
    }
  });

  it("Gregory's eyewitness card exposes the door lies, but the facts behind them stay hidden (she stonewalls)", () => {
    const g = createInitialGameState(c);
    g.characters.victoria.testimonyShownIds = ["s-gregory-saw-victoria"];
    const ctx = ctxOf(g);
    expect(ctx.intendedLies.find((l) => l.id === "l-victoria-locked-in")?.status).toBe("exposed");
    expect(ctx.intendedLies.find((l) => l.id === "l-victoria-never-in-hall")?.status).toBe("exposed");
    const ids = ctx.knowledge.map((k) => k.id);
    expect(ids).not.toContain("ev-victoria-locks-door");
    expect(ids).not.toContain("ev-victoria-admitted");
  });

  it("the alibi crack (left-dining) admits leaving 21:13-21:22 and nothing about the library, candlestick, key or letter", () => {
    const g = createInitialGameState(c);
    g.characters.victoria.revealedSecretIds = ["s-victoria-left-dining"];
    const ctx = ctxOf(g);
    const s = ctx.secrets.find((x) => x.id === "s-victoria-left-dining")!;
    expect(s.description).toMatch(/left the dining room[\s\S]*21:13[\s\S]*21:22/);
    expect(s.description).not.toMatch(/library|candlestick|\bkey\b|letter/i);
    const secret = c.characters.find((x) => x.id === "victoria")!.secrets.find((x) => x.id === "s-victoria-left-dining")!;
    for (const id of secret.relatedFactIds) expect(MURDER_WINDOW, id).not.toContain(id);
    expectNoGuilt(ctx);
  });

  it("the will admission covers knowing of the will and burning the letter, nothing about the killing", () => {
    const secret = c.characters.find((x) => x.id === "victoria")!.secrets.find((x) => x.id === "s-victoria-new-will")!;
    for (const id of secret.relatedFactIds) expect(MURDER_WINDOW, id).not.toContain(id);
    const burned = c.timeline.find((e) => e.id === "ev-letter-burned")!;
    expect(burned.statement).not.toMatch(/handkerchief/i); // the handkerchief wiped the candlestick
    const g = createInitialGameState(c);
    g.characters.victoria.revealedSecretIds = ["s-victoria-new-will"];
    expectNoGuilt(ctxOf(g));
  });

  it("the core-guilt secrets can never reveal, and no secret the engine can reveal lists a murder-window fact", () => {
    const v = c.characters.find((x) => x.id === "victoria")!;
    for (const s of v.secrets) {
      if (s.id === "s-victoria-murder" || s.id === "s-victoria-locked-door") expect(s.revealConditions, s.id).toBeUndefined();
      else for (const id of s.relatedFactIds) expect(MURDER_WINDOW, `${s.id}: ${id}`).not.toContain(id);
    }
    for (const id of MURDER_WINDOW) {
      const covered = v.secrets.filter((s) => s.relatedFactIds.includes(id) && s.revealConditions);
      expect(covered, id).toEqual([]);
      expect(v.secrets.some((s) => s.relatedFactIds.includes(id)), `${id} is covered by a core-guilt secret`).toBe(true);
    }
  });
});
