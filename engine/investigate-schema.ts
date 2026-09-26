/** Request/response contract for POST /api/investigate (client-safe). */
import { z } from "zod";
import { IdSchema, type Evidence } from "./types";

export const InvestigateRequestSchema = z.strictObject({
  locationId: IdSchema,
  /** The SAME signed game-state token interrogate uses (omit on a new game). */
  stateToken: z.string().max(60_000).optional(),
});
export type InvestigateRequest = z.input<typeof InvestigateRequestSchema>;

/** Public evidence fields shown when a clue is found. */
export interface FoundEvidence {
  id: string;
  name: string;
  description: string;
  kind: Evidence["kind"];
  image?: string;
  discoveryLine?: string;
}

export interface InvestigateResponseBody {
  locationId?: string;
  /** Evidence found by THIS search (empty on a repeat search). */
  found: FoundEvidence[];
  /** In-character flavour lines to show. */
  lines: string[];
  /** Locations searched so far (for card state). */
  searchedLocationIds: string[];
  stateToken?: string;
  notice?: string;
  error?: string;
}
