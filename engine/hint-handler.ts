/**
 * SERVER-ONLY. POST /api/hint: one contradiction hint from engine state (no
 * model call). Response carries only the character's public id/name and a
 * spoiler-safe line: never the lie, the item, or the lie id.
 */
import { z } from "zod";
import type { LoadedCase } from "./case-schema";
import { HINT_COOLDOWN_TURNS, hintCooldown, takeHint } from "./hints";
import { CASE_CLOSED_LINE, isCaseClosed, restoreSession, saveSession } from "./session";
import { CaseIdSchema } from "./types";

type Env = Record<string, string | undefined>;

export const HintRequestSchema = z.strictObject({
  caseId: CaseIdSchema.optional(),
  stateToken: z.string().max(60_000).optional(),
});
export type HintRequest = z.input<typeof HintRequestSchema>;

export interface HintResponseBody {
  /** The hint, or null (nothing to flag / cooling down / refused). */
  hint: { characterId: string; characterName: string } | null;
  /** What to show the player. */
  line: string;
  /** Game turns until another hint may be asked for (0 = ready). */
  readyInTurns: number;
  cooldownTurns: number;
  stateToken?: string;
  notice?: string;
  error?: string;
}

export function handleHint(json: unknown, deps: { caseData: LoadedCase; env?: Env; legacyCaseId?: string }): { status: number; body: HintResponseBody } {
  const { caseData, env, legacyCaseId } = deps;
  const parsed = HintRequestSchema.safeParse(json);
  const empty = { hint: null, readyInTurns: 0, cooldownTurns: HINT_COOLDOWN_TURNS };
  if (!parsed.success) return { status: 400, body: { ...empty, line: "The inspector squints at your request.", error: "invalid_request" } };
  if (parsed.data.caseId !== undefined && parsed.data.caseId !== caseData.id) return { status: 404, body: { ...empty, line: "No such case.", error: "unknown_case" } };
  const { game, notice } = restoreSession(caseData, parsed.data.stateToken, env, { legacyCaseId });
  const extra = notice ? { notice } : {};
  if (isCaseClosed(game)) return { status: 409, body: { ...empty, ...extra, line: CASE_CLOSED_LINE, error: "case_closed", stateToken: saveSession(game, env) } };
  const r = takeHint(caseData, game);
  const stateToken = saveSession(game, env);
  if (r.kind === "cooldown") {
    const line = `Give it a moment, detective. Ask a few more questions first (${r.readyInTurns} more ${r.readyInTurns === 1 ? "answer" : "answers"}).`;
    return { status: 429, body: { ...empty, ...extra, line, readyInTurns: r.readyInTurns, error: "cooldown", stateToken } };
  }
  if (r.kind === "none") return { status: 200, body: { ...empty, ...extra, line: r.text, stateToken } };
  return {
    status: 200,
    body: { ...empty, ...extra, hint: { characterId: r.hint.characterId, characterName: r.hint.characterName }, line: r.text, readyInTurns: hintCooldown(game), stateToken },
  };
}
