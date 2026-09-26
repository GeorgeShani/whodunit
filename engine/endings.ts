/**
 * SERVER-ONLY. Authored endings (cases/<id>/endings.json).
 *
 * Endings spell out the solution, so they must never reach the public view,
 * the character context or the LLM. The engine picks and plays them after it
 * has graded an accusation.
 */
import { z } from "zod";
import { EmotionSchema, IdSchema } from "./types";

const NonEmptyText = z.string().trim().min(1);

/** One beat of an ending cut-scene. */
export const EndingLineSchema = z.strictObject({
  /** A character id, or "narrator". */
  speaker: z.union([z.literal("narrator"), IdSchema]),
  text: NonEmptyText,
  /** Pause after the line, in ms. */
  pauseMs: z.number().int().min(0).max(5000).optional(),
  /** Portrait emotion while the line plays. */
  emotion: EmotionSchema.optional(),
  /** Evidence to flash while the line plays. */
  evidenceIds: z.array(IdSchema).optional(),
});
export type EndingLine = z.infer<typeof EndingLineSchema>;

const Lines = z.array(EndingLineSchema).min(1);

export const EndingsSchema = z.strictObject({
  /** Correct accusation: the culprit's confession, then the recap. */
  correct: z.strictObject({ confession: Lines, recap: Lines }),
  /**
   * Wrong accusation, keyed by the ACCUSED suspect id. Must cover EVERY
   * suspect, including the murderer (right culprit, but the case wasn't proven).
   */
  wrong: z.record(IdSchema, Lines),
  /** Final line when the murderer gets away. */
  escapedLine: NonEmptyText,
});
export type Endings = z.infer<typeof EndingsSchema>;
