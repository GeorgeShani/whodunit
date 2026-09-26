/**
 * SERVER-ONLY. The ground-truth answer to a case.
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
});
export type CaseSolution = z.infer<typeof CaseSolutionSchema>;
