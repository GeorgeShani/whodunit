/** Request/response contract for POST /api/confront (shared by client and server). */
import { z } from "zod";
import type { StressReading } from "@/engine/stress";
import type { PublicTestimony } from "@/engine/testimony";
import { CaseIdSchema, IdSchema } from "@/engine/types";
import { MAX_QUESTION_CHARS } from "./interrogate-schema";
import type { Contradiction } from "./interrogate-schema";
import type { CharacterResponse } from "./schemas";

export const ConfrontRequestSchema = z.strictObject({
  caseId: CaseIdSchema.optional(),
  /** [who the detective addresses, who faces them]. */
  characterIds: z.tuple([IdSchema, IdSchema]),
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  /** Optional: hold up a discovered clue OR a revealed testimony to the addressed suspect (same exchange). */
  presentedEvidenceId: IdSchema.optional(),
  presentedTestimonyId: IdSchema.optional(),
  stateToken: z.string().max(60_000).optional(),
});
export type ConfrontRequest = z.input<typeof ConfrontRequestSchema>;

export interface ConfrontLine {
  characterId: string;
  characterName: string;
  response: CharacterResponse;
  source: "model" | "fallback";
  stress: StressReading;
  contradiction?: Contradiction;
}

export interface ConfrontResponseBody {
  /** Addressed character first, then the partner's reaction. Empty on a rejection. */
  lines: ConfrontLine[];
  confrontation?: { characterIds: [string, string]; turnsUsed: number; max: number; over: boolean; /** Exchanges left in the whole game (all pairs). */ totalLeft: number };
  stateToken?: string;
  testimonies?: PublicTestimony[];
  /** In-character line for a rejection (pair finished, case closed...). */
  line?: string;
  notice?: string;
  error?: string;
}
