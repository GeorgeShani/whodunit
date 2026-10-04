/**
 * WHODUNIT?! core engine schemas.
 *
 * Single source of truth: every type is inferred from its Zod schema via
 * `z.infer`. Narrative-designer case JSON is validated against these schemas,
 * so they are intentionally strict (unknown keys are rejected).
 *
 * GOLDEN RULE: the game engine is truth, AI is performance. Nothing in here is
 * decided by the LLM. The case solution (murderer / weapon / location / time / motive)
 * lives in `engine/solution.ts` and must never be sent to the client.
 *
 * Per-character scoping: everything a character knows, believes, hides, wants,
 * or feels is attached to that character (or its runtime state), so that
 * `buildCharacterContext(caseState, characterId)` can expose exactly one
 * character's view of the world.
 */
import { z } from "zod";
import { CLAIM_LIMITS, MAX_CONFRONTATION_TURNS } from "./constants";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Stable, human-authored id: lowercase kebab/snake case, e.g. "lady-ashford". */
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

/** 0..100 gauge (relationship axes, stress, trust). */
export const PercentSchema = z.number().min(0).max(100);

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
  // Numeric trait scores, 0 = not at all, 1 = extremely. Engine + prompt tuning.
  confidence: UnitIntervalSchema,
  nervousness: UnitIntervalSchema,
  arrogance: UnitIntervalSchema,
  honesty: UnitIntervalSchema,
  impulsiveness: UnitIntervalSchema,
  empathy: UnitIntervalSchema,
  aggression: UnitIntervalSchema,
});
export type Personality = z.infer<typeof PersonalitySchema>;

// ---------------------------------------------------------------------------
// World truth: facts & locations
// ---------------------------------------------------------------------------

/** A room/place in the case. */
/** PUBLIC flavour shown when the player searches a location. */
export const SearchFlavorSchema = z.strictObject({
  /** 1-2 lines shown on a search (the engine picks one). */
  lines: z.array(NonEmptyText).min(1).max(2),
  /** Shown when a search turns up nothing new. */
  emptyLine: NonEmptyText.optional(),
});
export type SearchFlavor = z.infer<typeof SearchFlavorSchema>;

/**
 * A public art asset path under /assets (served from assets/ via sync:assets),
 * e.g. "/assets/backgrounds/manor.webp". No "..", no query strings, image types only.
 */
