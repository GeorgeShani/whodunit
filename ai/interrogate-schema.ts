/**
 * Request contract for POST /api/interrogate (shared by client and server).
 * The client only says WHAT the player did; the server resolves everything
 * else from the case it holds.
 */
import { z } from "zod";
import { IdSchema } from "@/engine/types";

export const InterrogateActionSchema = z.discriminatedUnion("type", [
  /** "Where were you?" */
  z.strictObject({ type: z.literal("whereabouts") }),
  /** "Tell me about the victim." */
  z.strictObject({ type: z.literal("victim") }),
  /** "What do you think of <suspect>?" */
  z.strictObject({ type: z.literal("about_suspect"), suspectId: IdSchema }),
  /** Present a discovered piece of evidence. */
  z.strictObject({ type: z.literal("present_evidence"), evidenceId: IdSchema }),
  /** Free-text question. */
  z.strictObject({ type: z.literal("free_text"), text: z.string().trim().min(1).max(500) }),
]);
export type InterrogateAction = z.infer<typeof InterrogateActionSchema>;

export const InterrogateRequestSchema = z.strictObject({
  characterId: IdSchema,
  action: InterrogateActionSchema,
  /** How many exchanges the player has had with this character (used for variety only). */
  turn: z.number().int().nonnegative().max(10_000).default(0),
});
export type InterrogateRequest = z.input<typeof InterrogateRequestSchema>;
