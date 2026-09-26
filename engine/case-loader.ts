/**
 * SERVER-ONLY case loader. Reads cases/<caseId>/ from disk, validates every
 * file with Zod, runs referential checks, and returns a LoadedCase (which
 * includes the solution, so never send it to the client; use
 * getPublicCaseView from engine/public-view.ts instead).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { CaseFileSchema, CaseIdSchema, type CaseFile, type LoadedCase } from "./case-schema";
import { checkCaseReferences, formatIssue, type CaseIssue } from "./case-validation";
import { CaseSolutionSchema, type CaseSolution } from "./solution";
import { CharacterSchema, type Character } from "./types";

export const DEFAULT_CASES_DIR = path.join(process.cwd(), "cases");

export class CaseValidationError extends Error {
  constructor(
    public readonly caseId: string,
    public readonly issues: CaseIssue[],
  ) {
    super(`Case "${caseId}" is invalid:\n${issues.map((i) => `  - ${formatIssue(i)}`).join("\n")}`);
    this.name = "CaseValidationError";
  }
}

export interface CaseValidationResult {
  caseId: string;
  issues: CaseIssue[];
  /** Present only when there are no issues at all. */
  data?: LoadedCase;
}

function zodIssues(file: string, error: z.ZodError): CaseIssue[] {
  return error.issues.map((i) => ({
    file,
    path: i.path.length ? i.path.join(".") : undefined,
    message: i.message,
  }));
}

async function readJson(dir: string, file: string, issues: CaseIssue[]): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, file), "utf8");
  } catch {
    issues.push({ file, message: "file is missing" });
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    issues.push({ file, message: `invalid JSON: ${(e as Error).message}` });
    return undefined;
  }
}

/** Load + validate a case, collecting every issue instead of throwing. */
export async function validateCase(caseId: string, casesDir = DEFAULT_CASES_DIR): Promise<CaseValidationResult> {
  const issues: CaseIssue[] = [];
  if (!CaseIdSchema.safeParse(caseId).success) {
    return { caseId, issues: [{ file: caseId, message: "invalid case id (lowercase kebab/snake case)" }] };
  }
  const dir = path.join(casesDir, caseId);

  let caseFile: CaseFile | undefined;
  const caseRaw = await readJson(dir, "case.json", issues);
  if (caseRaw !== undefined) {
    const r = CaseFileSchema.safeParse(caseRaw);
    if (r.success) {
      caseFile = r.data;
      if (caseFile.meta.id !== caseId) {
        issues.push({ file: "case.json", path: "meta.id", message: `meta.id "${caseFile.meta.id}" must equal the folder name "${caseId}"` });
      }
    } else issues.push(...zodIssues("case.json", r.error));
  }

  let solution: CaseSolution | undefined;
  const solRaw = await readJson(dir, "solution.json", issues);
  if (solRaw !== undefined) {
    const r = CaseSolutionSchema.safeParse(solRaw);
    if (r.success) solution = r.data;
    else issues.push(...zodIssues("solution.json", r.error));
  }

  const characters: Character[] = [];
  let charFiles: string[] = [];
  try {
    charFiles = (await readdir(path.join(dir, "characters"))).filter((f) => f.endsWith(".json")).sort();
  } catch {
    issues.push({ file: "characters/", message: "folder is missing" });
  }
  if (charFiles.length < 2 && issues.every((i) => i.file !== "characters/")) {
    issues.push({ file: "characters/", message: `need at least 2 character files, found ${charFiles.length}` });
  }
  for (const f of charFiles) {
    const file = `characters/${f}`;
    const raw = await readJson(dir, file, issues);
    if (raw === undefined) continue;
    const r = CharacterSchema.safeParse(raw);
    if (!r.success) {
      issues.push(...zodIssues(file, r.error));
      continue;
    }
    if (`${r.data.id}.json` !== f) issues.push({ file, path: "id", message: `id "${r.data.id}" must match the file name (expected ${r.data.id}.json)` });
    characters.push(r.data);
  }

  if (issues.length || !caseFile || !solution) return { caseId, issues };

  const data: LoadedCase = { ...caseFile, characters, solution };
  issues.push(...checkCaseReferences(data));
  return issues.length ? { caseId, issues } : { caseId, issues, data };
}

/** Load a case or throw CaseValidationError. */
export async function loadCase(caseId: string, casesDir = DEFAULT_CASES_DIR): Promise<LoadedCase> {
  const result = await validateCase(caseId, casesDir);
  if (!result.data) throw new CaseValidationError(caseId, result.issues);
  return result.data;
}

const cache = new Map<string, Promise<LoadedCase>>();

/** Memoized loadCase for request handlers (cases are static files). */
export function getCase(caseId: string, casesDir = DEFAULT_CASES_DIR): Promise<LoadedCase> {
  const key = `${casesDir}::${caseId}`;
  let p = cache.get(key);
  if (!p) {
    p = loadCase(caseId, casesDir);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
