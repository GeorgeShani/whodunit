/**
 * Case-file schemas (what the narrative designer authors on disk).
 * See docs/CASE_FORMAT.md for the human-readable spec.
 *
 * Layout of cases/<caseId>/:
 *   case.json              -> CaseFileSchema (meta, victim, locations, facts, timeline, evidence)
 *   characters/<id>.json   -> CharacterSchema (one file per interrogable character)
 *   solution.json          -> CaseSolutionSchema (SERVER-ONLY)
 */
import { z } from "zod";
import { CaseSolutionSchema } from "./solution";
import {
  CaseIdSchema,
  CharacterSchema,
  EvidenceSchema,
  FactSchema,
  GameTimeSchema,
  IdSchema,
  LocationSchema,
} from "./types";
import { DEFAULT_DAY_STARTS_AT } from "./time";

const NonEmptyText = z.string().trim().min(1);

/** Title-card / intro information. Everything here is public. */
export const CaseMetaSchema = z.strictObject({
  /** Must equal the case directory name. */
  id: CaseIdSchema,
  title: NonEmptyText,
  tagline: NonEmptyText,
  /** Intro text shown before suspect selection (plain text, paragraphs separated by blank lines). */
  intro: NonEmptyText,
  /** Clock time at which the game day starts; earlier times count as after midnight. */
  dayStartsAt: GameTimeSchema.default(DEFAULT_DAY_STARTS_AT),
});
export type CaseMeta = z.infer<typeof CaseMetaSchema>;

/** The victim. Not interrogable; public information only (cause of death is what the player is told). */
export const VictimSchema = z.strictObject({
  /** Id usable in facts/relationships; must not collide with a character id. */
  id: IdSchema,
  name: NonEmptyText,
  description: NonEmptyText,
  /** Where the body was found (location id). May differ from the true murder location. */
  foundAtLocationId: IdSchema,
  /** When the body was found. */
  foundAt: GameTimeSchema,
  /** Publicly known cause of death, e.g. "Blunt trauma. Also, very surprised." */
  causeOfDeath: NonEmptyText,
});
export type Victim = z.infer<typeof VictimSchema>;

/**
 * Ground-truth whereabouts: character X was in location Y from `from` to `to`
 * (inclusive). Engine truth, never shown to the player or the LLM directly.
 * Used for the murderer-opportunity check and future alibi logic.
 */
export const TimelineEntrySchema = z.strictObject({
  id: IdSchema,
  characterId: IdSchema,
  locationId: IdSchema,
  from: GameTimeSchema,
  to: GameTimeSchema,
  /** Optional fact describing this presence (so characters can "know" it). */
  factId: IdSchema.optional(),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

/** Contents of cases/<id>/case.json. */
export const CaseFileSchema = z.strictObject({
  meta: CaseMetaSchema,
  victim: VictimSchema,
  locations: z.array(LocationSchema).min(1),
  facts: z.array(FactSchema).default([]),
  timeline: z.array(TimelineEntrySchema).min(1),
  evidence: z.array(EvidenceSchema).min(1),
});
export { CaseIdSchema };
export type CaseFile = z.infer<typeof CaseFileSchema>;

/** A fully loaded, validated case. SERVER-ONLY (contains the solution). */
export const LoadedCaseSchema = CaseFileSchema.extend({
  characters: z.array(CharacterSchema).min(2),
  solution: CaseSolutionSchema,
});
export type LoadedCase = z.infer<typeof LoadedCaseSchema>;