export const AssetPathSchema = z
  .string()
  .max(200)
  .regex(/^\/assets\/(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.(?:webp|png|jpe?g|svg)$/i, "asset paths look like /assets/<folder>/<file>.webp")
  .refine((p) => !p.includes(".."), "asset paths may not contain ..");

// ---------------------------------------------------------------------------
// Progression: conditions, gated rooms/clues, leads, the accuse gate (docs/BLACKWOOD_PROGRESSION_PROPOSAL.md §5)
// ---------------------------------------------------------------------------

/**
 * A monotone predicate over the signed game state (it only ever goes false -> true as the game is played).
 * `mode` "all" (default): every listed atom must hold; "any": one is enough. At least one atom is required.
 */
export const ConditionSchema = z
  .strictObject({
    mode: z.enum(["any", "all"]).optional(),
    /** characters[id].interrogationCount >= minExchanges (default 1). */
    interrogated: z.array(z.strictObject({ characterId: IdSchema, minExchanges: z.number().int().min(1).optional() })).optional(),
    /** In discoveredEvidenceIds. */
    evidenceIds: z.array(IdSchema).optional(),
    /** In the case-wide revealed secret set. */
    secretIds: z.array(IdSchema).optional(),
    /** In searchedLocationIds. */
    searchedLocationIds: z.array(IdSchema).optional(),
    /** The lead is open OR closed (a closed lead counts as open). */
    leadIds: z.array(IdSchema).optional(),
  })
  .refine((c) => (c.interrogated?.length ?? 0) + (c.evidenceIds?.length ?? 0) + (c.secretIds?.length ?? 0) + (c.searchedLocationIds?.length ?? 0) + (c.leadIds?.length ?? 0) > 0, {
    message: "a condition needs at least one atom (interrogated, evidenceIds, secretIds, searchedLocationIds or leadIds)",
  });
export type Condition = z.infer<typeof ConditionSchema>;

/** Public line shown while a room or clue is locked (never reveals the requirement). */
export const LockedLineSchema = z.string().trim().min(1).max(160);

/** An open question for the player (the notebook's Leads tab). State is derived on demand: hidden | open | closed. */
export const LeadSchema = z.strictObject({
  id: IdSchema,
  /** PUBLIC. */
  title: z.string().trim().min(1).max(70),
  /** PUBLIC; shown while the lead is open. */
  hint: z.string().trim().min(1).max(240),
  /** Omitted: open from the start. */
  opensWhen: ConditionSchema.optional(),
  closesWhen: ConditionSchema,
  /** PUBLIC; shown when closed. */
  closedLine: LockedLineSchema.optional(),
});
export type Lead = z.infer<typeof LeadSchema>;

/** When ACCUSE unlocks. Omitted on the case: today's behaviour (a single clue is enough). */
export const AccuseGateSchema = z.strictObject({
  minEvidence: z.number().int().min(1),
  minSuspectsQuestioned: z.strictObject({ count: z.number().int().min(1), minExchanges: z.number().int().min(1) }).optional(),
  minRevealedSecrets: z.number().int().min(0).optional(),
  closedLeadIds: z.array(IdSchema).optional(),
  /** PUBLIC hints for the first unmet item. */
  lockedLines: z
    .strictObject({
      evidence: LockedLineSchema.optional(),
      suspects: LockedLineSchema.optional(),
      secrets: LockedLineSchema.optional(),
      leads: LockedLineSchema.optional(),
      default: LockedLineSchema,
    })
    .optional(),
});
export type AccuseGate = z.infer<typeof AccuseGateSchema>;

export const LocationSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyText,
  description: NonEmptyText,
  /** Optional PUBLIC search flavour (Investigate screen). */
  searchFlavor: SearchFlavorSchema.optional(),
  /** Optional PUBLIC background art for this location (Investigate card, scenes). Falls back to assets/backgrounds/<id>.webp, then an icon. */
  background: AssetPathSchema.optional(),
  /** Searching is blocked until this holds (checked against the state BEFORE the search). Never public. */
  requires: ConditionSchema.optional(),
  /** PUBLIC line shown while locked. */
  lockedLine: LockedLineSchema.optional(),
});
export type Location = z.infer<typeof LocationSchema>;

/** The client-safe location: everything but the private `requires`. */
export type PublicLocation = Omit<Location, "requires">;

/**
 * An objective, engine-owned truth about the case world ("The butler was in
 * the pantry at 21:00"). Characters reference facts they know by id.
 */
/** Provenance of a fact. */
export const FactSourceSchema = z.enum(["witnessed", "heard", "told", "inferred", "canonical"]);
export type FactSource = z.infer<typeof FactSourceSchema>;

/**
 * Explicit per-fact hiding (knowledge gate). The fact's knowers do not see it
 * until ANY listed secret is unlocked for them (they confessed it themselves, or
 * the detective confronted them with it as testimony) or ANY listed intended lie
 * is broken for its owner. A fact with hiddenUntil skips the proximity heuristic.
 */
export const HiddenUntilSchema = z
  .strictObject({
    secretIds: z.array(IdSchema).default([]),
    lieIds: z.array(IdSchema).default([]),
  })
  .refine((h) => h.secretIds.length + h.lieIds.length > 0, { message: "hiddenUntil needs secretIds and/or lieIds" });
export type HiddenUntil = z.infer<typeof HiddenUntilSchema>;

/** Shared shape of facts and timeline entries (refinements are added per schema). */
const FactBaseSchema = z.strictObject({
  id: IdSchema,
  /** The fact stated plainly, in third person. */
  statement: NonEmptyText,
  /** Grouping used by the engine for contradiction checks and UI. */
  category: z.enum(["timeline", "location", "relationship", "object", "motive", "alibi", "background"]),
  /** When the fact happened, if time-bound (a point). Mutually exclusive with from/to. */
  time: GameTimeSchema.optional(),
  /** Window start, inclusive (use with `to`, instead of `time`). */
  from: GameTimeSchema.optional(),
  /** Window end, inclusive (use with `from`). */
  to: GameTimeSchema.optional(),
  /** Where the fact happened, if place-bound. */
  locationId: IdSchema.optional(),
  /** Characters (or the victim) this fact is about. */
  involvesCharacterIds: z.array(IdSchema).default([]),
  /** How the fact is known: canonical = objective world truth (default). */
  source: FactSourceSchema.default("canonical"),
  /** Certainty of the fact as held (1 = certain). */
  confidence: UnitIntervalSchema.default(1),
  /** Explicit hiding: withhold from its knowers until a listed secret/lie unlocks it. */
  hiddenUntil: HiddenUntilSchema.optional(),
});

