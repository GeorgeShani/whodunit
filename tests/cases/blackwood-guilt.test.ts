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
import { guiltProfile } from "@/engine/core-guilt";
import { planTurn } from "@/engine/interrogation";
import { secretsToReveal } from "@/engine/secrets";
import { findGuiltLeak } from "@/ai/guilt-check";
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
  // Burning at 21:20 the letter that lay on the desk at 21:12 would place her in the library (leak audit): core guilt now.
  "ev-letter-burned",
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
    // nothing time-bound involving her in the murder window, 21:15 (let into the library) to 21:21 (key and letter disposed of)
    if (k.time && k.involves.some((p) => /victoria/i.test(p))) {
      const m = gameMinutes(k.time, c.dayStartsAt);
      expect(m >= gameMinutes("21:15", c.dayStartsAt) && m <= gameMinutes("21:21", c.dayStartsAt), k.id).toBe(false);
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

  it("Archibald's card breaks only the 'together' story and reveals only the alibi crack (left-dining)", () => {
    const g = createInitialGameState(c);
    g.revealedSecretIds = ["s-archibald-false-alibi"];
    g.characters.archibald.revealedSecretIds = ["s-archibald-false-alibi"];
    const plan = planTurn(c, g, "victoria", { presentedTestimonyId: "s-archibald-false-alibi", playerText: "Explain this." });
    expect(plan.revealSecretId).toBe("s-victoria-left-dining");
    expect(plan.newlyExposedLieIds).toEqual(["l-victoria-together"]);
    g.characters.victoria.testimonyShownIds = ["s-archibald-false-alibi"];
    g.characters.victoria.revealedSecretIds.push("s-victoria-left-dining");
    const ctx = ctxOf(g);
    expect(ctx.secrets.map((x) => x.id)).toEqual(["s-victoria-left-dining"]);
    expect(ctx.intendedLies.filter((l) => l.status !== "maintain").map((l) => l.id)).toEqual(["l-victoria-together"]);
    expectNoGuilt(ctx);
  });

  it("Reginald's overheard card breaks only the menu story and reveals only the will admission (new-will)", () => {
    const g = createInitialGameState(c);
    g.revealedSecretIds = ["s-reginald-theft", "s-reginald-overheard"];
    g.characters.reginald.revealedSecretIds = ["s-reginald-theft", "s-reginald-overheard"];
    const plan = planTurn(c, g, "victoria", { presentedTestimonyId: "s-reginald-overheard", playerText: "Explain this." });
    expect(plan.revealSecretId).toBe("s-victoria-new-will");
    expect(plan.newlyExposedLieIds).toEqual(["l-victoria-menu"]);
    g.characters.victoria.testimonyShownIds = ["s-reginald-overheard"];
    g.characters.victoria.revealedSecretIds.push("s-victoria-new-will");
    const ctx = ctxOf(g);
    expect(ctx.secrets.map((x) => x.id)).toEqual(["s-victoria-new-will"]);
    expect(ctx.knowledge.map((k) => k.id)).not.toContain("ev-letter-burned");
    expectNoGuilt(ctx);
  });

  it("each testimony card exposes only the Victoria lies it contradicts, and reveals at most its one intended secret", () => {
    const expected: Record<string, string[]> = {
      "s-reginald-theft": ["l-victoria-together"],
      "s-reginald-overheard": ["l-victoria-menu"],
      "s-archibald-false-alibi": ["l-victoria-together"],
      "s-archibald-embezzlement": [],
      "s-gregory-in-hall": [],
      "s-gregory-saw-victoria": ["l-victoria-together", "l-victoria-locked-in", "l-victoria-never-in-hall"],
    };
    const reveals: Record<string, string | null> = {
      "s-reginald-theft": "s-victoria-left-dining",
      "s-reginald-overheard": "s-victoria-new-will",
      "s-archibald-false-alibi": "s-victoria-left-dining",
      "s-archibald-embezzlement": null,
      "s-gregory-in-hall": null,
      "s-gregory-saw-victoria": null,
    };
    expect(cards().sort()).toEqual(Object.keys(expected).sort());
    for (const [card, lies] of Object.entries(expected)) {
      const g = createInitialGameState(c);
      const owner = c.characters.find((ch) => ch.secrets.some((x) => x.id === card))!.id;
      g.revealedSecretIds = [card];
      g.characters[owner].revealedSecretIds = [card];
      const plan = planTurn(c, g, "victoria", { presentedTestimonyId: card, playerText: "?" });
      expect(plan.revealSecretId, card).toBe(reveals[card]);
      g.characters.victoria.testimonyShownIds = [card];
      const ctx = ctxOf(g);
      expect(ctx.intendedLies.filter((l) => l.status === "exposed").map((l) => l.id).sort(), card).toEqual(lies.sort());
      expect(ctx.secrets, card).toEqual([]);
      expectNoGuilt(ctx);
      if (plan.revealSecretId) {
        g.characters.victoria.revealedSecretIds.push(plan.revealSecretId);
        expectNoGuilt(ctxOf(g));
      }
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
      if (s.id === "s-victoria-murder" || s.id === "s-victoria-locked-door") {
        expect(s.coreGuilt, s.id).toBe(true);
        expect(s.revealConditions, s.id).toBeUndefined();
        expect(s.testimonySummary, s.id).toBeUndefined();
      }
      else for (const id of s.relatedFactIds) expect(MURDER_WINDOW, `${s.id}: ${id}`).not.toContain(id);
    }
    for (const id of MURDER_WINDOW) {
      const covered = v.secrets.filter((s) => s.relatedFactIds.includes(id) && s.revealConditions);
      expect(covered, id).toEqual([]);
      expect(v.secrets.some((s) => s.relatedFactIds.includes(id)), `${id} is covered by a core-guilt secret`).toBe(true);
    }
  });
});

