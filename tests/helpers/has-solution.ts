/**
 * Local gitignored solution.json, or a valid CASE_SOLUTION_<ID> env value.
 * Env-backed cases (Blackwood, Tallyho) use this so tests can skip cleanly
 * when neither source is present.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CASES_DIR } from "@/engine/case-loader";
import { readSolutionFromEnv } from "@/engine/solution";

export function hasLocalOrEnvSolution(caseId: string, casesDir = DEFAULT_CASES_DIR): boolean {
  return existsSync(path.join(casesDir, caseId, "solution.json")) || readSolutionFromEnv(caseId).ok;
}
