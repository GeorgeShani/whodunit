/**
 * Request/response contract for POST /api/interrogate (shared by client and server).
 * The client says WHAT the player did and hands back the opaque, server-signed
 * state token; the server resolves everything else from the case it holds.
 */
import type { PublicProgress } from "@/engine/progress";
import type { StressReading } from "@/engine/stress";
import { z } from "zod";
import { CaseIdSchema, IdSchema } from "@/engine/types";
import type { PublicTestimony } from "@/engine/testimony";
import type { CharacterResponse } from "./schemas";

export const MAX_QUESTION_CHARS = 500;

export const InterrogateRequestSchema = z.strictObject({
  /** The case being played (from the page route). Omitted: the token's case, else the default case. */
  caseId: CaseIdSchema.optional(),
  characterId: IdSchema,
  /** What the detective says (free text or a quick-question button's line). */
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  /** Evidence held up this turn; must already be discovered (checked server-side). */
  presentedEvidenceId: IdSchema.optional(),
  /** Testimony held up this turn: a secret id that must already be revealed (checked against the signed state). Not together with evidence. */
  presentedTestimonyId: IdSchema.optional(),
  /** Opaque HMAC-signed runtime state from the previous response (omit on a new game). */
  stateToken: z.string().max(60_000).optional(),
});
export type InterrogateRequest = z.input<typeof InterrogateRequestSchema>;

/**
 * Deterministic engine verdict: the item presented THIS turn broke at least one
 * of the character's intended lies (newly). Decided by the engine only; the UI
 * shows an OBJECTION beat and notes it on the notebook card. Never set for
 * irrelevant items, repeats, or lies already broken.
 */
export interface Contradiction {
  characterId: string;
  characterName: string;
  item: { kind: "evidence" | "testimony"; id: string };
  /** How many of their lies it newly broke. */
  lieCount: number;
}

export interface InterrogateResponseBody {
  response: CharacterResponse;
  /** Who performed this line: the live model, or the in-character fallback. */
  source: "model" | "fallback";
  /** New signed state to send with the next request (absent only if the request itself was unusable). */
  stateToken?: string;
  /** Leads, locked rooms and the accuse checklist after this action (engine/route-progress.ts). */
  progress?: PublicProgress;
  /** The notebook's testimony cards: every secret revealed so far (public summaries). */
  testimonies?: PublicTestimony[];
  /** Set only when the presented item newly broke one of the character's lies. */
  contradiction?: Contradiction;
  /** Engine stress for the character just questioned (meter + breakdown beat). */
  stress?: StressReading;
  /** In-character narrator line, e.g. when a tampered/stale state was reset. */
  notice?: string;
  /** Non-secret machine-readable reason for a fallback or rejection. */
  error?: string;
}
