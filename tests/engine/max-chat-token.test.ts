/**
 * Case-two plan phase 2: the max-chat token fixture (plan F5, R1, V24/V25). A synthetic Blackwood state at every
 * per-character maximum the token keeps (STATE_LIMITS: 12 memory entries and 8 statements at the 400-char clip, actions
 * at the clip, the full claim list at CLAIM_LIMITS.chars), every clue, search and non-core secret, every pair's
 * confrontation exchanges spent, a stored accusation. It measures the encoded state token and the longest
 * interrogation prompt (system + user) at that state, and pins them in tests/fixtures/token/max-chat.json.
 *
 * Fails when the token or the longest prompt grows more than GROWTH over the pinned numbers, or the token passes the cap
 * (STATE_LIMITS.tokenChars, 60K). Phase 4 (token v2, deflate) added the 6-suspect state and closed the cap gap; v1TokenChars
 * records the same state in the old v1 format for comparison. After an intended change, re-pin with
 * `UPDATE_MAX_CHAT=1 npx vitest run tests/engine/max-chat-token.test.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { CLAIM_LIMITS, MAX_CONFRONTATION_TURNS } from "@/engine/constants";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { decodeStateToken, encodeStateToken, signPayloadForTests, STATE_LIMITS, unverifiedPayload } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { TEST_ENV } from "../helpers/grok-mock";

const FILE = path.join(process.cwd(), "tests/fixtures/token/max-chat.json");
const GROWTH = 0.05;

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
  // Words in their real frequencies across the case's prose (about 1,400 distinct): deflate gets ~2.75x on this, less than
  // on the authored prose itself (~4x), so the fixture is the pessimistic side of real dialogue. Only sizes are committed.
  vocab = JSON.stringify([c.intro, c.locations, c.characters.map((ch) => [ch.bio, ch.personality, ch.voice]), c.facts.map((f) => f.statement), c.timeline.map((t) => t.statement)])
    .replace(/[^A-Za-z' ,.]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
});

/**
 * Deterministic filler prose of exactly n characters. Phase 4: words drawn by a seeded PRNG from the case's prose, so it
 * compresses like real dialogue or worse (the phase-2 repeating sentence flattered deflate).
 */
let vocab: string[] = [];
/** Every call draws fresh words (reset per state, so a state is deterministic); `seed` only varies the start. */
let draws = 0;
const text = (n: number, seed: number) => {
  let x = ((seed + 1 + ++draws * 7919) * 2654435761) >>> 0 || 1;
  let s = "";
  while (s.length < n) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    s += (s ? " " : "") + vocab[x % vocab.length];
  }
  return s.slice(0, n);
};

/** The case with `extra` more suspects: copies of the first ones with every id of theirs renamed (a 6-suspect stand-in). */
function withSuspects(base: LoadedCase, total: number): LoadedCase {
  const extra = base.characters.slice(0, total - base.characters.length).map((ch, i) => {
    const id = `${ch.id}x${i + 2}`;
    return JSON.parse(JSON.stringify(ch).replaceAll(ch.id, id)) as LoadedCase["characters"][number];
  });
  return { ...base, characters: [...base.characters, ...extra] };
}

function maxChatState(c: LoadedCase): GameState {
  draws = 0;
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

function measure(c: LoadedCase) {
  const g = maxChatState(c);
  const token = encodeStateToken(g, TEST_ENV);
  const v1 = signPayloadForTests(unverifiedPayload(token), TEST_ENV, "v1");
  const prompts = c.characters.map((ch) => {
    const p = prepareTurn({ caseData: c, game: structuredClone(g), characterId: ch.id, question: "Tell me again exactly where you were when the lights went out tonight.", move: {} });
    return { id: ch.id, chars: p.system.length + p.user.length };
  });
  const longest = prompts.reduce((a, b) => (b.chars > a.chars ? b : a));
  return {
    suspects: c.characters.length,
    tokenChars: token.length,
    v1TokenChars: v1.length,
    tokenCharsPerSuspect: Math.round(token.length / c.characters.length),
    projectedTokenCharsAt6: Math.round((token.length / c.characters.length) * 6),
    tokenCap: STATE_LIMITS.tokenChars,
    longestPromptChars: longest.chars,
    longestPromptEstTokens: Math.round(longest.chars / 4),
    promptCharsBySuspect: Object.fromEntries(prompts.map((p) => [p.id, p.chars])),
  };
}

type Measure = ReturnType<typeof measure>;
const pinnedAll = () => JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Measure>;

describe.each([4, 6])("max-chat token fixture, %i suspects (case-two plan phases 2 and 4)", (n) => {
  const cs = () => (n === c.characters.length ? c : withSuspects(c, n));
  const key = `suspects${n}`;

  it("does not grow past the pinned sizes", () => {
    const m = measure(cs());
    if (process.env.UPDATE_MAX_CHAT === "1") writeFileSync(FILE, JSON.stringify({ ...(existsSync(FILE) ? pinnedAll() : {}), [key]: m }, null, 2) + "\n");
    const pinned = pinnedAll()[key];
    expect(pinned, `no pinned numbers for ${key}: run with UPDATE_MAX_CHAT=1`).toBeDefined();
    expect(m.tokenChars, `token grew more than ${GROWTH * 100}% (pinned ${pinned.tokenChars})`).toBeLessThanOrEqual(Math.floor(pinned.tokenChars * (1 + GROWTH)));
    expect(m.longestPromptChars, `longest prompt grew more than ${GROWTH * 100}% (pinned ${pinned.longestPromptChars})`).toBeLessThanOrEqual(
      Math.floor(pinned.longestPromptChars * (1 + GROWTH)),
    );
  });

  // Phase 4 closed the known gap (plan R1, F5): the worst case fits under the cap (STATE_LIMITS.tokenChars) with 6 suspects.
  it("is under the token cap and decodes back to the same game", () => {
    const k = cs();
    const m = measure(k);
    expect(m.tokenChars).toBeLessThanOrEqual(STATE_LIMITS.tokenChars);
    const token = encodeStateToken(maxChatState(k), TEST_ENV);
    const back = decodeStateToken(token, k, TEST_ENV);
    expect(back.ok).toBe(true);
    if (back.ok) expect(encodeStateToken(back.game, TEST_ENV).length).toBeLessThanOrEqual(Math.ceil(token.length * 1.01));
  });
});
