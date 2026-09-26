/**
 * Validated LLM output shape.
 *
 * GOLDEN RULE: AI is performance, not truth. A CharacterResponse can only
 * carry in-character performance (dialogue, emotion, stage business, reactions).
 * It has NO fields that could decide the murderer, weapon, location, time,
 * evidence, reveals, or win state; the engine owns all of that.
 * Any LLM output that fails validation is replaced with a safe fallback.
 */
import { z } from "zod";
import { EmotionSchema, IdSchema, UnitIntervalSchema, type Emotion } from "@/engine/types";

/** How a character visibly reacts when shown a piece of evidence. */
export const EvidenceReactionSchema = z.strictObject({
  /** Evidence id that was shown (must be one the engine provided). */
  evidenceId: IdSchema,
  /** Visible reaction flavor; the engine decides what it actually means. */
  reaction: z.enum(["dismissive", "confused", "surprised", "nervous", "defensive", "recognizes"]),
  /** Optional one-line in-character remark about it. */
  remark: z.string().trim().min(1).max(300).optional(),
});
export type EvidenceReaction = z.infer<typeof EvidenceReactionSchema>;

/** The only shape the LLM is allowed to return for a character turn. */
export const CharacterResponseSchema = z.strictObject({
  /** Spoken, in-character dialogue. */
  dialogue: z.string().trim().min(1).max(1200),
  /** Emotion the performance conveys (used for portrait/animation). */
  emotion: EmotionSchema,
  /** How strongly the emotion shows. */
  intensity: UnitIntervalSchema,
  /** Optional cartoon stage direction, e.g. "mops brow with an enormous hanky". */
  action: z.string().trim().min(1).max(200).optional(),
  /** Reactions to evidence shown this turn, if any. */
  evidenceReactions: z.array(EvidenceReactionSchema).max(5).default([]),
  /** Performance hint that the character wants to end the conversation. */
  wantsToLeave: z.boolean().default(false),
});
export type CharacterResponse = z.infer<typeof CharacterResponseSchema>;

const FALLBACK_LINES = [
  "Hm? Oh! Sorry, detective, I was miles away. What were we talking about?",
  "I... I'd rather not say anything more just now. My nerves are positively jangling!",
  "Goodness, is it warm in here? Ask me again in a moment, I've quite lost my train of thought.",
] as const;

/**
 * Safe, in-character fallback used when the LLM errors or returns invalid
 * output. Reveals nothing and changes nothing; the engine keeps full control.
 * `seed` picks a line deterministically (e.g. the current turn number).
 */
export function createFallbackCharacterResponse(
  options: { emotion?: Emotion; seed?: number } = {},
): CharacterResponse {
  const seed = Math.abs(Math.trunc(options.seed ?? 0));
  return CharacterResponseSchema.parse({
    dialogue: FALLBACK_LINES[seed % FALLBACK_LINES.length],
    emotion: options.emotion ?? "flustered",
    intensity: 0.4,
    action: "fidgets awkwardly",
    evidenceReactions: [],
    wantsToLeave: false,
  });
}
