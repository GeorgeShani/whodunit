/**
 * SERVER-ONLY case loader. Reads cases/<caseId>/ from disk, validates every
 * file with Zod, runs referential checks, and returns a LoadedCase (which
 * includes the solution, so never send it to the client; use
 * getPublicCaseView from engine/public-view.ts instead).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import {
  CaseEnvelopeSchema,
  CaseIdSchema,
  EvidenceFileSchema,
  TimelineFileSchema,
  type CaseEnvelope,
  type LoadedCase,
  type PlayableCase,
  type SolvedCase,
} from "./case-schema";
import { checkCaseReferences, formatIssue, type CaseIssue } from "./case-validation";
import { mergeEndings, PublicEndingsSchema, type PublicEndings } from "./endings";
import { canonicalCaseId } from "@/lib/case-aliases";
import {
  CaseSolutionSchema,
  caseSolutionEnvName,
  readSolutionFromEnv,
  type CaseSolution,
} from "./solution";
import { CharacterSchema, type Character, type Evidence, type TimelineEntry } from "./types";

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
  /** Present only when there are no issues at all (includes a valid solution). */
  data?: LoadedCase;
  /**
   * Playable case data when the only problem is a missing or invalid solution (file or env).
   * The game can still load; accusations fail closed. Never present alongside `data`.
   */
  playable?: PlayableCase;
}

function isSolutionIssue(issue: CaseIssue): boolean {
  return issue.file === "solution.json" || issue.file.startsWith("CASE_SOLUTION_");
}

function zodIssues(file: string, error: z.ZodError): CaseIssue[] {
  return error.issues.map((i) => ({
    file,
    path: i.path.length ? i.path.join(".") : undefined,
    message: i.message,
  }));
}

async function readJson(dir: string, file: string, issues: CaseIssue[], optional = false): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, file), "utf8");
  } catch {
    if (!optional) issues.push({ file, message: "file is missing" });
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
  const requestedId = caseId;
  caseId = canonicalCaseId(caseId);
  if (!CaseIdSchema.safeParse(caseId).success || !CaseIdSchema.safeParse(requestedId).success) {
    return { caseId: requestedId, issues: [{ file: requestedId, message: "invalid case id (lowercase kebab/snake case)" }] };
  }
  const dir = path.join(casesDir, caseId);

  let envelope: CaseEnvelope | undefined;
  const caseRaw = await readJson(dir, "case.json", issues);
  if (caseRaw !== undefined) {
    const r = CaseEnvelopeSchema.safeParse(caseRaw);
    if (r.success) {
      envelope = r.data;
      if (envelope.id !== caseId) {
        issues.push({ file: "case.json", path: "id", message: `id "${envelope.id}" must equal the folder name "${caseId}"` });
      }
    } else issues.push(...zodIssues("case.json", r.error));
  }

  let timeline: TimelineEntry[] | undefined;
  const tlRaw = await readJson(dir, "timeline.json", issues);
  if (tlRaw !== undefined) {
    const r = TimelineFileSchema.safeParse(tlRaw);
    if (r.success) timeline = r.data;
    else issues.push(...zodIssues("timeline.json", r.error));
  }

  let evidence: Evidence[] | undefined;
  const evRaw = await readJson(dir, "evidence.json", issues);
  if (evRaw !== undefined) {
    const r = EvidenceFileSchema.safeParse(evRaw);
    if (r.success) evidence = r.data;
    else issues.push(...zodIssues("evidence.json", r.error));
  }

  let solution: CaseSolution | undefined;
  // File first (committed solutions and local authoring). If the file is absent, a server-only
  // CASE_SOLUTION_<ID> env var may supply base64 JSON. Never log the value.
  const solRaw = await readJson(dir, "solution.json", issues, true);
  if (solRaw !== undefined) {
    const r = CaseSolutionSchema.safeParse(solRaw);
    if (r.success) solution = r.data;
    else issues.push(...zodIssues("solution.json", r.error));
  } else {
    const fromEnv = readSolutionFromEnv(caseId);
    if (fromEnv.ok) solution = fromEnv.solution;
    else if (fromEnv.reason === "invalid") {
      issues.push({ file: caseSolutionEnvName(caseId), message: "environment solution is invalid" });
    } else {
      issues.push({ file: "solution.json", message: "file is missing" });
    }
  }

  // endings.json is optional. Culprit-naming parts may live on the solution instead.
  let fileEndings: PublicEndings | undefined;
  const endRaw = await readJson(dir, "endings.json", issues, true);
  if (endRaw !== undefined) {
    const r = PublicEndingsSchema.safeParse(endRaw);
    if (r.success) fileEndings = r.data;
    else issues.push(...zodIssues("endings.json", r.error));
  }
  const endings = mergeEndings(fileEndings, solution?.endings);
  // Keep culprit-naming endings on c.endings only, so LoadedCase.solution stays the id payload.
  if (solution?.endings) {
    const { endings: _secret, ...rest } = solution;
    solution = rest;
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
  // L4: honour case.json characterOrder (suspect cards / accuse grid). Omitted: keep alphabetical file order.
  if (envelope?.characterOrder?.length) {
    const order = new Map(envelope.characterOrder.map((id, i) => [id, i] as const));
    characters.sort((a, b) => {
      const ai = order.get(a.id);
      const bi = order.get(b.id);
      if (ai != null && bi != null && ai !== bi) return ai - bi;
      if (ai != null && bi == null) return -1;
      if (ai == null && bi != null) return 1;
      return a.id.localeCompare(b.id);
    });
  }

  if (!envelope || !timeline || !evidence) return { caseId, issues };
  const playable = { ...envelope, timeline, evidence, characters, ...(endings ? { endings } : {}) };
  if (issues.length || !solution) {
    return { caseId, issues, ...(issues.every(isSolutionIssue) ? { playable } : {}) };
  }

  const data: LoadedCase = { ...playable, solution };
  issues.push(...checkCaseReferences(data));
  return issues.length ? { caseId, issues } : { caseId, issues, data };
}

/** Load a fully validated case (solution required) or throw CaseValidationError. */
export async function loadCase(caseId: string, casesDir = DEFAULT_CASES_DIR): Promise<LoadedCase> {
  const result = await validateCase(caseId, casesDir);
  if (!result.data) throw new CaseValidationError(caseId, result.issues);
  return result.data;
}

/**
 * Load a case for play even when the solution file / env is missing or invalid.
 * Accusations must fail closed in character when `solution` is absent.
 */
export async function loadPlayableCase(caseId: string, casesDir = DEFAULT_CASES_DIR): Promise<PlayableCase> {
  const result = await validateCase(caseId, casesDir);
  if (result.data) return result.data;
  if (result.playable && result.issues.every(isSolutionIssue)) return result.playable;
  throw new CaseValidationError(caseId, result.issues);
}

const cache = new Map<string, Promise<PlayableCase>>();

/** Memoized loadCase for request handlers (cases are static files). */
export function getCase(caseId: string, casesDir = DEFAULT_CASES_DIR): Promise<PlayableCase> {
  const key = `${casesDir}::${caseId}`;
  let p = cache.get(key);
  if (!p) {
    p = loadPlayableCase(caseId, casesDir);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
