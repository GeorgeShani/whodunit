/**
 * Case-file contract: the single source of truth for authored cases.
 * Human-readable spec: docs/CASE_FORMAT.md.
 *
 * Layout of cases/<caseId>/:
 *   case.json              -> CaseEnvelopeSchema (id, title, tagline, intro, victim, locations, facts, motives)
 *   timeline.json          -> TimelineFileSchema (TimelineEntry[]: points or windows)
 *   evidence.json          -> EvidenceFileSchema (Evidence[])
 *   characters/<id>.json   -> CharacterSchema (one file per interrogable character)
 *   solution.json          -> CaseSolutionSchema (SERVER-ONLY)
 *   endings.json           -> EndingsSchema (SERVER-ONLY; optional for now)
 */
import { z } from "zod";
import { EndingsSchema } from "./endings";
import { CaseSolutionSchema } from "./solution";
import { DEFAULT_DAY_STARTS_AT } from "./time";
import {
  AssetPathSchema,
  CaseIdSchema,
  CharacterSchema,
  EvidenceSchema,
  FactSchema,
  GameTimeSchema,
  IdSchema,
  LocationSchema,
  TimelineEntrySchema,
} from "./types";

const NonEmptyText = z.string().trim().min(1);

/** The victim. Not interrogable; everything here is PUBLIC (shown on the intro screen). */
export const VictimSchema = z.strictObject({
  /** Id usable in facts, timeline and relationships; must not collide with a character id. */
  id: IdSchema,
  name: NonEmptyText,
  description: NonEmptyText,
  /** Where the body was found (location id). May differ from the true murder location. */
  foundAtLocationId: IdSchema,
  /** When the body was found. */
  foundAt: GameTimeSchema,
  /** Publicly known cause of death. */
  causeOfDeath: NonEmptyText,
});
export type Victim = z.infer<typeof VictimSchema>;

/** A motive the player can pick when accusing. PUBLIC multiple-choice option; the true one is solution.motiveId. */
export const MotiveOptionSchema = z.strictObject({
  id: IdSchema,
  /** Short player-facing label, e.g. "Inheritance". */
  label: NonEmptyText,
  description: NonEmptyText.optional(),
});
export type MotiveOption = z.infer<typeof MotiveOptionSchema>;

/** cases/<id>/case.json */
/** Per-screen backdrop art for a case (all optional). */
export const CaseBackdropsSchema = z.strictObject({
  title: AssetPathSchema.optional(),
  suspects: AssetPathSchema.optional(),
  interrogation: AssetPathSchema.optional(),
  investigate: AssetPathSchema.optional(),
});
export type CaseBackdrops = z.infer<typeof CaseBackdropsSchema>;

export const CaseEnvelopeSchema = z.strictObject({
  /** Must equal the case folder name. */
  id: CaseIdSchema,
  title: NonEmptyText,
  tagline: NonEmptyText,
  /** Intro text shown before suspect selection (paragraphs separated by a blank line). */
  intro: NonEmptyText,
  /** Clock time at which the game day starts; earlier times count as after midnight. */
  dayStartsAt: GameTimeSchema.default(DEFAULT_DAY_STARTS_AT),
  victim: VictimSchema,
  locations: z.array(LocationSchema).min(1),
  /** World facts that are not pinned to the timeline. */
  facts: z.array(FactSchema).default([]),
  /** Motive options for the accusation screen (include red herrings). */
  motives: z.array(MotiveOptionSchema).min(2),
  /** Optional PUBLIC scene backdrops per screen (asset paths). Each falls back to the default look. */
  backdrops: CaseBackdropsSchema.optional(),
});
export type CaseEnvelope = z.infer<typeof CaseEnvelopeSchema>;

/** cases/<id>/timeline.json */
export const TimelineFileSchema = z.array(TimelineEntrySchema).min(1);

/** cases/<id>/evidence.json */
export const EvidenceFileSchema = z.array(EvidenceSchema).min(1);

/** A fully loaded, validated case. SERVER-ONLY (contains the solution). */
export const LoadedCaseSchema = CaseEnvelopeSchema.extend({
  timeline: TimelineFileSchema,
  evidence: EvidenceFileSchema,
  characters: z.array(CharacterSchema).min(2),
  solution: CaseSolutionSchema,
  /** Authored endings (SERVER-ONLY). Optional until every case ships endings.json. */
  endings: EndingsSchema.optional(),
});
export type LoadedCase = z.infer<typeof LoadedCaseSchema>;

export { CaseIdSchema };
