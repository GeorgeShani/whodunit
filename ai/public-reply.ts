/**
 * #49: the minimal PUBLIC reply a duplicate request is shown again.
 *
 * When a turn is answered, the turn lock (ai/turn-lock.ts) keeps what the player was shown: the spoken line, the
 * stage business and the emotion. Nothing else is kept: no secret ids, no reveal, no stress, no testimony, no
 * engine state. A duplicate of that turn (a double tap, a lost response, a second tab) gets 409 "already_answered"
 * with this reply and the newest token, so the client can show the answer it missed instead of a dead end.
 *
 * Pure and client-safe (zod only).
 */
import { z } from "zod";
import { EmotionSchema, IdSchema, UnitIntervalSchema } from "@/engine/types";

export const PublicReplySchema = z.strictObject({
  dialogue: z.string().trim().min(1).max(1200),
  emotion: EmotionSchema,
  intensity: UnitIntervalSchema,
  action: z.string().trim().min(1).max(200).optional(),
});
export type PublicReply = z.infer<typeof PublicReplySchema>;

export const PublicConfrontLineSchema = z.strictObject({
  characterId: IdSchema,
  characterName: z.string().min(1).max(120),
  response: PublicReplySchema,
});
export type PublicConfrontLine = z.infer<typeof PublicConfrontLineSchema>;

/** The stored shape: one reply for an interrogation, the two lines of a confrontation exchange. */
export const StoredReplySchema = z.union([
  z.strictObject({ kind: z.literal("interrogate"), characterId: IdSchema, response: PublicReplySchema }),
  z.strictObject({ kind: z.literal("confront"), lines: z.array(PublicConfrontLineSchema).min(1).max(2) }),
]);
export type StoredReply = z.infer<typeof StoredReplySchema>;

/** Keep only the public performance fields of a reply (whatever else the full response carries is dropped). */
export function toPublicReply(r: { dialogue: string; emotion: PublicReply["emotion"]; intensity: number; action?: string | undefined }): PublicReply {
  return { dialogue: r.dialogue, emotion: r.emotion, intensity: r.intensity, ...(r.action ? { action: r.action } : {}) };
}

/** Read a stored or received reply; anything malformed reads as none. */
export function parseStoredReply(u: unknown): StoredReply | null {
  const r = StoredReplySchema.safeParse(u);
  return r.success ? r.data : null;
}

export function parsePublicReply(u: unknown): PublicReply | null {
  const r = PublicReplySchema.safeParse(u);
  return r.success ? r.data : null;
}

export function parsePublicConfrontLines(u: unknown): PublicConfrontLine[] | null {
  const r = z.array(PublicConfrontLineSchema).min(1).max(2).safeParse(u);
  return r.success ? r.data : null;
}
