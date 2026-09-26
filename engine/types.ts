/**
 * WHODUNIT?! core engine schemas.
 *
 * Single source of truth: every type is inferred from its Zod schema via
 * `z.infer`. Narrative-designer case JSON is validated against these schemas,
 * so they are intentionally strict (unknown keys are rejected).
 *
 * GOLDEN RULE: the game engine is truth, AI is performance. Nothing in here is
 * decided by the LLM. The case solution (murderer / weapon / location / time)
 * lives in `engine/solution.ts` and must never be sent to the client.
 *
 * Per-character scoping: everything a character knows, believes, hides, wants,
 * or feels is attached to that character (or its runtime state), so that
 * `buildCharacterContext(caseState, characterId)` can expose exactly one
 * character's view of the world.
 */
import { z } from "zod";
import { MAX_CONFRONTATION_TURNS } from "./constants";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Stable, human-authored id: lowercase kebab/snake case, e.g. "lady-blackwood". */
export const IdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "ids must be lowercase kebab/snake case")
  .max(64);
export type Id = z.infer<typeof IdSchema>;

/** Case id = folder name under cases/. A leading "_" marks internal/placeholder cases. */
export const CaseIdSchema = z
  .string()
  .regex(/^_?[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "case ids must be lowercase kebab/snake case (optional leading _)")
  .max(64);
export type CaseId = z.infer<typeof CaseIdSchema>;

/** In-world clock time, 24h "HH:MM" (e.g. "21:45"). */
export const GameTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be 24h "HH:MM"');
export type GameTime = z.infer<typeof GameTimeSchema>;

/** Normalized 0..1 value (intensity, confidence, composure...). */
export const UnitIntervalSchema = z.number().min(0).max(1);

const NonEmptyText = z.string().trim().min(1);

// ---------------------------------------------------------------------------
// Emotion
// ---------------------------------------------------------------------------

/** The fixed emotion palette. Drives portraits, animations and voice tone. */
export const EmotionSchema = z.enum([
  "calm",
  "nervous",
  "defensive",
  "angry",
  "sad",
  "scared",
  "smug",
  "amused",
  "flustered",
  "suspicious",
  "shocked",
  "panicked",
  "relieved",
]);
export type Emotion = z.infer<typeof EmotionSchema>;

/** A character's current emotional state (engine-owned, AI only reflects it). */
export const EmotionalStateSchema = z.strictObject({
  /** Dominant emotion right now. */
  emotion: EmotionSchema,
  /** How strongly the emotion is felt (0 = barely, 1 = overwhelming). */
  intensity: UnitIntervalSchema,
  /** How well they're holding it together (1 = unflappable, 0 = cracking). */
  composure: UnitIntervalSchema,
});
export type EmotionalState = z.infer<typeof EmotionalStateSchema>;

// ---------------------------------------------------------------------------
// Personality
// ---------------------------------------------------------------------------

/** How a character talks and behaves. Pure flavor for the performance layer. */
export const PersonalitySchema = z.strictObject({
  /** Short trait keywords, e.g. ["pompous", "cowardly"]. */
  traits: z.array(NonEmptyText).min(1),
  /** Voice / speech style guidance, e.g. "Speaks in flowery Victorian prose". */
  speechStyle: NonEmptyText,
  /** Signature lines the character may drop. */
  catchphrases: z.array(NonEmptyText).default([]),
  /** Physical/verbal habits (cartoon business), e.g. "twirls moustache". */
  quirks: z.array(NonEmptyText).default([]),
  /** Visible tells when lying or stressed, e.g. "voice goes up an octave". */
  tells: z.array(NonEmptyText).default([]),
});
export type Personality = z.infer<typeof PersonalitySchema>;

// ---------------------------------------------------------------------------
// World truth: facts & locations
// ---------------------------------------------------------------------------

/** A room/place in the case. */
export const LocationSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyText,
  description: NonEmptyText,
});
export type Location = z.infer<typeof LocationSchema>;

