/** Request/response contract for POST /api/investigate (client-safe). */
import type { PublicProgress } from "@/engine/progress";
import { z } from "zod";
import { CaseIdSchema, IdSchema } from "./types";
import type { PublicEvidence } from "./public-view";

export const InvestigateRequestSchema = z.strictObject({
  /** The case being played (from the page route). Omitted: the token's case, else the default case. */
  caseId: CaseIdSchema.optional(),
  locationId: IdSchema,
  /** The SAME signed game-state token interrogate uses (omit on a new game). */
  stateToken: z.string().max(60_000).optional(),
});
export type InvestigateRequest = z.input<typeof InvestigateRequestSchema>;

/**
 * A clue found by this search: exactly the notebook shape every route shares (engine/public-view toPublicEvidence),
 * so public flags such as `weapon` (a weapon candidate, never the solution) always reach the client.
 */
export type FoundEvidence = PublicEvidence;

export interface InvestigateResponseBody {
  locationId?: string;
  /** Evidence found by THIS search (empty on a repeat search). */
  found: FoundEvidence[];
  /** In-character flavour lines to show. */
  lines: string[];
  /** The room is closed for now: `lines` holds its lockedLine and nothing was searched. */
  locked?: boolean;
  /** Locations searched so far (for card state). */
  searchedLocationIds: string[];
  stateToken?: string;
  /** Leads, locked rooms and the accuse checklist after this action (engine/route-progress.ts). */
  progress?: PublicProgress;
  notice?: string;
  error?: string;
}
