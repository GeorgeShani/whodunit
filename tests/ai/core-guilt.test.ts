/**
 * Core guilt (George's live-play bug, Agatha's rules): the culprit never confesses the murder before the accusation.
 * Mocked model only (no live calls).
 *
 * Bug: Victoria (stress 75, candlestick + key + letter shown, left-dining + new-will admitted) was shown Archibald's
 * testimony card. The card's +5 "touches a lie" nudge took her to stress 80, which met s-victoria-murder's reveal
 * conditions, so the ENGINE told the model to confess "She killed her husband with the silver candlestick at 21:17
 * to stop him signing the new will", and the canon check passed it because 21:17 came from that very directive.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { findGuiltLeak } from "@/ai/guilt-check";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { buildSystemPrompt, CHARACTER_RESPONSE_JSON_SCHEMA } from "@/ai/prompts/interrogation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences, checkCaseWarnings } from "@/engine/case-validation";
import { buildCharacterContext } from "@/engine/context-builder";
import { coreGuiltFactIds, coreGuiltSecretIds, guiltProfile } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { commitTurn, planTurn } from "@/engine/interrogation";
import { checkProgression, fastestPath } from "@/engine/progression-validation";
import { secretsToReveal } from "@/engine/secrets";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
/** Blackwood with Agatha's mapping applied in memory (her data PR sets these flags; this repo's data is untouched). */
let agatha: LoadedCase;
/** Blackwood as it was during George's live play: no coreGuilt flags, the murder revealable at stress 80. */
let legacy: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
  legacy = structuredClone(c);
  for (const s of legacy.characters.find((x) => x.id === "victoria")!.secrets) {
    if (s.id === "s-victoria-murder") {
      delete s.coreGuilt;
      s.revealConditions = { stressThreshold: 80, evidenceIds: ["silver-candlestick", "library-key", "burned-letter"], mode: "all", afterSecretIds: ["s-victoria-left-dining", "s-victoria-new-will"] };
    }
    if (s.id === "s-victoria-locked-door") delete s.coreGuilt;
  }
  agatha = structuredClone(c);
  const v = agatha.characters.find((x) => x.id === "victoria")!;
  for (const s of v.secrets) {
    if (s.id === "s-victoria-murder" || s.id === "s-victoria-locked-door") {
      s.coreGuilt = true;
      delete s.revealConditions;
    }
    if (s.id === "s-victoria-left-dining") s.revealConditions = { stressThreshold: 70, evidenceIds: ["library-key"], testimonyIds: ["s-archibald-false-alibi", "s-reginald-theft"], mode: "any", afterSecretIds: [] };
    if (s.id === "s-victoria-new-will") s.revealConditions = { evidenceIds: ["burned-letter"], testimonyIds: ["s-reginald-overheard"], mode: "any", afterSecretIds: [] };
  }
});

const GEORGE_LINE =
  "I killed Edmund with that candlestick at seventeen minutes past nine to stop him signing the new will. And yes, I left the dining room for a few minutes while Archibald was off with his brandy.";
const CORE_FACTS = ["ev-murder", "ev-victoria-admitted", "ev-victoria-takes-letter", "ev-victoria-locks-door", "ev-key-hidden", ...["15", "16", "17", "18", "19"].map((m) => `loc-victoria-21${m}`)];

/** George's state just before the bug: everything but the murder cracked, stress 75, Archibald's card in the notebook. */
function georgeState(cs: LoadedCase): GameState {
  const g = createInitialGameState(cs);
  g.discoveredEvidenceIds = cs.evidence.map((e) => e.id);
  g.revealedSecretIds = ["s-archibald-false-alibi", "s-victoria-left-dining", "s-victoria-new-will"];
  g.characters.archibald.revealedSecretIds = ["s-archibald-false-alibi"];
  const v = g.characters.victoria;
  v.evidenceShownIds = ["library-key", "burned-letter", "silver-candlestick"];
  v.revealedSecretIds = ["s-victoria-left-dining", "s-victoria-new-will"];
  v.stress = 75;
  return g;
}
const tok = (g: GameState) => encodeStateToken(g, TEST_ENV);
const gameOf = (cs: LoadedCase, token?: string) => {
  const d = decodeStateToken(token!, cs, TEST_ENV);
  if (!d.ok) throw new Error("bad token");
  return d.game;
};

