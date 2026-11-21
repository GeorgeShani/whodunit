/**
 * When solution.json is not committed, the loader reads CASE_SOLUTION_<ID> (base64 JSON).
 * Missing or invalid: the case still loads; accusations fail closed in character.
 * The env value and the solution itself must never appear in a public view or a fail-closed response.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACCUSE_LINES, handleAccuse } from "@/engine/accuse-handler";
import { loadCase, loadPlayableCase, validateCase } from "@/engine/case-loader";
import { createInitialGameState } from "@/engine/game-state";
import { getPublicCaseView } from "@/engine/public-view";
import { caseSolutionEnvName, parseSolutionEnv } from "@/engine/solution";
import { encodeStateToken } from "@/engine/state-token";
import { FIXTURE_ID, FIXTURES_DIR, makeBrokenCopy } from "../helpers/fixture";
import { TEST_ENV } from "../helpers/grok-mock";

const ENV = caseSolutionEnvName(FIXTURE_ID);
const MARKER = "ENV_SOLUTION_MARKER_QX9";

function setEnv(value: string | undefined): void {
  if (value === undefined) delete process.env[ENV];
  else process.env[ENV] = value;
}

afterEach(() => {
  setEnv(undefined);
});

function fixtureSolutionWithMarker(): { json: string; b64: string } {
  const sol = JSON.parse(readFileSync(path.join(FIXTURES_DIR, FIXTURE_ID, "solution.json"), "utf8")) as Record<string, unknown>;
  sol.explanation = MARKER;
  const json = JSON.stringify(sol);
  return { json, b64: Buffer.from(json, "utf8").toString("base64") };
}

const ACCUSATION = { murdererId: "alpha", weaponId: "heavy-wrench", motiveId: "partnership-dispute", keyEvidenceIds: ["note"] };

async function accuseWith(caseData: Awaited<ReturnType<typeof loadPlayableCase>>) {
  const g = createInitialGameState(caseData);
  if (!g.discoveredEvidenceIds.includes("note")) g.discoveredEvidenceIds.push("note");
  if (!g.discoveredEvidenceIds.includes("heavy-wrench")) g.discoveredEvidenceIds.push("heavy-wrench");
  const stateToken = encodeStateToken(g, TEST_ENV);
  return handleAccuse({ accusation: ACCUSATION, stateToken }, { caseData, env: TEST_ENV });
}

function technicalLeak(text: string, rawEnv?: string): string[] {
  const hits: string[] = [];
  for (const s of [MARKER, rawEnv, "CASE_SOLUTION_", "base64", "Zod", "JSON.parse", "solution.json", "invalid JSON", "Unexpected token"]) {
    if (s && text.includes(s)) hits.push(s);
  }
  return hits;
}

describe("CASE_SOLUTION_<ID> env loader", () => {
  it("names the env var from the canonical case id, never NEXT_PUBLIC_", () => {
    expect(caseSolutionEnvName("tallyho")).toBe("CASE_SOLUTION_TALLYHO");
    expect(caseSolutionEnvName("fixture-manor")).toBe("CASE_SOLUTION_FIXTURE_MANOR");
    expect(ENV).toBe("CASE_SOLUTION_FIXTURE_MANOR");
    expect(ENV.startsWith("NEXT_PUBLIC_")).toBe(false);
  });

  it("loads a valid base64 solution from the env when the file is missing", async () => {
    const { b64 } = fixtureSolutionWithMarker();
    const { casesDir, cleanup } = await makeBrokenCopy(async (_edit, dir) => {
      await unlink(path.join(dir, "solution.json"));
    });
    try {
      setEnv(b64);
      const c = await loadCase(FIXTURE_ID, casesDir);
      expect(c.solution?.murdererId).toBe("alpha");
      expect(c.solution?.explanation).toBe(MARKER);
      expect((await validateCase(FIXTURE_ID, casesDir)).data).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it("fails closed in character when the env is missing: playable, no crash, no technical text", async () => {
    const { casesDir, cleanup } = await makeBrokenCopy(async (_edit, dir) => {
      await unlink(path.join(dir, "solution.json"));
    });
    try {
      setEnv(undefined);
      await expect(loadCase(FIXTURE_ID, casesDir)).rejects.toThrow(/file is missing/);
      const playable = await loadPlayableCase(FIXTURE_ID, casesDir);
      expect(playable.solution).toBeUndefined();
      expect(playable.id).toBe(FIXTURE_ID);
      const r = await accuseWith(playable);
      expect(r.status).toBe(503);
      expect(r.body.error).toBe("accusation_unavailable");
      expect(r.body.line).toBe(ACCUSE_LINES.solutionUnavailable);
      expect(r.body.solution).toBeUndefined();
      expect(r.body.outcome).toBeUndefined();
      const text = JSON.stringify(r.body);
      expect(technicalLeak(text)).toEqual([]);
      expect(text).not.toMatch(/internal|stack|TypeError|undefined is not/i);
    } finally {
      await cleanup();
    }
  });

  it("fails closed in character when the env is malformed, without leaking the value", async () => {
    const raw = `not-base64-and-${MARKER}-%%`;
    const { casesDir, cleanup } = await makeBrokenCopy(async (_edit, dir) => {
      await unlink(path.join(dir, "solution.json"));
    });
    try {
      setEnv(raw);
      expect(parseSolutionEnv(raw).ok).toBe(false);
      await expect(loadCase(FIXTURE_ID, casesDir)).rejects.toThrow(/environment solution is invalid/);
      const playable = await loadPlayableCase(FIXTURE_ID, casesDir);
      expect(playable.solution).toBeUndefined();
      const r = await accuseWith(playable);
      expect(r.status).toBe(503);
      expect(r.body.error).toBe("accusation_unavailable");
      expect(r.body.line).toBe(ACCUSE_LINES.solutionUnavailable);
      const text = JSON.stringify(r.body);
      expect(technicalLeak(text, raw)).toEqual([]);
      expect(JSON.stringify(getPublicCaseView(playable))).not.toContain(MARKER);
    } finally {
      await cleanup();
    }
  });

  it("never puts the env value or the solution explanation into the public view, even when the env is valid", async () => {
    const { b64 } = fixtureSolutionWithMarker();
    const { casesDir, cleanup } = await makeBrokenCopy(async (_edit, dir) => {
      await unlink(path.join(dir, "solution.json"));
    });
    try {
      setEnv(b64);
      const c = await loadCase(FIXTURE_ID, casesDir);
      const json = JSON.stringify(getPublicCaseView(c));
      expect(json).not.toContain(MARKER);
      expect(json).not.toContain(b64);
      expect(json).not.toContain("solution");
      expect(json).not.toContain("murdererId");
    } finally {
      await cleanup();
    }
  });

  it.skipIf(!existsSync("cases/blackwood/solution.json"))("Blackwood still loads from its local gitignored file when CASE_SOLUTION_BLACKWOOD is unset", async () => {
    const prev = process.env.CASE_SOLUTION_BLACKWOOD;
    delete process.env.CASE_SOLUTION_BLACKWOOD;
    try {
      const c = await loadCase("blackwood");
      const local = JSON.parse(readFileSync("cases/blackwood/solution.json", "utf8")) as { murdererId: string };
      expect(c.solution?.murdererId).toBe(local.murdererId);
      expect(c.solution).not.toHaveProperty("endings");
      expect(c.endings?.correct).toBeDefined();
    } finally {
      if (prev !== undefined) process.env.CASE_SOLUTION_BLACKWOOD = prev;
    }
  });

  it.skipIf(!existsSync("cases/blackwood/solution.json"))(
    "LoadedCase.solution has no endings key when the Blackwood payload comes from the env",
    async () => {
      const raw = readFileSync("cases/blackwood/solution.json");
      expect(raw.length).toBe(5643);
      expect(createHash("sha256").update(raw).digest("hex").startsWith("0f4eea49a923b598")).toBe(true);

      const tmp = await mkdtemp(path.join(tmpdir(), "bw-env-endings-"));
      const prev = process.env.CASE_SOLUTION_BLACKWOOD;
      try {
        await cp(path.resolve("cases/blackwood"), path.join(tmp, "blackwood"), { recursive: true });
        await unlink(path.join(tmp, "blackwood", "solution.json"));
        process.env.CASE_SOLUTION_BLACKWOOD = raw.toString("base64");
        const c = await loadCase("blackwood", tmp);
        expect(c.solution).not.toHaveProperty("endings");
        expect(c.endings?.correct).toBeDefined();
      } finally {
        if (prev === undefined) delete process.env.CASE_SOLUTION_BLACKWOOD;
        else process.env.CASE_SOLUTION_BLACKWOOD = prev;
        await rm(tmp, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!existsSync("cases/tallyho/solution.json"))(
    "LoadedCase.solution has no endings key when the Tallyho payload comes from the env",
    async () => {
      const raw = readFileSync("cases/tallyho/solution.json");
      expect(raw.length).toBe(6339);
      expect(createHash("sha256").update(raw).digest("hex").startsWith("ed7c60c0495104da")).toBe(true);

      const tmp = await mkdtemp(path.join(tmpdir(), "th-env-endings-"));
      const prev = process.env.CASE_SOLUTION_TALLYHO;
      try {
        await cp(path.resolve("cases/tallyho"), path.join(tmp, "tallyho"), { recursive: true });
        await unlink(path.join(tmp, "tallyho", "solution.json"));
        process.env.CASE_SOLUTION_TALLYHO = raw.toString("base64");
        const c = await loadCase("tallyho", tmp);
        expect(c.solution).not.toHaveProperty("endings");
        expect(c.endings?.correct).toBeDefined();
      } finally {
        if (prev === undefined) delete process.env.CASE_SOLUTION_TALLYHO;
        else process.env.CASE_SOLUTION_TALLYHO = prev;
        await rm(tmp, { recursive: true, force: true });
      }
    },
  );

  it("does not track Tallyho's or Blackwood's solution.json, and CASE_SOLUTION_ is never a NEXT_PUBLIC_ name in the repo", () => {
    const tracked = execSync("git ls-files cases/tallyho/solution.json cases/_tallyho/solution.json cases/blackwood/solution.json", { encoding: "utf8" }).trim();
    expect(tracked).toBe("");
    const needle = "NEXT_PUBLIC_" + "CASE_SOLUTION";
    const hits = execSync(`git grep -l ${needle} -- . ':!node_modules' ':!.git' ':!tests' || true`, {
      encoding: "utf8",
    }).trim();
    expect(hits).toBe("");
  });
});