function timeShape(e: { time?: string; from?: string; to?: string }, ctx: z.RefinementCtx, required: boolean) {
  const point = e.time !== undefined;
  const window = e.from !== undefined || e.to !== undefined;
  if (point && window) ctx.addIssue({ code: "custom", message: 'use either "time" (point) or "from"/"to" (window), not both' });
  else if (required && !point && !window) ctx.addIssue({ code: "custom", message: 'timeline entries need "time" or "from" + "to"' });
  else if (window && (e.from === undefined || e.to === undefined)) ctx.addIssue({ code: "custom", message: 'windows need both "from" and "to"' });
}

/** A world fact: optionally a point (`time`) OR a window (`from` + `to`, inclusive; from <= to in game-day order). */
export const FactSchema = FactBaseSchema.superRefine((f, ctx) => timeShape(f, ctx, false));
export type Fact = z.infer<typeof FactSchema>;

/**
 * A timeline entry is a Fact pinned in time: EITHER a point (`time`) OR a
 * window (`from` + `to`, inclusive). When it has a `locationId`, every id in
 * `involvesCharacterIds` is PRESENT at that location at that time; the engine
 * uses this for the opportunity check and alibis. Timeline entries share the
 * fact id namespace, so characters can list them in `knownFactIds`.
 */
export const TimelineEntrySchema = FactBaseSchema.superRefine((e, ctx) => timeShape(e, ctx, true));
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

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

/**
 * When the ENGINE reveals a secret (never the model). Conditions are:
 * stress >= stressThreshold, and/or each evidence id having been shown.
 * mode "any" = one condition suffices; "all" = every listed condition.
 * afterSecretIds are prerequisites that must already be revealed (ordering).
 */
export const RevealConditionsSchema = z
  .strictObject({
    stressThreshold: PercentSchema.optional(),
    evidenceIds: z.array(IdSchema).default([]),
    mode: z.enum(["any", "all"]).default("any"),
    afterSecretIds: z.array(IdSchema).default([]),
  })
  .refine((c) => c.stressThreshold !== undefined || c.evidenceIds.length > 0, {
    message: "revealConditions needs a stressThreshold and/or evidenceIds",
  });
export type RevealConditions = z.infer<typeof RevealConditionsSchema>;

/** Something a character is hiding. Revealed only when the engine says so. */
export const SecretSchema = z.strictObject({
  id: IdSchema,
  /** What the secret is. */
  description: NonEmptyText,
  /** How bad it is for them if it comes out. */
  severity: z.enum(["embarrassing", "serious", "damning"]),
  /** Engine-evaluated reveal rules. Omit = never auto-revealed. */
  revealConditions: RevealConditionsSchema.optional(),
  /** Facts that would be exposed if the secret were revealed. */
  relatedFactIds: z.array(IdSchema).default([]),
  /**
   * PUBLIC, spoiler-safe one-liner for the notebook's testimony card once the
   * secret is revealed (e.g. "The cook heard the keeper on the stairs after
   * the lamp went out."). Omitted: a generic "<Name> admitted something" card.
   */
  testimonySummary: NonEmptyText.max(240).optional(),
});
export type Secret = z.infer<typeof SecretSchema>;

