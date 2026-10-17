/**
 * Case-two plan phase 4 (7.2): token v2 = the same payload, deflated before signing. v1 tokens from games already in
 * progress still decode and come back as v2 on the next save; anything else fails as before (reset in character).
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { RESET_NOTICE, restoreSession, saveSession } from "@/engine/session";
import { decodeStateToken, encodeStateToken, signPayloadForTests, STATE_LIMITS, unverifiedPayload } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { FIXTURE_ID, FIXTURES_DIR } from "../helpers/fixture";

const ENV = { GAME_STATE_SECRET: "a-very-secret-state-key-123" };
let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase(FIXTURE_ID, FIXTURES_DIR);
});
const sign = (data: string) => createHmac("sha256", createHash("sha256").update(ENV.GAME_STATE_SECRET).digest()).update(data).digest("base64url");
const played = (): GameState => {
  const g = createInitialGameState(c);
  g.turn = 3;
  const id = c.characters[0].id;
  g.characters[id].stress = 42;
  g.characters[id].memory.push(
    { turn: 1, speaker: "player", text: "Where were you?" },
    { turn: 2, speaker: "character", text: "In the library, all evening." },
  );
  return g;
};

describe("token v2", () => {
  it("new tokens are v2, a deflated body, and round-trip", () => {
    const t = encodeStateToken(played(), ENV);
    expect(t.startsWith("v2.")).toBe(true);
    expect(() => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"))).toThrow(); // not plain JSON
    const r = decodeStateToken(t, c, ENV);
    expect(r.ok && r.game.characters[c.characters[0].id].stress).toBe(42);
  });

  it("a v1 token from a game in progress still decodes, and the next save re-issues it as v2", () => {
    const v1 = signPayloadForTests(unverifiedPayload(encodeStateToken(played(), ENV)), ENV, "v1");
    expect(v1.startsWith("v1.")).toBe(true);
    expect(JSON.parse(Buffer.from(v1.split(".")[1], "base64url").toString("utf8")).turn).toBe(3); // plain JSON, as v1 was
    const s = restoreSession(c, v1, ENV);
    expect(s.notice).toBeUndefined();
    expect(s.game.turn).toBe(3);
    expect(s.game.characters[c.characters[0].id].memory).toHaveLength(2);
    expect(saveSession(s.game, ENV).startsWith("v2.")).toBe(true);
  });

  it("the signature covers the version: a v2 body relabelled v1 (or the reverse) fails", () => {
    const [, body, sig] = encodeStateToken(played(), ENV).split(".");
    expect(decodeStateToken(`v1.${body}.${sig}`, c, ENV)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a validly signed body that doesn't inflate, or inflates past the limit, is rejected and resets in character", () => {
    const junk = Buffer.from("not deflate at all").toString("base64url");
    expect(decodeStateToken(`v2.${junk}.${sign(`v2.${junk}`)}`, c, ENV)).toEqual({ ok: false, reason: "invalid_payload" });
    const bomb = deflateRawSync(Buffer.alloc(2_000_000, 32)).toString("base64url"); // ~2 MB of spaces in a few KB
    expect(bomb.length).toBeLessThan(STATE_LIMITS.tokenChars);
    expect(decodeStateToken(`v2.${bomb}.${sign(`v2.${bomb}`)}`, c, ENV)).toEqual({ ok: false, reason: "invalid_payload" });
    expect(restoreSession(c, `v2.${bomb}.${sign(`v2.${bomb}`)}`, ENV).notice).toBe(RESET_NOTICE);
  });

  it("unknown versions stay malformed", () => {
    const [, body, sig] = encodeStateToken(played(), ENV).split(".");
    expect(decodeStateToken(`v3.${body}.${sig}`, c, ENV)).toEqual({ ok: false, reason: "malformed" });
  });

  it("safety net: a state that would pass the cap drops its oldest chat memory instead of resetting", () => {
    // 16 suspects with incompressible text in every memory slot: far over the cap before the safety net.
    const extra = Array.from({ length: 16 - c.characters.length }, (_, i) => {
      const ch = c.characters[i % c.characters.length];
      return JSON.parse(JSON.stringify(ch).replaceAll(ch.id, `${ch.id}x${i}`)) as LoadedCase["characters"][number];
    });
    const big = { ...c, characters: [...c.characters, ...extra] } as LoadedCase;
    const g = createInitialGameState(big);
    const noise = () => randomBytes(300).toString("base64");
    for (const ch of big.characters)
      g.characters[ch.id].memory = Array.from({ length: STATE_LIMITS.memoryPerCharacter }, (_, k) => ({
        turn: k + 1,
        speaker: "player" as const,
        text: noise(),
      }));
    g.turn = 12;
    const t = encodeStateToken(g, ENV);
    expect(t.length).toBeLessThanOrEqual(STATE_LIMITS.tokenChars);
    const r = decodeStateToken(t, big, ENV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const kept = Object.values(r.game.characters).map((ch) => ch.memory.length);
    expect(Math.min(...kept)).toBeLessThan(STATE_LIMITS.memoryPerCharacter); // trimmed...
    expect(Object.values(r.game.characters).every((ch) => ch.memory.at(-1)?.turn === 12)).toBe(true); // ...oldest first
    expect(r.game.turn).toBe(12);
  });
});