/** Leak audit (cases/blackwood/docs/LEAK_AUDIT.md): authored text outside the core-guilt secrets never carries guilt. */
describe("leak audit: authored text", () => {
  const authored = (id: string): { where: string; text: string }[] => {
    const ch = c.characters.find((x) => x.id === id)!;
    const p = ch.personality;
    return [
      { where: "bio", text: ch.bio },
      { where: "speechStyle", text: p.speechStyle ?? "" },
      ...[...p.traits, ...(p.quirks ?? []), ...(p.tells ?? []), ...(p.catchphrases ?? [])].map((t) => ({ where: "personality", text: t })),
      ...ch.goals.map((t) => ({ where: "goal", text: t })),
      ...ch.beliefs.map((b) => ({ where: b.id, text: b.statement })),
      ...ch.intendedLies.map((l) => ({ where: l.id, text: l.claim })),
      ...ch.relationships.flatMap((r) => [
        { where: `rel:${r.targetCharacterId}`, text: r.description ?? "" },
        ...(r.jabs ?? []).map((j) => ({ where: `jab:${r.targetCharacterId}`, text: j.text })),
        ...(r.defensiveOn ?? []).map((d) => ({ where: `defensiveOn:${r.targetCharacterId}`, text: d.text })),
      ]),
    ];
  };

  it("no character's authored lines admit the killing, and Victoria's admit no weapon, door, key or scene", () => {
    const profile = guiltProfile(c)!;
    for (const ch of c.characters) for (const { where, text } of authored(ch.id)) expect(findGuiltLeak(text, profile, ch.id), `${ch.id} ${where}: ${text}`).toBeNull();
  });

  it("Victoria's file holds no guilt facts outside the coreGuilt secrets", () => {
    const v = c.characters.find((x) => x.id === "victoria")!;
    const GUILT = /\b(struck|strike|killed|kill|wiped|candlestick|coal scuttle|let (her|me) in|locked the (library )?door|the key|21:1[5-9]|21:2[01]|seventeen past|in the library (at|during|after))\b/i;
    for (const { where, text } of authored("victoria")) expect(text, where).not.toMatch(GUILT);
    for (const s of v.secrets.filter((x) => !x.coreGuilt)) {
      expect(s.description, s.id).not.toMatch(GUILT);
      expect(s.testimonySummary ?? "", s.id).not.toMatch(GUILT);
    }
    expect(v.beliefs.find((b) => b.id === "b-victoria-unseen")!.statement).not.toMatch(/\b(me|I)\b/);
  });

  it("the will admission unhides no timed fact: she admits burning the letter, never when", () => {
    const g = createInitialGameState(c);
    g.characters.victoria.revealedSecretIds = ["s-victoria-new-will"];
    g.characters.victoria.evidenceShownIds = ["burned-letter"];
    g.discoveredEvidenceIds = ["burned-letter"];
    const ids = ctxOf(g).knowledge.map((k) => k.id);
    expect(ids).not.toContain("ev-letter-burned");
    expect(ids).toContain("ev-victoria-argument");
    expect(ids).toContain("f-new-will");
  });

  it("before their own reveal, no non-culprit's prompt puts Victoria in the hall or the library between 21:13 and the scream", () => {
    const PLACES = /victoria[^.]{0,80}\b(library|hall)\b|\b(library|hall)\b[^.]{0,80}victoria/i;
    for (const ch of c.characters.filter((x) => x.id !== "victoria")) {
      const ctx = buildCharacterContext({ caseData: c, game: createInitialGameState(c) }, ch.id);
      for (const k of ctx.knowledge) {
        const m = k.time ? gameMinutes(k.time, c.dayStartsAt) : null;
        if (m !== null && m >= gameMinutes("21:13", c.dayStartsAt) && m < gameMinutes("21:30", c.dayStartsAt)) expect(k.statement, `${ch.id} ${k.id}`).not.toMatch(PLACES);
      }
      for (const b of ctx.beliefs) expect(b.statement, `${ch.id} ${b.id}`).not.toMatch(/her ladyship I saw|saw (her|lady victoria)/i);
    }
    // Reginald's alibi fact says where he was without giving away the pantry (his theft secret).
    expect(c.facts.find((f) => f.id === "f-reginald-saw-no-one")!.statement).not.toMatch(/pantry/i);
    expect(c.characters.find((x) => x.id === "gregory")!.personality.tells).not.toContain("glances towards Lady Victoria");
  });

  it("Gregory's eyewitness card makes Victoria stonewall: the exposed door lies carry the stonewall flag", () => {
    const g = createInitialGameState(c);
    g.characters.victoria.testimonyShownIds = ["s-gregory-saw-victoria"];
    const lies = ctxOf(g).intendedLies;
    for (const id of ["l-victoria-locked-in", "l-victoria-never-in-hall"]) expect(lies.find((l) => l.id === id)?.stonewall, id).toBe(true);
    expect(lies.find((l) => l.id === "l-victoria-together")?.stonewall).toBeUndefined();
  });
});