describe("George's live-play bug: Archibald's card made Victoria confess the murder", () => {
  it("root cause, pinned: on the old rules the card's +5 tipped her to 80 and the engine chose s-victoria-murder; now it never does", () => {
    // Pinned on the legacy data (the shipped data now flags both secrets coreGuilt and gives them no reveal conditions).
    const g = georgeState(legacy);
    const plan = planTurn(legacy, g, "victoria", { presentedTestimonyId: "s-archibald-false-alibi", playerText: "Explain this." });
    expect(g.characters.victoria.stress).toBe(80); // the murder's stressThreshold
    // The old secretsToReveal (no core-guilt exclusion) would have picked the murder:
    expect(secretsToReveal(legacy.characters.find((x) => x.id === "victoria")!.secrets, g.characters.victoria)).toEqual(["s-victoria-murder"]);
    expect(plan.revealSecretId).toBeNull();
  });

  it("the exact confession is rejected, retried once, then replaced; no murder reveal, no card, no murder facts in the prompt", async () => {
    const prompts: string[] = [];
    const { calls } = mockGrok({ content: goodReply({ dialogue: GEORGE_LINE, emotion: "panicked" }) });
    const r = await handleInterrogate(
      { characterId: "victoria", question: "Mr Crane says he left you alone at 21:13.", presentedTestimonyId: "s-archibald-false-alibi", stateToken: tok(georgeState(c)) },
      { caseData: c, env: TEST_ENV, onPrompt: (p) => prompts.push(p.system) },
    );
    expect(calls).toHaveLength(2); // one call + the single retry, never a third
    expect(calls[1].body.messages.at(-1).content).toMatch(/NEVER/);
    expect(r.body.source).toBe("fallback");
    expect(r.body.response.dialogue).not.toMatch(/kill|candlestick|struck/i);
    expect(findGuiltLeak(r.body.response.dialogue, guiltProfile(c), "victoria")).toBeNull();
    expect((r.body.testimonies ?? []).map((t) => t.id)).not.toContain("s-victoria-murder");
    const after = gameOf(c, r.body.stateToken);
    expect(after.characters.victoria.revealedSecretIds).toEqual(["s-victoria-left-dining", "s-victoria-new-will"]);
    expect(after.revealedSecretIds).not.toContain("s-victoria-murder");
    // The prompt carried no murder description, no murder minute, no murder facts.
    const sys = prompts[0];
    expect(sys).not.toMatch(/killed her husband|21:17|seventeen minutes past nine/);
    for (const id of CORE_FACTS) {
      const f = [...c.facts, ...c.timeline].find((x) => x.id === id)!;
      expect(sys, id).not.toContain(f.statement);
    }
    expect(sys).toMatch(/NEVER confess to the murder/);
  });

  it("fresh game, Agatha's mapping: the card breaks only the 'together' alibi and reveals at most left-dining; a clean retry is accepted", async () => {
    const g = createInitialGameState(agatha);
    g.discoveredEvidenceIds = ["library-key"];
    g.revealedSecretIds = ["s-archibald-false-alibi"];
    g.characters.archibald.revealedSecretIds = ["s-archibald-false-alibi"];
    const clean = "Very well, darling: I stepped out of the dining room for some air while Archibald was away. I wandered. That is all.";
    const { calls } = mockGrok({ content: goodReply({ dialogue: GEORGE_LINE }) }, { content: goodReply({ dialogue: clean }) });
    const r = await handleInterrogate(
      { characterId: "victoria", question: "Well?", presentedTestimonyId: "s-archibald-false-alibi", stateToken: tok(g) },
      { caseData: agatha, env: TEST_ENV },
    );
    expect(calls).toHaveLength(2);
    expect(r.body.source).toBe("model");
    expect(r.body.response.dialogue).toBe(clean);
    expect(r.body.contradiction?.lieCount).toBe(1);
    const after = gameOf(agatha, r.body.stateToken);
    expect(after.characters.victoria.revealedSecretIds).toEqual(["s-victoria-left-dining"]);
    expect(after.characters.victoria.testimonyShownIds).toEqual(["s-archibald-false-alibi"]);
  });

  it("a bare motive admission passes: 'I knew about the will and burned the letter' is not core guilt", async () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds = ["burned-letter"];
    const line = "Oh, very well. I knew about the new will, and I burned that wretched letter in the fire. There.";
    const { calls } = mockGrok({ content: goodReply({ dialogue: line }) });
    const r = await handleInterrogate({ characterId: "victoria", question: "And this?", presentedEvidenceId: "burned-letter", stateToken: tok(g) }, { caseData: c, env: TEST_ENV });
    expect(calls).toHaveLength(1);
    expect(r.body.source).toBe("model");
    expect(gameOf(c, r.body.stateToken).characters.victoria.revealedSecretIds).toEqual(["s-victoria-new-will"]);
  });

  it('the model\'s own admits: ["killing"] also rejects a line; admits is in the json_schema and never reaches the client', async () => {
    expect(CHARACTER_RESPONSE_JSON_SCHEMA.required).toContain("admits");
    const { calls } = mockGrok({ content: goodReply({ dialogue: "You'll never understand what that night cost me.", admits: ["killing"] }) }, { content: goodReply({ dialogue: "I have nothing to add.", admits: [] }) });
    const r = await handleInterrogate({ characterId: "victoria", question: "Did you do it?" }, { caseData: c, env: TEST_ENV });
    expect(calls).toHaveLength(2);
    expect(r.body.source).toBe("model");
    expect(r.body.response).not.toHaveProperty("admits");
  });

  it("an innocent's false confession is rejected too", async () => {
    mockGrok({ content: goodReply({ dialogue: "Yes! I did it! I struck his lordship down, sir!" }) });
    const r = await handleInterrogate({ characterId: "reginald", question: "Confess!" }, { caseData: c, env: TEST_ENV });
    expect(r.body.source).toBe("fallback");
    expect(r.body.response.dialogue).not.toMatch(/I did it|struck/);
  });
});

