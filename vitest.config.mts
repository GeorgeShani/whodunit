import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));

/** Files that skip Blackwood themselves so fixture / Tallyho tests still run. */
const MANUAL_SOLUTION_SKIP = new Set([
  "tests/engine/solution-env.test.ts",
  "tests/engine/progression-validation.test.ts",
  "tests/engine/output-guard.test.ts",
  "tests/ai/accomplice-guard.test.ts",
  "tests/tooling/smoke-run.test.ts",
  "tests/lib/case-art.test.ts",
  "tests/cases/case-loader.test.ts",
  "tests/cases/presentation.test.ts",
  "tests/lib/case-unlock.test.ts",
  "tests/engine/case-agnostic.test.ts",
]);

function envName(caseId: string): string {
  return `CASE_SOLUTION_${caseId.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase()}`;
}

function hasLocalOrEnvSolution(caseId: string): boolean {
  if (existsSync(path.join(root, "cases", caseId, "solution.json"))) return true;
  const raw = process.env[envName(caseId)];
  return !!raw && raw.trim() !== "";
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function missingSolutionExcludes(): string[] {
  const missing: string[] = [];
  if (!hasLocalOrEnvSolution("blackwood")) missing.push("blackwood");
  if (!hasLocalOrEnvSolution("tallyho")) missing.push("tallyho");
  if (!missing.length) return [];
  const re = new RegExp(`load(?:Playable)?Case\\(\\s*["'](?:${missing.join("|")})["']`);
  const excludes: string[] = [];
  const testsDir = path.join(root, "tests");
  if (!existsSync(testsDir)) return [];
  for (const abs of walk(testsDir)) {
    const rel = path.relative(root, abs).replaceAll("\\", "/");
    if (MANUAL_SOLUTION_SKIP.has(rel)) continue;
    const src = readFileSync(abs, "utf8");
    if (re.test(src)) excludes.push(rel);
  }
  return excludes;
}

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,cypress,playwright,protractor,puppeteer,eslint}.config.*",
      ...missingSolutionExcludes(),
    ],
  },
});