/**
 * An objective, engine-owned truth about the case world ("The butler was in
 * the pantry at 21:00"). Characters reference facts they know by id.
 */
export const FactSchema = z.strictObject({
  id: IdSchema,
  /** The fact stated plainly, in third person. */
  statement: NonEmptyText,
  /** Grouping used by the engine for contradiction checks and UI. */
  category: z.enum(["timeline", "location", "relationship", "object", "motive", "alibi", "background"]),
  /** When the fact happened, if time-bound. */
  time: GameTimeSchema.optional(),
  /** Where the fact happened, if place-bound. */
  locationId: IdSchema.optional(),
  /** Characters this fact is about. */
  involvesCharacterIds: z.array(IdSchema).default([]),
});
export type Fact = z.infer<typeof FactSchema>;

// ---------------------------------------------------------------------------
// Per-character inner world
// ---------------------------------------------------------------------------

/** Something a character believes; may be wrong (red herrings live here). */
export const BeliefSchema = z.strictObject({
  id: IdSchema,
  /** The belief in the character's own framing. */
  statement: NonEmptyText,
  /** The fact this belief is about, if any. */
  aboutFactId: IdSchema.optional(),
  /** Whether the belief matches the truth (engine-only; never shown to AI as a label). */
  isAccurate: z.boolean(),
  /** How sure the character is. */
  confidence: UnitIntervalSchema,
});
export type Belief = z.infer<typeof BeliefSchema>;

/** Something a character is hiding. Revealed only when the engine says so. */
export const SecretSchema = z.strictObject({
  id: IdSchema,
  /** What the secret is. */
  description: NonEmptyText,
  /** How bad it is for them if it comes out. */
  severity: z.enum(["embarrassing", "serious", "damning"]),
  /** Evidence ids that, when shown, pressure this secret. */
  pressuredByEvidenceIds: z.array(IdSchema).default([]),
  /** Facts that would be exposed if the secret were revealed. */
  relatedFactIds: z.array(IdSchema).default([]),
});
export type Secret = z.infer<typeof SecretSchema>;

/** How one character feels about another (directional). */
export const RelationshipSchema = z.strictObject({
  /** The other character. */
  characterId: IdSchema,
  /** Short label, e.g. "spouse", "business rival", "secret lover". */
  kind: NonEmptyText,
  /** -1 = loathes, 0 = neutral, 1 = adores. */
  sentiment: z.number().min(-1).max(1),
  /** Flavor/context for the performance layer. */
  description: NonEmptyText,
});
export type Relationship = z.infer<typeof RelationshipSchema>;

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/** An authored suspect/witness. Everything they know is scoped to them. */
export const CharacterSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyText,
  /** Role at the party, e.g. "The Butler". */
  role: NonEmptyText,
  /** Short public bio shown to the player. */
  bio: NonEmptyText,
  personality: PersonalitySchema,
  /** What they want out of this conversation/night (e.g. "protect my inheritance"). */
  goals: z.array(NonEmptyText).min(1),
  /** Ids of facts this character actually knows to be true. */
  knownFactIds: z.array(IdSchema).default([]),
  beliefs: z.array(BeliefSchema).default([]),
  secrets: z.array(SecretSchema).default([]),
  relationships: z.array(RelationshipSchema).default([]),
  /** Emotional state at the start of the case. */
  initialEmotion: EmotionalStateSchema,
  /** Asset key for their portrait set (resolved under assets/characters). */
  portrait: IdSchema.optional(),
});
export type Character = z.infer<typeof CharacterSchema>;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** A clue the player can find and show to characters. */
export const EvidenceSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyText,
  /** What the player sees when inspecting it. */
  description: NonEmptyText,
  kind: z.enum(["physical", "document", "testimony", "observation"]),
  /** Where it can be found. */
  locationId: IdSchema.optional(),
  /** Facts this evidence supports (used by the engine, never by the LLM). */
  relatedFactIds: z.array(IdSchema).default([]),
  /** Is it available from the start, or unlocked by the engine? */
  initiallyAvailable: z.boolean().default(false),
  /** Asset key for its icon/illustration. */
  image: IdSchema.optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---------------------------------------------------------------------------