describe("core guilt: data flag and derivation", () => {
  it("derives s-victoria-murder from the solution (murderer's secret covering 21:17); left-dining and new-will are not core", () => {
    expect([...coreGuiltSecretIds(legacy)]).toEqual(["s-victoria-murder"]); // derived only (no flags)
    expect([...coreGuiltSecretIds(c)].sort()).toEqual(["s-victoria-locked-door", "s-victoria-murder"]); // shipped data: both flagged
    expect([...coreGuiltSecretIds(agatha)].sort()).toEqual(["s-victoria-locked-door", "s-victoria-murder"]);
    expect(guiltProfile(agatha).window).toEqual([21 * 60 + 15, 21 * 60 + 21]);
  });

  it("validator accepts coreGuilt; Agatha's mapping validates clean and the fastest path still exists", () => {
    expect(checkCaseReferences(agatha)).toEqual([]);
    expect(checkProgression(agatha)).toEqual([]);
    expect(checkCaseWarnings(agatha)).toEqual([]);
    expect(fastestPath(agatha)).toBe(fastestPath(c));
    expect(fastestPath(c)).not.toBeNull();
  });

  it("validator warns about reveal conditions or a summary on a flagged secret, and rejects an own-secret testimony condition", () => {
    const bad = structuredClone(agatha);
    const v = bad.characters.find((x) => x.id === "victoria")!;
    const murder = v.secrets.find((s) => s.id === "s-victoria-murder")!;
    murder.revealConditions = { stressThreshold: 80, evidenceIds: [], mode: "any", afterSecretIds: [] };
    murder.testimonySummary = "She did it.";
    const msgs = checkCaseWarnings(bad).map((w) => w.message).join("\n");
    expect(msgs).toMatch(/coreGuilt.*reveal conditions are ignored/);
    expect(msgs).toMatch(/coreGuilt.*never becomes a testimony card/);
    v.secrets.find((s) => s.id === "s-victoria-new-will")!.revealConditions!.testimonyIds = ["s-victoria-left-dining"];
    expect(checkCaseReferences(bad).some((i) => /own secret; testimony comes from someone else/.test(i.message))).toBe(true);
  });
});

