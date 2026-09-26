import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { decodeStateToken, encodeStateToken, stateKeySource } from "@/engine/state-token";
import { FIXTURE_ID, FIXTURES_DIR } from "../helpers/fixture";

let c: LoadedCase;
let fixture: LoadedCase;
const ENV = { GAME_STATE_SECRET: "a-very-secret-state-key-123" };

beforeAll(async () => {
  c = await loadCase("blackwood");
  fixture = await loadCase(FIXTURE_ID, FIXTURES_DIR);
});

function played() {
  const g = createInitialGameState(c);
  g.turn = 2;
  const r = g.characters.reginald;
  r.stress = 42;
  r.trust = 61;
  r.evidenceShownIds = ["silver-candlestick"];
  r.revealedSecretIds = ["s-reginald-theft"];
  r.memory = [{ turn: 1, speaker: "player", text: "Hello" }, { turn: 1, speaker: "character", text: "Sir." }];
  g.statements.push({ id: "x", characterId: "reginald", text: "Sir.", turn: 1, mode: "interrogation", relatedFactIds: [], contradictedByEvidenceIds: [] });
  return g;
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("state token", () => {
  it("round-trips the runtime state", () => {
    const r = decodeStateToken(encodeStateToken(played(), ENV), c, ENV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.game.turn).toBe(2);
    expect(r.game.characters.reginald).toMatchObject({ stress: 42, trust: 61, evidenceShownIds: ["silver-candlestick"], revealedSecretIds: ["s-reginald-theft"] });
    expect(r.game.statements.map((s) => s.text)).toEqual(["Sir."]);
  });

  it("missing token -> missing", () => {
    expect(decodeStateToken(undefined, c, ENV)).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a tampered payload (e.g. stress edited to 0 / secrets added)", () => {
    const [v, body, sig] = encodeStateToken(played(), ENV).split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.characters.reginald.stress = 0;
    payload.discoveredEvidenceIds.push("burned-letter");
    expect(decodeStateToken(`${v}.${b64(payload)}.${sig}`, c, ENV)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a token signed with another key", () => {
    const t = encodeStateToken(played(), { GAME_STATE_SECRET: "some-other-secret-key-0000" });
    expect(decodeStateToken(t, c, ENV)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it.each(["garbage", "v1.abc", "v2.a.b", "v1..", ""])("rejects malformed token %j", (t) => {
    const r = decodeStateToken(t, c, ENV);
    expect(r.ok).toBe(false);
  });

  it("rejects a valid token from another case", () => {
    const t = encodeStateToken(createInitialGameState(fixture), ENV);
    expect(decodeStateToken(t, c, ENV)).toMatchObject({ ok: false });
  });

  it("key source: GAME_STATE_SECRET > derived from XAI_API_KEY > dev fallback", () => {
    expect(stateKeySource(ENV)).toBe("GAME_STATE_SECRET");
    expect(stateKeySource({ XAI_API_KEY: "xai-abc" })).toBe("derived_from_xai_key");
    expect(stateKeySource({ GAME_STATE_SECRET: "short", XAI_API_KEY: "xai-abc" })).toBe("derived_from_xai_key");
    expect(stateKeySource({})).toBe("dev_fallback");
  });

  it("the derived key signs differently from the dev key and never appears in the token", () => {
    const xenv = { XAI_API_KEY: "xai-super-secret-test-key" };
    const t = encodeStateToken(played(), xenv);
    expect(decodeStateToken(t, c, xenv).ok).toBe(true);
    expect(decodeStateToken(t, c, {})).toEqual({ ok: false, reason: "bad_signature" });
    const decoded = Buffer.from(t.split(".")[1], "base64url").toString() + t;
    expect(decoded).not.toContain("xai-super-secret-test-key");
  });
});
