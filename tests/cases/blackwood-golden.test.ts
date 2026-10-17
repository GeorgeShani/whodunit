/**
 * Case-two plan phase 2 (section 7.1 rule 1): Blackwood golden snapshots, so phases 3 to 8 can prove Blackwood is
 * unchanged. Pinned at fixed states (fresh, mid-game, gate open):
 *  - PUBLIC outputs, readable (tests/cases/__golden__/blackwood-public.json): the public case view with progress, and
 *    a search of every location.
 *  - PRIVATE outputs, as sha256 digests only (blackwood-private.sha256.json), so no solution text is committed twice:
 *    each suspect's context and full system prompt (via prepareTurn), the grade and full /api/accuse response for a set
 *    of accusations (endings included: the win and every accused's loss), and the validator result.
 * State tokens (random IV and game id) are stripped. Regenerate after an INTENDED Blackwood change with
 * `UPDATE_GOLDEN=1 npx vitest run tests/cases/blackwood-golden.test.ts`; set GOLDEN_DUMP=<dir> to write the private
 * values in full to a local (uncommitted) folder for diffing.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareTurn } from "@/ai/perform-turn";
import { handleAccuse } from "@/engine/accuse-handler";
import { gradeAccusation } from "@/engine/accusation";
import { loadCase, validateCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { handleInvestigate } from "@/engine/investigate-handler";
import { publicProgress } from "@/engine/progress";
import { getPublicCaseView } from "@/engine/public-view";
import { encodeStateToken } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { memoryClosedGames } from "@/lib/closed-games";
import { TEST_ENV } from "../helpers/grok-mock";

const DIR = path.join(process.cwd(), "tests/cases/__golden__");
const PUBLIC_FILE = path.join(DIR, "blackwood-public.json");
const PRIVATE_FILE = path.join(DIR, "blackwood-private.sha256.json");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

/** Stable JSON: sorted keys, no state tokens. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (k, x) =>
    k === "stateToken"
      ? undefined
      : x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
        : x,
  );
const sha = (v: unknown) => createHash("sha256").update(stable(v)).digest("hex");

/** Fixed states, derived from the case data in file order. */
function states(): Record<string, GameState> {
  const core = coreGuiltSecretIds(c);
  const fresh = createInitialGameState(c);
  const mid = createInitialGameState(c);
  const searchable = c.evidence.filter((e) => e.locationId).slice(0, 2);
  for (const e of searchable) {
    if (!mid.discoveredEvidenceIds.includes(e.id)) mid.discoveredEvidenceIds.push(e.id);
    if (!mid.searchedLocationIds.includes(e.locationId!)) mid.searchedLocationIds.push(e.locationId!);
  }
  const firstSecret = c.characters.flatMap((ch) => ch.secrets.filter((s) => !core.has(s.id)).map((s) => [ch.id, s.id] as const))[0]!;
  mid.characters[firstSecret[0]].revealedSecretIds.push(firstSecret[1]);
  mid.revealedSecretIds.push(firstSecret[1]);
  for (const ch of c.characters) mid.characters[ch.id].interrogationCount = 2;
  const open = createInitialGameState(c);
  for (const e of c.evidence) if (!open.discoveredEvidenceIds.includes(e.id)) open.discoveredEvidenceIds.push(e.id);
  for (const l of c.locations) open.searchedLocationIds.push(l.id);
  for (const ch of c.characters) {
    open.characters[ch.id].interrogationCount = 5;
    for (const s of ch.secrets.filter((x) => !core.has(x.id))) {
      open.characters[ch.id].revealedSecretIds.push(s.id);
      open.revealedSecretIds.push(s.id);
    }
  }
  return { fresh, mid, open };
}