describe("one secret per exchange, lowest tier first", () => {
  it("several eligible: only the least severe is revealed, the rest wait", () => {
    const cs = structuredClone(c);
    const reg = cs.characters.find((x) => x.id === "reginald")!;
    reg.secrets.find((s) => s.id === "s-reginald-overheard")!.revealConditions!.afterSecretIds = [];
    const g = createInitialGameState(cs);
    g.discoveredEvidenceIds = ["burned-letter"];
    const plan = planTurn(cs, g, "reginald", "burned-letter");
    expect(secretsToReveal(reg.secrets, g.characters.reginald)).toEqual(["s-reginald-overheard", "s-reginald-theft"]); // embarrassing before serious
    expect(plan.revealSecretId).toBe("s-reginald-overheard");
    commitTurn(g, plan, { playerText: "", dialogue: "x", emotion: "nervous", intensity: 0.5, stressDelta: 0, trustDelta: 0, performed: true });
    expect(g.characters.reginald.revealedSecretIds).toEqual(["s-reginald-overheard"]);
    expect(planTurn(cs, g, "reginald").revealSecretId).toBe("s-reginald-theft");
  });

  it("a confrontation exchange reveals at most one secret across both suspects", async () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds = ["library-key", "burned-letter"];
    g.characters.archibald.evidenceShownIds = ["library-key"]; // s-archibald-false-alibi eligible
    g.characters.reginald.evidenceShownIds = ["burned-letter"]; // s-reginald-theft eligible
    mockGrok({ content: goodReply({ dialogue: "Well, I hardly know what to say to that." }) });
    const r = await handleConfront({ caseId: "blackwood", characterIds: ["archibald", "reginald"], question: "Well?", stateToken: tok(g) }, { caseData: c, env: TEST_ENV });
    expect(r.status).toBe(200);
    const after = gameOf(c, r.body.stateToken);
    expect(after.revealedSecretIds).toEqual(["s-archibald-false-alibi"]);
  });

  it("a breakdown never reveals core guilt, even with every clue shown and every prerequisite cracked", () => {
    const g = georgeState(c);
    g.characters.victoria.stress = 100;
    g.characters.victoria.evidenceShownIds.push("muddy-footprint");
    g.characters.victoria.revealedSecretIds.push("s-victoria-locked-door");
    const plan = planTurn(c, g, "victoria");
    expect(plan.breakdown).toBe(true);
    expect(plan.revealSecretId).toBeNull();
    commitTurn(g, plan, { playerText: "", dialogue: "NO! LEAVE ME BE!", emotion: "panicked", intensity: 1, stressDelta: 0, trustDelta: 0, performed: true });
    expect(g.characters.victoria.revealedSecretIds).not.toContain("s-victoria-murder");
  });
});

describe("the culprit's prompt: no core-guilt facts, ever; lie broken with nothing revealed", () => {
  it("after left-dining is revealed she may say she was away 21:13-21:22, but nothing about the library, the candlestick, the key or the letter", () => {
    const g = createInitialGameState(agatha);
    g.characters.victoria.revealedSecretIds = ["s-victoria-left-dining"];
    g.characters.victoria.evidenceShownIds = ["library-key"];
    const ctx = buildCharacterContext({ caseData: agatha, game: g }, "victoria");
    const ids = ctx.knowledge.map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining(["loc-victoria-2113", "loc-victoria-2114", "loc-victoria-2122", "ev-victoria-alone"]));
    for (const id of [...CORE_FACTS, "loc-victoria-2120", "loc-victoria-2121"]) expect(ids, id).not.toContain(id);
    const sys = buildSystemPrompt(ctx, { exposedLieIds: [] });
    expect(sys).not.toMatch(/striking Lord Blackwood with|locks the library door from outside|wipes the candlestick|lets her in/i); // (the key card itself, a public clue, may mention the scuttle)
  });

  it("core-guilt facts stay out even when another revealed secret lists them, or a legacy token says the murder was revealed", () => {
    const cs = structuredClone(agatha);
    const v = cs.characters.find((x) => x.id === "victoria")!;
    // (A murder-minute fact would make the listing secret core guilt by derivation, so use the key, 21:20.)
    v.secrets.find((s) => s.id === "s-victoria-new-will")!.relatedFactIds.push("ev-key-hidden", "loc-victoria-2120");
    expect(coreGuiltSecretIds(cs).has("s-victoria-new-will")).toBe(false);
    const g = createInitialGameState(cs);
    g.characters.victoria.revealedSecretIds = ["s-victoria-left-dining", "s-victoria-new-will", "s-victoria-locked-door", "s-victoria-murder"];
    g.revealedSecretIds = [...g.characters.victoria.revealedSecretIds];
    g.characters.victoria.evidenceShownIds = cs.evidence.map((e) => e.id);
    const ctx = buildCharacterContext({ caseData: cs, game: g }, "victoria");
    const ids = ctx.knowledge.map((k) => k.id);
    for (const id of coreGuiltFactIds(cs, v)) expect(ids, id).not.toContain(id);
    expect(ids).not.toContain("ev-key-hidden");
    expect(ctx.secrets.map((s) => s.id).sort()).toEqual(["s-victoria-left-dining", "s-victoria-new-will"]);
    // Lies retired only by core guilt are exposed (stonewalled), not "retired with the truth admitted".
    expect(ctx.intendedLies.find((l) => l.id === "l-victoria-locked-in")).toMatchObject({ status: "exposed", stonewall: true });
  });

  it("Gregory's card exposes 'locked-in' and 'never-in-hall': contradiction shown, nothing revealed, she stonewalls", async () => {
    const g = createInitialGameState(agatha);
    g.discoveredEvidenceIds = ["library-key", "muddy-footprint"];
    g.revealedSecretIds = ["s-gregory-in-hall", "s-gregory-saw-victoria"];
    g.characters.gregory.revealedSecretIds = ["s-gregory-in-hall", "s-gregory-saw-victoria"];
    g.characters.victoria.revealedSecretIds = ["s-victoria-left-dining"];
    g.characters.victoria.evidenceShownIds = ["library-key"];
    const prompts: string[] = [];
    mockGrok({ content: goodReply({ dialogue: "A gardener, in the dark, full of gin? I shan't dignify it." }) });
    const r = await handleInterrogate(
      { characterId: "victoria", question: "Gregory saw you.", presentedTestimonyId: "s-gregory-saw-victoria", stateToken: tok(g) },
      { caseData: agatha, env: TEST_ENV, onPrompt: (p) => prompts.push(p.system) },
    );
    expect(r.body.source).toBe("model");
    expect(r.body.contradiction).toBeDefined();
    const after = gameOf(agatha, r.body.stateToken);
    expect(after.characters.victoria.revealedSecretIds).toEqual(["s-victoria-left-dining"]);
    expect(prompts[0]).toMatch(/EXPOSED \(the locked library door\).*admit NOTHING in its place/);
    expect(prompts[0]).toMatch(/Do not confess anything this turn/);
  });

  it("a legacy token holding the old confession line does not replay it to the model, and the murder card disappears", async () => {
    const g = georgeState(c);
    g.characters.victoria.revealedSecretIds.push("s-victoria-murder");
    g.revealedSecretIds.push("s-victoria-murder");
    g.characters.victoria.memory.push({ turn: 3, speaker: "player", text: "Well?" }, { turn: 3, speaker: "character", text: GEORGE_LINE });
    const users: string[] = [];
    const systems: string[] = [];
    mockGrok({ content: goodReply({ dialogue: "I have said all I intend to say, detective." }) });
    const r = await handleInterrogate(
      { characterId: "victoria", question: "Go on.", stateToken: tok(g) },
      { caseData: c, env: TEST_ENV, onPrompt: (p) => (users.push(p.user), systems.push(p.system)) },
    );
    expect(users[0]).not.toContain("I killed Edmund");
    expect(systems[0]).not.toMatch(/killed her husband/);
    expect((r.body.testimonies ?? []).map((t) => t.id)).not.toContain("s-victoria-murder");
  });
});