/** How one character feels about another person (directional). Axes are 0..100. */
export const RelationshipSchema = z.strictObject({
  /** The other character, or the victim's id. */
  targetCharacterId: IdSchema,
  trust: PercentSchema,
  fear: PercentSchema,
  affection: PercentSchema,
  resentment: PercentSchema,
  suspicion: PercentSchema,
  /** Optional flavour label, e.g. "spouse", "business rival". */
  kind: NonEmptyText.optional(),
  /** Optional flavour/context for the performance layer. */
  description: NonEmptyText.optional(),
  /**
   * Optional barbs this character may throw at THIS person (confrontations; #27). A jab tied to a fact
   * (`aboutFactId`) is only offered while the character actually knows that fact.
   */
  jabs: z
    .array(
      z.strictObject({
        text: NonEmptyText,
        aboutFactId: IdSchema.optional(),
        /** "confrontation": only face to face with them; "any" (default): whenever they come up. */
        when: z.enum(["confrontation", "any"]).default("any"),
      }),
    )
    .optional(),
  /** Optional touchy subjects with THIS person: when `topic` comes up the character gets defensive in the way `text` describes. */
  defensiveOn: z.array(z.strictObject({ topic: NonEmptyText, text: NonEmptyText })).optional(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

/** An authored cover story / lie the character intends to tell. */
export const IntendedLieSchema = z
  .strictObject({
    id: IdSchema,
    /** What the lie is about, in plain words (e.g. "whereabouts at 21:15"). */
    topic: NonEmptyText.optional(),
    /** The true fact the lie contradicts, if any. */
    aboutFactId: IdSchema.optional(),
    /** The false claim, as the character would put it. */
    claim: NonEmptyText,
    /** Evidence that exposes the lie when shown to its owner (engine use). */
    brokenByEvidenceIds: z.array(IdSchema).default([]),
    /** Testimony that exposes the lie: any character's secret ids, once revealed AND presented to the owner. */
    breaksOnSecretIds: z.array(IdSchema).default([]),
    /** Facts that expose the lie: presenting a revealed secret whose relatedFactIds include one of these. */
    breaksOnFactIds: z.array(IdSchema).default([]),
    /** "any" (default): one listed condition breaks the lie; "all": every listed evidence/secret/fact condition must hold. */
    breakMode: z.enum(["any", "all"]).default("any"),
    /**
     * The owner's OWN secrets whose confession retires this lie (e.g. admitting
     * "I was alone" retires "we were together"). When any listed secret is
     * revealed the lie counts as broken, in the same turn, regardless of breakMode.
     */
    supersededBySecretIds: z.array(IdSchema).default([]),
  })
  .refine((l) => l.topic !== undefined || l.aboutFactId !== undefined, {
    message: 'intended lies need a "topic" and/or "aboutFactId"',
  });
export type IntendedLie = z.infer<typeof IntendedLieSchema>;

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/** An authored suspect/witness. Everything they know is scoped to them. */
export const CharacterSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyText,
  /** Role at the party, e.g. "The Butler". */
  role: NonEmptyText,
  /** Other ways people refer to them ("her ladyship", "the old salt"). Used by the canon check to spot who a sentence is about. */
  aliases: z.array(NonEmptyText).default([]),
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
  /** Authored lies / cover stories the character intends to tell. */
  intendedLies: z.array(IntendedLieSchema).default([]),
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
  /** Where it is found when the player searches (Investigate). No locationId = cannot be found by searching. */
  locationId: IdSchema.optional(),
  /** Optional PUBLIC one-liner shown in the discovery sting. */
  discoveryLine: NonEmptyText.optional(),
  /** Facts this evidence supports (used by the engine, never by the LLM). */
  relatedFactIds: z.array(IdSchema).default([]),
  /** Characters (or the victim) this evidence is linked to (engine use). */
  relatedCharacters: z.array(IdSchema).default([]),
  /** Is it available from the start, or unlocked by the engine? */
  initiallyAvailable: z.boolean().default(false),
  /** Asset key for its icon/illustration. */
  image: IdSchema.optional(),
  /** The clue stays hidden from searches until this holds (state BEFORE the search). Never public. Needs a locationId. */
  requires: ConditionSchema.optional(),
  /** PUBLIC line appended to a search that skipped this clue because it is locked. */
  lockedLine: LockedLineSchema.optional(),
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
  /** Testimony (a revealed secret id) presented during this exchange, if any. */
  testimonyId: IdSchema.optional(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

/** Something the detective asserted to a character. NOT a fact: never used as truth by the engine. */
export const PlayerClaimSchema = z.strictObject({
  text: z.string().min(1).max(CLAIM_LIMITS.chars),
  turn: z.number().int().nonnegative(),
});
export type PlayerClaim = z.infer<typeof PlayerClaimSchema>;

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
  /** Testimony (revealed secret ids, any character's) the player has confronted this character with. */
  testimonyShownIds: z.array(IdSchema).default([]),
  /** Statement ids this character has made. */
  statementIds: z.array(IdSchema).default([]),
  /** Number of interrogation exchanges so far. */
  interrogationCount: z.number().int().nonnegative().default(0),
  /** Engine-tracked pressure, 0..100 (drives secret reveals). */
  stress: PercentSchema.default(0),
  /** Trust toward the detective, 0..100. */
  trust: PercentSchema.default(50),
  /** Has this character had their (once-per-game) breakdown? (engine/stress.ts) */
  brokeDown: z.boolean().default(false),
  /** Own intended lies the character has TOLD the detective (engine/memory.ts: maintained + topic asked, on a performed turn). */
  liesToldIds: z.array(IdSchema).default([]),
  /** The detective's assertions to this character (untrusted; engine/memory.ts), newest last. */
  playerClaims: z.array(PlayerClaimSchema).max(CLAIM_LIMITS.perCharacter).default([]),
});
export type CharacterRuntimeState = z.infer<typeof CharacterRuntimeStateSchema>;

/** A live confrontation: two suspects face to face (MASTER_PLAN §32), capped at MAX_CONFRONTATION_TURNS exchanges. */
export const ConfrontationStateSchema = z.strictObject({
  /** [addressed first, partner], as started. */
  characterIds: z.tuple([IdSchema, IdSchema]),
  turnsUsed: z.number().int().min(0).max(MAX_CONFRONTATION_TURNS),
});
export type ConfrontationState = z.infer<typeof ConfrontationStateSchema>;

/** The player's accusation (their guess, not the truth): who, with what, why, and the proof. */
export const AccusationSchema = z.strictObject({
  murdererId: IdSchema,
  weaponId: IdSchema,
  /** One of the case's public motive options. */
  motiveId: IdSchema,
  /** Evidence the player presents as proof. */
  keyEvidenceIds: z.array(IdSchema).min(1).max(5),
  /** Revealed testimony (secret ids) cited as proof; required by cases whose solution sets minKeyTestimony. */
  keyTestimonyIds: z.array(IdSchema).max(3).optional(),
});
export type Accusation = z.infer<typeof AccusationSchema>;

/**
 * Whole-game runtime state. Contains NO solution; the engine compares an
 * accusation against the server-only CaseSolution and writes `outcome`.
 */
export const GameStateSchema = z.strictObject({
  caseId: CaseIdSchema,
  /** Random per-game id (set when the game is created or first saved; legacy tokens derive one). Keys the one-accusation guard. */
  gameId: z.string().regex(/^[A-Za-z0-9_-]{8,48}$/).optional(),
  phase: z.enum(["investigating", "interrogating", "confronting", "accusing", "resolved"]),
  /** Monotonic turn counter. */
  turn: z.number().int().nonnegative(),
  discoveredEvidenceIds: z.array(IdSchema).default([]),
  /** Locations the player has searched (Investigate). */
  searchedLocationIds: z.array(IdSchema).default([]),
  /** Case-wide set of revealed secrets (every character's), i.e. the testimony the player can present. */
  revealedSecretIds: z.array(IdSchema).default([]),
  statements: z.array(StatementSchema).default([]),
  /** Runtime state keyed by character id. */
  characters: z.record(IdSchema, CharacterRuntimeStateSchema),
  activeConfrontation: ConfrontationStateSchema.nullable().default(null),
  /** Pairs whose confrontation has run its course ("a|b", ids sorted): they won't face off again. */
  confrontedPairs: z.array(z.string()).default([]),
  /** Exchanges spent per pair ("a|b" -> n <= MAX_CONFRONTATION_TURNS). Persists when the player switches pairs (#24). */
  pairTurns: z.record(z.string(), z.number().int().min(0).max(MAX_CONFRONTATION_TURNS)).default({}),
  /** Contradiction assistance (engine/hints.ts): game turn of the last hint, and lies already hinted at (engine-private). */
  hintTurn: z.number().int().nonnegative().nullable().default(null),
  hintedLieIds: z.array(IdSchema).default([]),
  accusation: AccusationSchema.nullable().default(null),
  /** Win state: decided ONLY by the engine. */
  outcome: z.enum(["pending", "won", "lost"]).default("pending"),
});
export type GameState = z.infer<typeof GameStateSchema>;