// Statements (the record of what was said)
// ---------------------------------------------------------------------------

/** A line spoken by a character, recorded by the engine for contradiction tracking. */
export const StatementSchema = z.strictObject({
  id: IdSchema,
  /** Who said it. */
  characterId: IdSchema,
  /** The spoken text (as performed by the AI or authored). */
  text: NonEmptyText,
  /** Game turn when it was said. */
  turn: z.number().int().nonnegative(),
  /** Where it was said. */
  mode: z.enum(["interrogation", "confrontation", "authored"]),
  /** Facts the statement is (engine-)linked to, e.g. the alibi it asserts. */
  relatedFactIds: z.array(IdSchema).default([]),
  /** Evidence that contradicts this statement (engine-computed). */
  contradictedByEvidenceIds: z.array(IdSchema).default([]),
});
export type Statement = z.infer<typeof StatementSchema>;

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

/** One remembered exchange from this character's point of view. */
export const MemoryEntrySchema = z.strictObject({
  turn: z.number().int().nonnegative(),
  speaker: z.enum(["player", "character"]),
  text: NonEmptyText,
  /** Evidence shown during this exchange, if any. */
  evidenceId: IdSchema.optional(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

/** Mutable, engine-owned state for a single character during play. */
export const CharacterRuntimeStateSchema = z.strictObject({
  characterId: IdSchema,
  emotion: EmotionalStateSchema,
  /** What this character remembers of their conversations with the player. */
  memory: z.array(MemoryEntrySchema).default([]),
  /** Evidence the player has shown to this character. */
  evidenceShownIds: z.array(IdSchema).default([]),
  /** Secrets the engine has decided are now revealed. */
  revealedSecretIds: z.array(IdSchema).default([]),
  /** Statement ids this character has made. */
  statementIds: z.array(IdSchema).default([]),
  /** Number of interrogation exchanges so far. */
  interrogationCount: z.number().int().nonnegative().default(0),
});
export type CharacterRuntimeState = z.infer<typeof CharacterRuntimeStateSchema>;

/** A live confrontation with one suspect. */
export const ConfrontationStateSchema = z.strictObject({
  characterId: IdSchema,
  turnsUsed: z.number().int().min(0).max(MAX_CONFRONTATION_TURNS),
});
export type ConfrontationState = z.infer<typeof ConfrontationStateSchema>;

/** The player's accusation (their guess, not the truth). */
export const AccusationSchema = z.strictObject({
  murdererId: IdSchema,
  weaponId: IdSchema,
  locationId: IdSchema,
  time: GameTimeSchema,
});
export type Accusation = z.infer<typeof AccusationSchema>;

/**
 * Whole-game runtime state. Contains NO solution; the engine compares an
 * accusation against the server-only CaseSolution and writes `outcome`.
 */
export const GameStateSchema = z.strictObject({
  caseId: CaseIdSchema,
  phase: z.enum(["investigating", "interrogating", "confronting", "accusing", "resolved"]),
  /** Monotonic turn counter. */
  turn: z.number().int().nonnegative(),
  discoveredEvidenceIds: z.array(IdSchema).default([]),
  statements: z.array(StatementSchema).default([]),
  /** Runtime state keyed by character id. */
  characters: z.record(IdSchema, CharacterRuntimeStateSchema),
  activeConfrontation: ConfrontationStateSchema.nullable().default(null),
  accusation: AccusationSchema.nullable().default(null),
  /** Win state: decided ONLY by the engine. */
  outcome: z.enum(["pending", "won", "lost"]).default("pending"),
});
export type GameState = z.infer<typeof GameStateSchema>;
