/** Request/response contract for POST /api/notebook (client-safe). */
import { z } from "zod";
import type { PublicEvidence } from "./public-view";
import { CaseIdSchema } from "./types";

export const NotebookRequestSchema = z.strictObject({
  /** The case being played (from the page route). Omitted: the token's case, else the default case. */
  caseId: CaseIdSchema.optional(),
  /** The signed game-state token the client already holds. */
  stateToken: z.string().min(1).max(60_000),
});
export type NotebookRequest = z.input<typeof NotebookRequestSchema>;

export interface NotebookResponseBody {
  /** The clues this token has found, rebuilt from the case (public fields only). Empty with an error. */
  evidence: PublicEvidence[];
  error?: string;
}
