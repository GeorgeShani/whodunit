/**
 * SERVER-ONLY. Authored endings (cases/<id>/endings.json), with an optional
 * overlay on the solution (file or CASE_SOLUTION_* env) for culprit-naming
 * endings that must not be committed.
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
  /** E2: one extra line after a WIN that cited something that doesn't support it (never played on a loss). */
  sloppyRemark: EndingLineSchema.optional(),
});
export type Endings = z.infer<typeof EndingsSchema>;

/** Culprit-naming endings that may live on the solution instead of endings.json. */
export const SecretEndingsSchema = z.strictObject({
  correct: z.strictObject({ confession: Lines, recap: Lines }),
  /** Typically the murderer's (and, in a two-culprit case, the helper's) own wrong entry. */
  wrong: z.record(IdSchema, Lines).optional(),
});
export type SecretEndings = z.infer<typeof SecretEndingsSchema>;

/**
 * The committed endings.json may omit `correct` and any `wrong` entry that names the culprit;
 * those can be supplied on the solution instead. A full Endings object is also valid here.
 */
export const PublicEndingsSchema = z.strictObject({
  correct: z.strictObject({ confession: Lines, recap: Lines }).optional(),
  wrong: z.record(IdSchema, Lines).optional(),
  escapedLine: NonEmptyText.optional(),
  sloppyRemark: EndingLineSchema.optional(),
});
export type PublicEndings = z.infer<typeof PublicEndingsSchema>;

/** Overlay secret endings onto the public file. Secret `correct` / `wrong` entries win on conflict. */
export function mergeEndings(file?: PublicEndings, fromSolution?: SecretEndings): PublicEndings | undefined {
  if (!file && !fromSolution) return undefined;
  const wrong = { ...(file?.wrong ?? {}), ...(fromSolution?.wrong ?? {}) };
  const correct = fromSolution?.correct ?? file?.correct;
  const escapedLine = file?.escapedLine;
  const sloppyRemark = file?.sloppyRemark;
  const out: PublicEndings = {};
  if (correct) out.correct = correct;
  if (Object.keys(wrong).length) out.wrong = wrong;
  if (escapedLine) out.escapedLine = escapedLine;
  if (sloppyRemark) out.sloppyRemark = sloppyRemark;
  return out.correct || out.wrong || out.escapedLine || out.sloppyRemark ? out : undefined;
}
