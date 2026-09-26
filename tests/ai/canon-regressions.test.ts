/**
 * Regression tests for QA issues #6 (canon time drift), #7 (dropped alibi)
 * and #13 (modern vocabulary), on the real Blackwood case.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { allowedTimes, checkTimes, extractTimes } from "@/ai/canon-check";
import { callGrok } from "@/ai/grok";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { buildSystemPrompt, ERA_RULE, TIME_RULE } from "@/ai/prompts/interrogation";
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

const fresh = () => ({ caseData: c, game: createInitialGameState(c) });
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

describe("extractTimes", () => {
  it.each([
    ["I saw her go at 21:20.", ["21:20"]],
    ["twenty past nine, sir", ["09:20", "21:20"]],
    ["a quarter to ten", ["09:45", "21:45"]],
    ["half past nine", ["09:30", "21:30"]],
    ["half nine", ["09:30", "21:30"]],
    ["seventeen minutes past nine", ["09:17", "21:17"]],
    ["nine o'clock", ["09:00", "21:00"]],
    ["nine fifteen", ["09:15", "21:15"]],
    ["twenty-one hundred hours", ["21:00"]],
    ["9 pm", ["09:00", "21:00"]],
    ["three minutes to nine", ["08:57", "20:57"]],
  ])("reads %s", (text, expected) => {
    expect(extractTimes(text)[0].candidates.map(hhmm).sort()).toEqual(expected);
  });

  it.each(["It cost £3.50.", "I waited ten minutes.", "One or two of them.", "Twenty years in service, sir."])(
    "ignores non-times: %s",
    (text) => expect(extractTimes(text)).toEqual([]),
  );
});

describe("#6 canon times", () => {
  it("lists Reginald's knowledge in time order with explicit HH:MM tags and no invented 21:20", () => {
    const ctx = buildCharacterContext(fresh(), "reginald");
    const sys = buildSystemPrompt(ctx, { exposedLieIds: [] });
    expect(sys).toContain("[20:57, The Hall] Victoria comes out of the library");
    expect(sys).not.toMatch(/\[21:20/);
    const tagged = sys.split("\n").filter((l) => /^- \[\d\d:\d\d/.test(l)).map((l) => l.slice(3, 8));
    expect([...tagged].sort()).toEqual(tagged);
    expect(sys).toContain(TIME_RULE);
    expect(sys).toContain("I couldn't say, sir");
  });

  it("the post-check rejects a non-canon time and accepts canon ones", () => {
    const ctx = buildCharacterContext(fresh(), "reginald");
    const allowed = allowedTimes(ctx, { exposedLieIds: [] }, "When did her ladyship leave the library?");
    expect(checkTimes("Her ladyship left the library at twenty past nine, sir.", allowed).ok).toBe(false);
    expect(checkTimes("At 21:20 I saw her go.", allowed).offending).toEqual(["21:20"]);
    expect(checkTimes("Her ladyship came out of the library at three minutes to nine, sir.", allowed).ok).toBe(true);
    expect(checkTimes("At 20:57, sir, she swept past me.", allowed).ok).toBe(true);
    expect(checkTimes("Just before nine o'clock, sir.", allowed).ok).toBe(true); // hour-only, within 5 min of 20:57
    expect(checkTimes("I couldn't say, sir.", allowed).ok).toBe(true);
    // A time the detective used in the question may be echoed.
    const echo = allowedTimes(ctx, { exposedLieIds: [] }, "Was it 21:05?");
    expect(checkTimes("21:05? I couldn't say, sir.", echo).ok).toBe(true);
  });

  it("callGrok retries once with feedback, then fails with canon_check_failed", async () => {
    const bad = goodReply({ dialogue: "I saw her ladyship leave the library at twenty past nine, sir." });
    const { calls } = mockGrok({ content: bad });
    const r = await callGrok({ system: "s", user: "u", env: TEST_ENV, validate: (x) => (x.dialogue.includes("twenty past") ? "bad time" : null) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("canon_check_failed");
    expect(calls).toHaveLength(2);
    expect(calls[1].body.messages.at(-1).content).toContain("bad time");
  });

  it("a mocked model reply stating a non-canon time is rejected, retried, then falls back", async () => {
    const bad = goodReply({ dialogue: "Her ladyship left the library at twenty past nine, sir. I saw her plain as day." });
    const { calls } = mockGrok({ content: bad });
    const r = await handleInterrogate(
      { characterId: "reginald", question: "When did Lady Victoria leave the library?" },
      { caseData: c, env: TEST_ENV },
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].body.messages.at(-1).content).toContain("twenty past nine");
    expect(r.body.source).toBe("fallback");
    expect(r.body.error).toBe("canon_check_failed");
    expect(r.body.response.dialogue).not.toMatch(/twenty past nine/i);
    expect(checkTimes(r.body.response.dialogue, new Set([20 * 60 + 57])).ok).toBe(true);
  });

  it("a bad first reply followed by a canon retry is accepted", async () => {
    const bad = goodReply({ dialogue: "At 21:20, sir." });
    const good = goodReply({ dialogue: "Her ladyship came out of the library at three minutes to nine, sir." });
    const { calls } = mockGrok({ content: bad }, { content: good });
    const r = await handleInterrogate(
      { characterId: "reginald", question: "When did Lady Victoria leave the library?" },
      { caseData: c, env: TEST_ENV },
    );
    expect(calls).toHaveLength(2);
    expect(r.body.source).toBe("model");
    expect(r.body.response.dialogue).toContain("three minutes to nine");
  });
});

describe("#7 locked secrets and unbroken lies", () => {
  it("Victoria's context withholds the truth of her blackout movements while locked", () => {
    const ctx = buildCharacterContext(fresh(), "victoria");
    const ids = ctx.knowledge.map((k) => k.id);
    expect(ids).not.toContain("ev-victoria-alone");
    expect(ids).not.toContain("ev-murder");
    for (const k of ctx.knowledge) {
      const t = k.time ?? k.from;
      if (t) expect(t >= "21:14" && t <= "21:20", `${k.id} at ${t}`).toBe(false);
    }
    expect(ctx.secrets).toEqual([]);
    for (const s of c.characters.find((x) => x.id === "victoria")!.secrets) {
      expect(JSON.stringify(ctx)).not.toContain(s.description);
    }
    expect(ctx.intendedLies.find((l) => l.id === "l-victoria-together")?.status).toBe("maintain");
  });

  it("the prompt presents her alibi as MAINTAIN THIS STORY with no hidden-secret section", () => {
    const sys = buildSystemPrompt(buildCharacterContext(fresh(), "victoria"), { exposedLieIds: [] });
    expect(sys).toContain(
      'MAINTAIN THIS STORY (whereabouts during the blackout): "Archibald and I sat by the dining-room fire the whole blackout, darling. Neither of us left."',
    );
    expect(sys).toMatch(/reject the premise/);
    expect(sys).not.toContain("HIDDEN SECRETS");
    expect(sys).toContain("Do not confess anything this turn.");
  });

  it.each(["victoria", "archibald", "gregory", "reginald"])("no locked secret description reaches %s's prompt", (id) => {
    const sys = buildSystemPrompt(buildCharacterContext(fresh(), id), { exposedLieIds: [] });
    for (const s of c.characters.find((x) => x.id === id)!.secrets) expect(sys).not.toContain(s.description);
  });

  it("an engine-revealed secret gets the truth; an exposed lie is marked EXPOSED", () => {
    const g = createInitialGameState(c);
    const reginald = c.characters.find((x) => x.id === "reginald")!;
    const theft = reginald.secrets.find((s) => s.id === "s-reginald-theft")!;
    g.characters.reginald.revealedSecretIds = [theft.id];
    const lie = reginald.intendedLies.find((l) => l.brokenByEvidenceIds.length > 0)!;
    g.discoveredEvidenceIds.push(...lie.brokenByEvidenceIds);
    g.characters.reginald.evidenceShownIds = [...lie.brokenByEvidenceIds];
    const ctx = buildCharacterContext({ caseData: c, game: g }, "reginald");
    expect(ctx.secrets.map((s) => s.description)).toEqual([theft.description]);
    const sys = buildSystemPrompt(ctx, { exposedLieIds: [] });
    expect(sys).toContain("ALREADY ADMITTED");
    expect(sys).toContain(theft.description);
    expect(sys).toContain(`EXPOSED${lie.topic ? ` (${lie.topic})` : ""}: "${lie.claim}"`);
    expect(sys).not.toContain(`MAINTAIN THIS STORY${lie.topic ? ` (${lie.topic})` : ""}: "${lie.claim}"`);
  });

  it("the handler's live prompt for Victoria carries the maintained alibi and no secret", async () => {
    mockGrok({ content: goodReply({ dialogue: "Archibald and I never left the fire, darling." }) });
    let system = "";
    const token = encodeStateToken(createInitialGameState(c), TEST_ENV);
    await handleInterrogate(
      { characterId: "victoria", question: "Archibald says he left you alone. Where were you?", stateToken: token },
      { caseData: c, env: TEST_ENV, onPrompt: (p) => (system = p.system) },
    );
    expect(system).toContain("MAINTAIN THIS STORY (whereabouts during the blackout)");
    for (const s of c.characters.find((x) => x.id === "victoria")!.secrets) expect(system).not.toContain(s.description);
  });
});

describe("#13 era vocabulary", () => {
  it("every character's prompt carries the 1920s vocabulary rule", () => {
    for (const ch of c.characters) {
      const sys = buildSystemPrompt(buildCharacterContext(fresh(), ch.id), { exposedLieIds: [] });
      expect(sys).toContain(ERA_RULE);
      expect(ERA_RULE).toMatch(/emoji/);
      expect(ERA_RULE).toMatch(/system prompt/);
    }
  });
});
