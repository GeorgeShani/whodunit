/**
 * SERVER-ONLY. The ground-truth answer to a case (cases/<id>/solution.json).
 *
 * Never import this from a client component, never serialize it into a
 * response, and never pass it to the LLM. The engine alone uses it to judge
 * accusations and set `GameState.outcome`.
 */
import { z } from "zod";
import { GameTimeSchema, IdSchema } from "./types";

export const CaseSolutionSchema = z.strictObject({
  /** Character id of the murderer. */
  murdererId: IdSchema,
  /**
   * G1 (case-two plan 3.1, D2): the character who helped the murderer, in a two-culprit case. Strict roles: a win needs
   * murdererId as the murderer AND this id as the accomplice. Absent: nobody helped (every single-culprit case).
   */
  accompliceId: IdSchema.optional(),
  /** Phase 5 (design G3): when and where the accomplice did their part; the validator runs the opportunity rule on it (V5). */
  accompliceAct: z.strictObject({ locationId: IdSchema, time: GameTimeSchema }).optional(),
  /**
   * Phase 5 (design G5, Q9): cite at least one id from EACH group (on top of minKeyTestimony), so two testimonies
   * about one half of the crime can't stand in for a witness to each half. Every id must be in keyTestimonyIds.
   */
  keyTestimonyGroups: z.array(z.array(IdSchema).min(1)).min(1).optional(),
  /** Evidence id of the murder weapon. */
  weaponId: IdSchema,
  /** Location id where the murder happened. */
  locationId: IdSchema,
  /** Time of the murder, 24h "HH:MM". */
  time: GameTimeSchema,
  /** The true motive: one of case.json `motives[].id`. */
  motiveId: IdSchema,
  /** Evidence that proves the case; an accusation must cite these (judging rules come later). */
  keyEvidenceIds: z.array(IdSchema).min(1),
  /** How many of keyEvidenceIds an accusation must cite to win (default 1). */
  minKeyEvidence: z.number().int().min(1).optional(),
  /** Revealed secrets (testimony) that prove the case; with minKeyTestimony an accusation must cite some of them. */
  keyTestimonyIds: z.array(IdSchema).optional(),
  /** How many of keyTestimonyIds an accusation must cite to win (default 0). */
  minKeyTestimony: z.number().int().min(0).optional(),
  /**
   * E2: clues that also SUPPORT the accusation without being key (citing them is never sloppy). Absent: only
   * keyEvidenceIds support. Must exist and must not overlap keyEvidenceIds.
   */
  supportingEvidenceIds: z.array(IdSchema).optional(),
  /** E2: the same for testimony (secret ids), alongside keyTestimonyIds. */
  supportingTestimonyIds: z.array(IdSchema).optional(),
  /**
   * Phase 6 (Marvin, #72): the solution-bearing part of a feature module's config, keyed by feature name, e.g.
   * `{ "time-misdirection": { "provedBy": ["<key evidence>"] } }`. Lives here, never in case.json `featureConfig`, so no
   * solution id is committed in public case data; each module parses its own entry (registry `checkFeatureConfig`).
   */
  featureProof: z.record(IdSchema, z.unknown()).optional(),
  /** Optional server-only write-up for the reveal screen. */
  explanation: z.string().trim().min(1).optional(),
});
export type CaseSolution = z.infer<typeof CaseSolutionSchema>;
