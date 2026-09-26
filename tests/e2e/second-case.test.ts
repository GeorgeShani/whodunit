/**
 * End to end on a SECOND case (tests/fixtures/cases/harbor-light), proving the
 * engine and routes are case-agnostic: load, validate, investigate, interrogate
 * (mocked model), present evidence, engine reveal, broken lie, and case
 * isolation of the signed token.
 */
import { createHash, createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { buildCharacterContext } from "@/engine/context-builder";
import { loadCase, validateCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleInvestigate } from "@/engine/investigate-handler";
import { getPublicCaseView } from "@/engine/public-view";
import { RESET_NOTICE } from "@/engine/session";
import { decodeStateToken, encodeStateToken, peekStateTokenCaseId } from "@/engine/state-token";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";
import { FIXTURES_DIR } from "../helpers/fixture";

let hl: LoadedCase;
let other: LoadedCase;
beforeAll(async () => {
  hl = await loadCase("harbor-light", FIXTURES_DIR);
  other = await loadCase("fixture-manor", FIXTURES_DIR);
});

const investigate = (c: LoadedCase, locationId: string, stateToken?: string) =>
  handleInvestigate({ caseId: c.id, locationId, ...(stateToken ? { stateToken } : {}) }, { caseData: c, env: TEST_ENV });
const interrogate = (c: LoadedCase, body: Record<string, unknown>) =>
  handleInterrogate({ caseId: c.id, ...body }, { caseData: c, env: TEST_ENV });
const stateOf = (c: LoadedCase, t?: string) => {
  const r = decodeStateToken(t, c, TEST_ENV);
  if (!r.ok) throw new Error(r.reason);
  return r.game;
};

describe("second case: harbor-light", () => {
  it("loads and validates, with endings, art fields and at least one clue per mechanic", async () => {
    const v = await validateCase("harbor-light", FIXTURES_DIR);
    expect(v.issues).toEqual([]);
    expect(hl.endings?.wrong).toHaveProperty("finch");
    expect(hl.locations.find((l) => l.id === "lamp-room")?.background).toBe("/assets/backgrounds/manor.webp");
    expect(hl.backdrops?.suspects).toBe("/assets/backgrounds/library.webp");
    expect(hl.evidence.some((e) => e.initiallyAvailable)).toBe(true); // starts in the notebook
    expect(hl.evidence.some((e) => !e.initiallyAvailable && e.locationId)).toBe(true); // found by searching
    const chars = hl.characters;
    expect(chars.some((c) => c.intendedLies.some((l) => l.brokenByEvidenceIds.length))).toBe(true); // lie-breaking clue
    expect(chars.some((c) => c.secrets.some((s) => s.revealConditions?.evidenceIds?.length))).toBe(true); // reveal clue
    const view = getPublicCaseView(hl);
    expect(view.backdrops).toEqual({ suspects: "/assets/backgrounds/library.webp" });
    expect(JSON.stringify(view)).not.toContain("HL_SOLUTION_EXPLANATION");
    expect(JSON.stringify(view)).not.toContain("HL_ENDING");
  });

  it("investigate → present → engine reveal (the cook's rum secret)", async () => {
    const found = investigate(hl, "galley");
    expect(found.status).toBe(200);
    expect(found.body.found.map((f) => f.id)).toEqual(["wet-logbook"]);
    expect(found.body.lines).toContain("HL_SEARCH_galley");
    expect(peekStateTokenCaseId(found.body.stateToken, TEST_ENV)).toBe("harbor-light");

    let system = "";
    mockGrok({ content: goodReply({ dialogue: "Alright, alright! I keep the captain's rum.", emotion: "nervous" }) });
    const r = await handleInterrogate(
      { caseId: hl.id, characterId: "cook-marlow", question: "What's this logbook say about rum?", presentedEvidenceId: "wet-logbook", stateToken: found.body.stateToken },
      { caseData: hl, env: TEST_ENV, onPrompt: (p) => (system = p.system) },
    );
    expect(r.body.source).toBe("model");
    expect(system).toContain("CONFESS this secret, in your own words and in character: HL_MARLOW_SECRET");
    expect(system).toContain('EXPOSED (the rum): "HL_MARLOW_LIE');
    const g = stateOf(hl, r.body.stateToken);
    expect(g.characters["cook-marlow"].revealedSecretIds).toEqual(["marlow-secret"]);
    expect(g.characters["cook-marlow"].stress).toBeGreaterThan(0);
    expect(g.searchedLocationIds).toEqual(["galley"]);
  });

  it("the murderer's story holds until the weapon is found, then the lie breaks and the secret is revealed", async () => {
    // Before: the truth is gated; the prompt only has the story.
    const locked = buildCharacterContext({ caseData: hl, game: createInitialGameState(hl) }, "keeper-quill");
    expect(JSON.stringify(locked)).not.toContain("HL_GUILTY");
    expect(JSON.stringify(locked)).not.toContain("HL_QUILL_SECRET");
    expect(locked.intendedLies[0].status).toBe("maintain");

    const early = await interrogate(hl, { characterId: "keeper-quill", question: "Explain the spyglass.", presentedEvidenceId: "brass-spyglass" });
    expect(early.body.error).toBe("evidence_not_discovered");

    const dock = investigate(hl, "dock");
    expect(dock.body.found.map((f) => f.id)).toEqual(["brass-spyglass"]);
    mockGrok({ content: goodReply({ dialogue: "Fine! I took it down to the dock to throw it in.", emotion: "panicked" }) });
    const r = await interrogate(hl, { characterId: "keeper-quill", question: "Explain the spyglass.", presentedEvidenceId: "brass-spyglass", stateToken: dock.body.stateToken });
    const g = stateOf(hl, r.body.stateToken);
    expect(g.characters["keeper-quill"].revealedSecretIds).toEqual(["quill-secret"]);
    const after = buildCharacterContext({ caseData: hl, game: g }, "keeper-quill");
    expect(after.intendedLies[0].status).toBe("exposed");
    expect(after.secrets.map((s) => s.id)).toEqual(["quill-secret"]);
  });

  it("a token from one case never carries into another: it resets in character", async () => {
    const hlToken = investigate(hl, "galley").body.stateToken!;
    const cross = investigate(other, "hall", hlToken);
    expect(cross.body.notice).toBe(RESET_NOTICE);
    expect(stateOf(other, cross.body.stateToken).discoveredEvidenceIds).not.toContain("wet-logbook");

    mockGrok({});
    const r = await interrogate(other, { characterId: "bravo", question: "Hello?", stateToken: hlToken });
    expect(r.body.notice).toBe(RESET_NOTICE);
  });

  it("a request naming a different case than the one resolved is refused", async () => {
    const r = handleInvestigate({ caseId: "fixture-manor", locationId: "galley" }, { caseData: hl, env: TEST_ENV });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("unknown_case");
    const q = await handleInterrogate({ caseId: "fixture-manor", characterId: "finch", question: "Hi" }, { caseData: hl, env: TEST_ENV });
    expect(q.status).toBe(404);
    expect(q.body.error).toBe("unknown_case");
  });

  it("legacy tokens without caseId map to the legacy (default) case only", () => {
    // Re-sign a payload with caseId removed, as tokens looked before multi-case.
    const token = encodeStateToken(createInitialGameState(hl), TEST_ENV);
    const [v, body] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    delete payload.caseId;
    const newBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const key = createHash("sha256").update(TEST_ENV.GAME_STATE_SECRET).digest();
    const sig = createHmac("sha256", key).update(`${v}.${newBody}`).digest("base64url");
    const legacy = `${v}.${newBody}.${sig}`;

    expect(peekStateTokenCaseId(legacy, TEST_ENV)).toBeUndefined();
    expect(peekStateTokenCaseId(legacy, TEST_ENV, { legacyCaseId: "harbor-light" })).toBe("harbor-light");
    expect(decodeStateToken(legacy, hl, TEST_ENV, { legacyCaseId: "harbor-light" }).ok).toBe(true);
    expect(decodeStateToken(legacy, hl, TEST_ENV, { legacyCaseId: "fixture-manor" })).toEqual({ ok: false, reason: "wrong_case" });
    const viaHandler = handleInvestigate({ locationId: "dock", stateToken: legacy }, { caseData: hl, env: TEST_ENV, legacyCaseId: "harbor-light" });
    expect(viaHandler.body.notice).toBeUndefined();
  });
});
