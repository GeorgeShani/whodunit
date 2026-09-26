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
  /** Optional server-only write-up for the reveal screen. */
  explanation: z.string().trim().min(1).optional(),
});
export type CaseSolution = z.infer<typeof CaseSolutionSchema>;