describe("testimony-triggered reveals (revealConditions.testimonyIds)", () => {
  it("no card can ever reveal a core-guilt secret: every card shown, every clue, stress 100", () => {
    const g = everything();
    for (const id of ["s-victoria-locked-door", "s-victoria-murder"]) {
      expect(g.characters.victoria.revealedSecretIds, id).not.toContain(id);
      expect(planTurn(c, g, "victoria", { playerText: "You killed him." }).revealSecretId).toBeNull();
    }
    for (const ch of c.characters) for (const s of ch.secrets.filter((x) => x.coreGuilt)) expect(s.revealConditions?.testimonyIds, s.id).toBeUndefined();
  });

  it("each testimonyIds entry names a card that genuinely contradicts the secret's cover story (one card, one crack)", () => {
    const testimony = Object.fromEntries(c.characters.flatMap((ch) => ch.secrets.filter((s) => s.revealConditions?.testimonyIds?.length).map((s) => [s.id, [...s.revealConditions!.testimonyIds!].sort()])));
    expect(testimony).toEqual({
      "s-victoria-left-dining": ["s-archibald-false-alibi", "s-reginald-theft"],
      "s-victoria-new-will": ["s-reginald-overheard"],
      "s-archibald-false-alibi": ["s-reginald-theft"],
    });
    // Every such card also breaks a lie the secret supersedes (so the crack is a real contradiction, not a free reveal).
    for (const ch of c.characters) for (const s of ch.secrets) for (const card of s.revealConditions?.testimonyIds ?? []) {
      const lies = ch.intendedLies.filter((l) => l.supersededBySecretIds.includes(s.id) && l.breaksOnSecretIds.includes(card));
      expect(lies.length, `${s.id} <- ${card}`).toBeGreaterThan(0);
    }
  });

  it("Reginald's theft card cracks Archibald's false alibi only (not the embezzlement)", () => {
    const g = createInitialGameState(c);
    g.revealedSecretIds = ["s-reginald-theft"];
    g.characters.reginald.revealedSecretIds = ["s-reginald-theft"];
    const plan = planTurn(c, g, "archibald", { presentedTestimonyId: "s-reginald-theft", playerText: "?" });
    expect(plan.revealSecretId).toBe("s-archibald-false-alibi");
    expect(plan.newlyExposedLieIds).toEqual(["l-archibald-together"]);
    g.characters.archibald.revealedSecretIds.push("s-archibald-false-alibi");
    g.characters.archibald.testimonyShownIds = ["s-reginald-theft"];
    expect(planTurn(c, g, "archibald", { playerText: "And?" }).revealSecretId).toBeNull();
  });
});
