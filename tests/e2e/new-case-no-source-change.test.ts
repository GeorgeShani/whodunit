/**
 * Case-two plan phase 2: "adding a new case changes no source file". A brand-new case is dropped into a fresh cases/
 * folder (a copy of the harbor-light fixture under a new id, in a temp dir), with NO edit to engine/, ai/, lib/, app/
 * or components/. It must be discovered by the registry, load, validate, render its public view and art, and play
 * through the real route handlers: search, interrogate (mocked model, no network), and accuse. Runs in `npm test`.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { handleAccuse } from "@/engine/accuse-handler";
import { validateCase } from "@/engine/case-loader";
import { getPublicCase, isPublicCaseId, listPublicCaseIds } from "@/engine/case-registry";
import type { LoadedCase } from "@/engine/case-schema";
import { handleInvestigate } from "@/engine/investigate-handler";
import { getPublicCaseView } from "@/engine/public-view";
import { decodeStateToken, encodeStateToken, peekStateTokenCaseId } from "@/engine/state-token";
import { resolveCaseArt } from "@/lib/case-art";
import { memoryClosedGames } from "@/lib/closed-games";
import { FIXTURES_DIR } from "../helpers/fixture";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

const NEW_ID = "zz-new-case";
let dir: string;
let c: LoadedCase;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "new-case-"));
  cpSync(path.join(FIXTURES_DIR, "harbor-light"), path.join(dir, NEW_ID), { recursive: true });
  const file = path.join(dir, NEW_ID, "case.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), id: NEW_ID }, null, 2));
  c = await getPublicCase(NEW_ID, dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const stateOf = (t: string) => {
  const r = decodeStateToken(t, c, TEST_ENV);
  if (!r.ok) throw new Error(r.reason);
  return r.game;
};

describe("a new case needs no source change", () => {
  it("is discovered, loads and validates from data alone", async () => {
    expect(listPublicCaseIds(dir)).toEqual([NEW_ID]);
    expect(isPublicCaseId(NEW_ID, dir)).toBe(true);
    expect(c.id).toBe(NEW_ID);
    expect((await validateCase(NEW_ID, dir)).issues).toEqual([]);
  });

  it("renders its public view and art", () => {
    const view = resolveCaseArt(getPublicCaseView(c));
    expect(view.meta.id).toBe(NEW_ID);
    expect(view.suspects.length).toBe(c.characters.length);
  });

  it("plays through the real handlers: search, interrogate (mocked), accuse", async () => {
    const loc = c.evidence.find((e) => e.locationId)!.locationId!;
    const found = handleInvestigate({ caseId: NEW_ID, locationId: loc }, { caseData: c, env: TEST_ENV });
    expect(found.status).toBe(200);
    expect(peekStateTokenCaseId(found.body.stateToken, TEST_ENV)).toBe(NEW_ID);

    mockGrok({ content: goodReply({ dialogue: "I was below decks all night, I swear it.", emotion: "nervous" }) });
    const who = c.characters[0].id;
    const r = await handleInterrogate(
      { caseId: NEW_ID, characterId: who, question: "Where were you tonight?", stateToken: found.body.stateToken },
      { caseData: c, env: TEST_ENV },
    );
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("model");

    const sol = c.solution;
    // Accuse from that game once every clue is in the notebook (the fixture's gate).
    const g = stateOf(r.body.stateToken!);
    for (const e of c.evidence) if (!g.discoveredEvidenceIds.includes(e.id)) g.discoveredEvidenceIds.push(e.id);
    const accusation = {
      murdererId: sol.murdererId,
      weaponId: sol.weaponId,
      motiveId: sol.motiveId,
      keyEvidenceIds: sol.keyEvidenceIds.slice(0, sol.minKeyEvidence ?? 1),
    };
    const a = await handleAccuse({ accusation, stateToken: encodeStateToken(g, TEST_ENV) }, { caseData: c, env: TEST_ENV, closed: memoryClosedGames() });
    expect(a.status, JSON.stringify(a.body).slice(0, 200)).toBe(200);
    expect(a.body.outcome).toBe("won");
  });
});