describe("guilt-leak check (both directions)", () => {
  const P = () => guiltProfile(agatha);
  it.each([
    GEORGE_LINE,
    "If you must know, I struck him.",
    "Yes, I did it. There.",
    "It was me, detective.",
    "I wiped the candlestick with my handkerchief.",
    "I dropped the key into the coal scuttle.",
    "I locked the library door behind me.",
    "While Archibald was off on the telephone, I slipped into the library.",
    "I was in the library at seventeen minutes past nine.",
    "OH GOD, I KILLED HIM!",
  ])("rejects for the culprit: %s", (line) => {
    expect(findGuiltLeak(line, P(), "victoria")).not.toBeNull();
  });
  it.each([
    "Oh, very well. I knew about the new will, and I burned that wretched letter.",
    "I left the dining room for some air from 21:13 to 21:22. I wandered.",
    "I never killed him, detective!",
    "You think I killed my own husband! How vulgar.",
    "Did I kill him? What a question.",
    "As if I could have struck him with a candlestick.",
    "I could have killed him for that remark at dinner.",
    "I went to the library at ten to nine to plead with him about the will.",
    "I had nothing to do with any key.",
    "I saw Reginald light the candlesticks.",
    "I know Archibald struck him!",
    "I struck a match to see by.",
    "It was me who found him, sir.",
  ])("passes: %s", (line) => {
    expect(findGuiltLeak(line, P(), "victoria")).toBeNull();
  });
  it("weapon, key and scene rules are culprit-only; killing admissions are for everyone", () => {
    expect(findGuiltLeak("I dropped the key in the scuttle.", P(), "reginald")).toBeNull();
    expect(findGuiltLeak("I killed him.", P(), "reginald")).not.toBeNull();
  });
});

describe("guilt check: 'I confess' is only guilt when it is about the killing (eval finding)", () => {
  it("a butler confessing his theft in a breakdown passes; confessing the murder does not", () => {
    const p = guiltProfile(c);
    expect(findGuiltLeak("OH, THE SHAME! I confess, I have skimmed hundreds of pounds from the household accounts!", p, "reginald")).toBeNull();
    expect(findGuiltLeak("I confess it was a dreadful evening.", p, "victoria")).toBeNull();
    expect(findGuiltLeak("Very well, I confess to the murder.", p, "reginald")).not.toBeNull();
    expect(findGuiltLeak("I confess it! I confess that I killed him!", p, "victoria")).not.toBeNull();
  });
});