async function build(): Promise<{ pub: Record<string, unknown>; priv: Record<string, unknown> }> {
  const pub: Record<string, unknown> = {};
  const priv: Record<string, unknown> = {};
  const st = states();
  for (const [name, g] of Object.entries(st)) {
    pub[`view@${name}`] = { view: getPublicCaseView(c, { discoveredEvidenceIds: g.discoveredEvidenceIds }), progress: publicProgress(c, g) };
    if (name !== "open")
      for (const l of c.locations) {
        const r = handleInvestigate({ caseId: c.id, locationId: l.id, stateToken: encodeStateToken(g, TEST_ENV) }, { caseData: c, env: TEST_ENV });
        pub[`search:${l.id}@${name}`] = r;
      }
    for (const ch of c.characters) {
      const p = prepareTurn({ caseData: c, game: structuredClone(g), characterId: ch.id, question: "Tell me about tonight.", move: {} });
      priv[`context:${ch.id}@${name}`] = p.guard.ctx;
      priv[`prompt:${ch.id}@${name}`] = p.guard.promptText;
      priv[`plan:${ch.id}@${name}`] = p.plan;
    }
  }
  const sol = c.solution;
  const proof = {
    keyEvidenceIds: sol.keyEvidenceIds.slice(0, sol.minKeyEvidence ?? 1),
    ...((sol.minKeyTestimony ?? 0) > 0 ? { keyTestimonyIds: sol.keyTestimonyIds!.slice(0, sol.minKeyTestimony) } : {}),
  };
  const otherWeapon = c.evidence.find((e) => e.id !== sol.weaponId)!.id;
  const otherMotive = c.motives.find((m) => m.id !== sol.motiveId)!.id;
  const weakProof = c.evidence.find((e) => !sol.keyEvidenceIds.includes(e.id))!.id;
  const accusations: Record<string, Record<string, unknown>> = {
    right: { murdererId: sol.murdererId, weaponId: sol.weaponId, motiveId: sol.motiveId, ...proof },
  };
  for (const ch of c.characters.filter((x) => x.id !== sol.murdererId)) accusations[`accused:${ch.id}`] = { ...accusations.right, murdererId: ch.id };
  accusations.wrongWeapon = { ...accusations.right, weaponId: otherWeapon };
  accusations.wrongMotive = { ...accusations.right, motiveId: otherMotive };
  accusations.weakProof = { ...accusations.right, keyEvidenceIds: [weakProof] };
  for (const [name, a] of Object.entries(accusations)) {
    priv[`grade:${name}`] = gradeAccusation(sol, a as never);
    const r = await handleAccuse(
      { accusation: a, stateToken: encodeStateToken(st.open, TEST_ENV) },
      { caseData: c, env: TEST_ENV, closed: memoryClosedGames() },
    );
    priv[`accuse:${name}`] = r;
  }
  priv.validator = await validateCase("blackwood");
  return { pub, priv };
}

describe("Blackwood golden snapshots (case-two plan phase 2)", () => {
  it("is deterministic", async () => {
    const [a, b] = [await build(), await build()];
    expect(stable(a)).toBe(stable(b));
  });

  it("matches the committed snapshots", async () => {
    const { pub, priv } = await build();
    const digests = Object.fromEntries(Object.entries(priv).map(([k, v]) => [k, sha(v)]));
    if (process.env.GOLDEN_DUMP) {
      mkdirSync(process.env.GOLDEN_DUMP, { recursive: true });
      for (const [k, v] of Object.entries(priv))
        writeFileSync(path.join(process.env.GOLDEN_DUMP, `${k.replace(/[^\w@.-]+/g, "_")}.json`), JSON.stringify(v, null, 2));
    }
    if (UPDATE) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(PUBLIC_FILE, JSON.stringify(JSON.parse(stable(pub)), null, 1) + "\n");
      writeFileSync(PRIVATE_FILE, JSON.stringify(digests, null, 1) + "\n");
    }
    expect(JSON.parse(stable(pub))).toEqual(JSON.parse(readFileSync(PUBLIC_FILE, "utf8")));
    const pinned = JSON.parse(readFileSync(PRIVATE_FILE, "utf8")) as Record<string, string>;
    expect(Object.keys(digests).sort()).toEqual(Object.keys(pinned).sort());
    const changed = Object.keys(digests).filter((k) => digests[k] !== pinned[k]);
    expect(changed, "changed Blackwood outputs (run with GOLDEN_DUMP=<dir> to inspect)").toEqual([]);
  });
});
