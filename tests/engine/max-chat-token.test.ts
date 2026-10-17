/**
 * Case-two plan phase 2: the max-chat token fixture (plan F5, R1, V24/V25). A synthetic Blackwood state at every
 * per-character maximum the token keeps (STATE_LIMITS: 12 memory entries and 8 statements at the 400-char clip, actions
 * at the clip, the full claim list at CLAIM_LIMITS.chars), every clue, search and non-core secret, every pair's
 * confrontation exchanges spent, a stored accusation. It measures the encoded state token and the longest
 * interrogation prompt (system + user) at that state, and pins them in tests/fixtures/token/max-chat.json.
 *
 * Fails when the token or the longest prompt grows more than GROWTH over the pinned numbers. The plan's cap
 * (STATE_LIMITS.tokenChars, 60K: over it the game resets) is a known gap today, pinned with it.fails until phase 4. After an intended change, re-pin with
 * `UPDATE_MAX_CHAT=1 npx vitest run tests/engine/max-chat-token.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { CLAIM_LIMITS, MAX_CONFRONTATION_TURNS } from "@/engine/constants";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { encodeStateToken, STATE_LIMITS } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { TEST_ENV } from "../helpers/grok-mock";

const FILE = path.join(process.cwd(), "tests/fixtures/token/max-chat.json");
const GROWTH = 0.05;

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

/** Deterministic filler prose of exactly n characters. */
const text = (n: number, seed: number) => {
  const words = "the candle guttered while the storm rattled every window and somebody in the hall said nothing at all".split(" ");
  let s = "";
  for (let i = seed; s.length < n; i++) s += (s ? " " : "") + words[i % words.length];
  return s.slice(0, n);
};

function maxChatState(): GameState {
  const core = coreGuiltSecretIds(c);
  const g = createInitialGameState(c);
  g.turn = 999;
  for (const e of c.evidence) if (!g.discoveredEvidenceIds.includes(e.id)) g.discoveredEvidenceIds.push(e.id);
  for (const l of c.locations) g.searchedLocationIds.push(l.id);
  const ids = c.characters.map((ch) => ch.id);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const pair = [ids[i], ids[j]].sort().join("|");
      g.pairTurns[pair] = MAX_CONFRONTATION_TURNS;
      g.confrontedPairs.push(pair);
    }
  let turn = 0;
  for (const ch of c.characters) {
    const rt = g.characters[ch.id];
    rt.interrogationCount = 99;
    rt.stress = 100;
    rt.evidenceShownIds = [...g.discoveredEvidenceIds];
    for (const s of ch.secrets.filter((x) => !core.has(x.id))) {
      rt.revealedSecretIds.push(s.id);
      g.revealedSecretIds.push(s.id);
    }
    rt.liesToldIds = ch.intendedLies.map((l) => l.id);
    rt.memory = Array.from({ length: STATE_LIMITS.memoryPerCharacter }, (_, k) => ({
      turn: ++turn,
      speaker: k % 2 ? ("character" as const) : ("player" as const),
      text: text(STATE_LIMITS.textChars, k),
      ...(k % 2 ? { action: text(200, k + 3) } : {}),
    }));
    rt.playerClaims = Array.from({ length: CLAIM_LIMITS.perCharacter }, (_, k) => ({ text: text(CLAIM_LIMITS.chars, k + 7), turn: turn + k }));
    for (let k = 0; k < STATE_LIMITS.statementsPerCharacter; k++) {
      const id = `st-${ch.id}-${k}`;
      g.statements.push({
        id,
        characterId: ch.id,
        text: text(STATE_LIMITS.textChars, k + 11),
        turn: ++turn,
        mode: "interrogation",
        relatedFactIds: [],
        contradictedByEvidenceIds: [],
      });
      rt.statementIds.push(id);
    }
  }
  for (const id of g.revealedSecretIds)
    for (const ch of c.characters) if (!g.characters[ch.id].testimonyShownIds.includes(id)) g.characters[ch.id].testimonyShownIds.push(id);
  g.gameId = "maxchatfixture01";
  return g;
}

function measure() {
  const g = maxChatState();
  const token = encodeStateToken(g, TEST_ENV);
  const prompts = c.characters.map((ch) => {
    const p = prepareTurn({ caseData: c, game: structuredClone(g), characterId: ch.id, question: text(300, 1), move: {} });
    return { id: ch.id, chars: p.system.length + p.user.length };
  });
  const longest = prompts.reduce((a, b) => (b.chars > a.chars ? b : a));
  return {
    suspects: c.characters.length,
    tokenChars: token.length,
    tokenCharsPerSuspect: Math.round(token.length / c.characters.length),
    projectedTokenCharsAt6: Math.round((token.length / c.characters.length) * 6),
    tokenCap: STATE_LIMITS.tokenChars,
    longestPromptChars: longest.chars,
    longestPromptEstTokens: Math.round(longest.chars / 4),
    promptCharsBySuspect: Object.fromEntries(prompts.map((p) => [p.id, p.chars])),
  };
}

describe("max-chat token fixture (case-two plan phase 2)", () => {
  it("does not grow past the pinned sizes", () => {
    const m = measure();
    if (process.env.UPDATE_MAX_CHAT === "1") writeFileSync(FILE, JSON.stringify(m, null, 2) + "\n");
    const pinned = JSON.parse(readFileSync(FILE, "utf8")) as ReturnType<typeof measure>;
    expect(m.tokenChars, `token grew more than ${GROWTH * 100}% (pinned ${pinned.tokenChars})`).toBeLessThanOrEqual(
      Math.floor(pinned.tokenChars * (1 + GROWTH)),
    );
    expect(m.longestPromptChars, `longest prompt grew more than ${GROWTH * 100}% (pinned ${pinned.longestPromptChars})`).toBeLessThanOrEqual(
      Math.floor(pinned.longestPromptChars * (1 + GROWTH)),
    );
  });

  // KNOWN GAP (plan R1, F5): the synthetic worst case is already over the 60K cap with Blackwood's 4 suspects, so a
  // real game at every maximum would reset. Phase 4 (token v2: deflate + budget trimming) must make this pass; when it
  // does, `it.fails` turns red: change it to `it` and keep it.
  it.fails("is under the token cap (STATE_LIMITS.tokenChars): phase 4 makes this pass", () => {
    expect(measure().tokenChars).toBeLessThanOrEqual(STATE_LIMITS.tokenChars);
  });
});
