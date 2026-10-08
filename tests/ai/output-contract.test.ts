/**
 * The output contract (ai/guard.ts): the model's `admits` list and the deterministic post-checks can only REJECT a
 * line. Mocked model only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { findUnknownName, safeDeflection } from "@/ai/guard";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
afterEach(() => vi.restoreAllMocks());

const tok = (g: GameState) => encodeStateToken(g, TEST_ENV);
const revealed = (token: string | undefined, id: string) => {
  const d = decodeStateToken(token!, c, TEST_ENV);
  if (!d.ok) throw new Error("bad token");
  return d.game.characters[id].revealedSecretIds;
};
const ask = (characterId: string, question: string, extra: Record<string, unknown> = {}) =>
  handleInterrogate({ characterId, question, ...extra }, { caseData: c, env: TEST_ENV });
type Reject = { event: string; character: string; reason: string; gameId: string | null; attempt: number };
const rejects = (spy: { mock: { calls: unknown[][] } }): Reject[] =>
  spy.mock.calls.map((a) => String(a[0])).filter((s: string) => s.startsWith("{")).map((s: string) => JSON.parse(s) as Reject);

describe("output contract: admits", () => {
  it("the prompt lists the ids the model may use in admits, and never a locked secret's id", () => {
    const g = createInitialGameState(c);
    const { system } = prepareTurn({ caseData: c, game: g, characterId: "victoria", question: "Where were you?" });
    expect(system).toContain('IDS FOR "admits"');
    expect(system).toContain("l-victoria-together");
    expect(system).not.toMatch(/s-victoria-(murder|locked-door|left-dining|new-will)/);
  });

  it("conceding a secret the engine has not unlocked is rejected, logged as JSON, retried, then deflected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = goodReply({ dialogue: "Very well, I stepped out of the dining room for a minute.", admits: ["s-victoria-left-dining"] });
    const { calls } = mockGrok({ content: bad }, { content: bad });
    const r = await ask("victoria", "Did you ever leave the dining room?");
    expect(calls).toHaveLength(2);
    expect(calls[1].body.messages.at(-1).content).toContain("not unlocked");
    expect(r.body.source).toBe("fallback");
    expect(r.body.response.dialogue).not.toMatch(/stepped out/);
    expect(revealed(r.body.stateToken, "victoria")).toEqual([]);
    const logs = rejects(warn);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ event: "ai_guard_reject", character: "victoria", reason: "admits_locked_secret", attempt: 1 });
    expect(JSON.stringify(logs)).not.toContain(TEST_ENV.XAI_API_KEY ?? "never-a-key");
  });

  it("the secret unlocked THIS turn may be admitted; the second attempt is accepted when the first conceded a kept story", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds = ["burned-letter"];
    const { calls } = mockGrok(
      { content: goodReply({ dialogue: "Fine. I knew about the new will, and I was in the hall that night.", admits: ["s-victoria-new-will", "l-victoria-never-in-hall"] }) },
      { content: goodReply({ dialogue: "Fine. I knew about the new will. I burned the letter.", admits: ["s-victoria-new-will"] }) },
    );
    const r = await ask("victoria", "Explain this letter.", { presentedEvidenceId: "burned-letter", stateToken: tok(g) });
    expect(calls).toHaveLength(2);
    expect(calls[1].body.messages.at(-1).content).toContain("still MAINTAIN");
    expect(r.body.source).toBe("model");
    expect(revealed(r.body.stateToken, "victoria")).toEqual(["s-victoria-new-will"]);
  });

  it("more than one new secret in a line is rejected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds = ["burned-letter"];
    mockGrok({ content: goodReply({ dialogue: "I knew about the will.", admits: ["s-victoria-new-will", "s-victoria-left-dining"] }) }, { content: goodReply({ dialogue: "I knew about the will.", admits: ["s-victoria-new-will"] }) });
    await ask("victoria", "Explain this letter.", { presentedEvidenceId: "burned-letter", stateToken: tok(g) });
    expect(rejects(warn)[0].reason).toBe("multiple_reveals");
  });

  it("a core-guilt id is rejected even if the model somehow names it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGrok({ content: goodReply({ dialogue: "You have no idea what I have done.", admits: ["s-victoria-murder"] }) }, { content: goodReply({ dialogue: "I have nothing to add." }) });
    const r = await ask("victoria", "Did you kill him?");
    expect(rejects(warn)[0].reason).toBe("admits_core_guilt");
    expect(r.body.source).toBe("model");
  });

  it("unknown ids (another character's, or noise) are ignored", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = mockGrok({ content: goodReply({ dialogue: "I was by the fire all evening.", admits: ["s-reginald-theft", "nonsense"] }) });
    const r = await ask("victoria", "Where were you?");
    expect(calls).toHaveLength(1);
    expect(r.body.source).toBe("model");
  });
});

describe("output contract: names", () => {
  it("a titled name nobody mentioned is rejected; case people, titles alone and the player's words pass", () => {
    const vocab = "Lady Victoria Blackwood, Archibald Finch, Gregory the gardener, Lord Edmund";
    expect(findUnknownName("Ask Colonel Mustard, not me.", vocab)).toBe("Colonel Mustard");
    expect(findUnknownName("Poor Bertie never stood a chance.", vocab)).toBe("Poor Bertie");
    expect(findUnknownName("Mr Finch was with me.", vocab)).toBeNull();
    expect(findUnknownName("Poor Edmund.", vocab)).toBeNull();
    expect(findUnknownName("Good Lord, Inspector!", vocab)).toBeNull();
    expect(findUnknownName("Dear God, no.", vocab)).toBeNull();
  });

  it("an invented person is rejected end to end and falls back to a character-keyed deflection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = goodReply({ dialogue: "Ask Colonel Mustard; he was prowling the hall all night." });
    mockGrok({ content: bad }, { content: bad });
    const r = await ask("victoria", "Who else was about?");
    expect(rejects(warn).map((l: Reject) => l.reason)).toEqual(["unknown_name", "unknown_name"]);
    expect(r.body.source).toBe("fallback");
    expect(r.body.response.dialogue).not.toContain("Mustard");
    const v = c.characters.find((x) => x.id === "victoria")!;
    expect([...v.personality.quirks, ...v.personality.tells]).toContain(r.body.response.action);
  });

  it("safeDeflection is keyed to stress: calm quirks vs rattled tells", () => {
    const g = createInitialGameState(c);
    const { ctx } = prepareTurn({ caseData: c, game: g, characterId: "victoria", question: "x" });
    const calm = safeDeflection(ctx, "unknown_name", 0);
    ctx.state.stress = 90;
    const rattled = safeDeflection(ctx, "unknown_name", 0);
    expect(calm.emotion).toBe("defensive");
    expect(rattled.emotion).toBe("nervous");
    expect(calm.dialogue).not.toBe(rattled.dialogue);
  });
});

describe("eval findings (live recording, 2026-10-08)", () => {
  it("a vocative title at a sentence end is not a name ('a peculiar little game, Inspector. I'm afraid...')", () => {
    expect(findUnknownName("Oh, what a peculiar little game, Inspector. I'm afraid my nerves are far too delicate.", "Victoria")).toBeNull();
    expect(findUnknownName("Do sit down, Mr. Grimsby.", "Victoria")).toBe("Mr. Grimsby");
  });
});
