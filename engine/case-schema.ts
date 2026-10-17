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
import { MAX_CASE_CONFRONTATION_TOTAL, MAX_CONFRONTATION_TURNS } from "./constants";
import { EndingsSchema } from "./endings";
import { CaseAudioSchema, OrderLandmarkSchema, OrderWordsSchema, SettingSchema, ThemeSchema } from "./presentation";
import { CaseSolutionSchema } from "./solution";
import { DEFAULT_DAY_STARTS_AT } from "./time";
import {
  AccuseGateSchema,
  AssetPathSchema,
  CaseIdSchema,
  CharacterSchema,
  EvidenceSchema,
  FactSchema,
  GameTimeSchema,
  IdSchema,
  LeadSchema,
  LocationSchema,
  TimelineEntrySchema,
} from "./types";

const NonEmptyText = z.string().trim().min(1);

/** The victim. Not interrogable; everything here is PUBLIC (shown on the intro screen). */
export const VictimSchema = z.strictObject({
  /** Id usable in facts, timeline and relationships; must not collide with a character id. */
  id: IdSchema,
  name: NonEmptyText,
  /** Other ways people refer to the victim ("his lordship"). Used by the canon check to spot who a sentence is about. */
  aliases: z.array(NonEmptyText).default([]),
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

/** One case-specific tip for the How to Play manual (PUBLIC, spoiler-free; shown under "Tips for this case"). */
export const HowToPlayTipSchema = z.string().trim().min(1).max(200);
export const MAX_HOW_TO_PLAY_TIPS = 8;

/** Optional per-case confrontation caps (defaults 6 / 12; ceilings MAX_CONFRONTATION_TURNS / MAX_CASE_CONFRONTATION_TOTAL). */
export const ConfrontationCapsSchema = z.strictObject({
  /** Exchanges one pair may have (1..MAX_CONFRONTATION_TURNS). */
  perPair: z.number().int().min(1).max(MAX_CONFRONTATION_TURNS).optional(),
  /** Exchanges in the whole game, across every pair (1..MAX_CASE_CONFRONTATION_TOTAL). */
  total: z.number().int().min(1).max(MAX_CASE_CONFRONTATION_TOTAL).optional(),
});

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
  /**
   * How the engine hides the truth behind locked secrets / unbroken lies from the character's context:
   * "proximity" (default): direct links (lie aboutFactId, locked secret relatedFactIds) PLUS the time-window
   *   heuristic (the character's own entries near a protected time are withheld too).
   * "explicit": direct links only, no window heuristic. In both modes a fact with `hiddenUntil` follows only its own rule.
   */
  knowledgeGate: z.enum(["explicit", "proximity"]).default("proximity"),
  /**
   * C3 (optional, SERVER-ONLY): tuning for the guilt check's single-word name tokens. A multi-word name ("the Marmalade
   * King", "Boat Deck") is matched in full and, by default, by its words too, minus a generic stoplist of ordinary
   * English words (engine/name-tokens.ts). `ignoreNameTokens` drops more words; `keepNameTokens` puts a stoplisted
   * word back (e.g. a surname that is also a common word). Lower-case single words.
   */
  guiltCheck: z
    .strictObject({
      ignoreNameTokens: z.array(z.string().regex(/^[a-z][a-z'’-]*$/, "a lower-case single word")).optional(),
      keepNameTokens: z.array(z.string().regex(/^[a-z][a-z'’-]*$/, "a lower-case single word")).optional(),
    })
    .optional(),
  /**
   * E10 (optional): the case's own wording for engine system lines, so they can match its canon (who is in charge,
   * whether anyone can reach the house). Each falls back to a neutral engine default (engine/session.ts SYSTEM_LINES).
   */
  systemLines: z
    .strictObject({
      /** A suspect addressed after the accusation (interrogate, confront, hint). */
      caseClosed: z.string().trim().min(1).max(300).optional(),
      /** A search after the accusation. */
      caseClosedSearch: z.string().trim().min(1).max(300).optional(),
      /** The closed-games record can't be written (503; nothing decided, try again). */
      recordDown: z.string().trim().min(1).max(300).optional(),
    })
    .optional(),
  /**
   * E20 (optional): the case's wording for the loss panel (engine/loss-feedback.ts). `{n}` and `{m}` are the counts.
   * Each falls back to the engine default.
   */
  lossFeedback: z
    .strictObject({
      foundClues: z.string().trim().min(1).max(160).optional(),
      foundTestimony: z.string().trim().min(1).max(160).optional(),
      citedTooFew: z.string().trim().min(1).max(160).optional(),
      missedRoom: z.string().trim().min(1).max(160).optional(),
      missedSecret: z.string().trim().min(1).max(160).optional(),
      missedClue: z.string().trim().min(1).max(160).optional(),
      untestedStory: z.string().trim().min(1).max(160).optional(),
    })
    .optional(),
  /** Progression (optional): open questions the player works through. Omitted: no leads. */
  leads: z.array(LeadSchema).optional(),
  /** Progression (optional): when ACCUSE unlocks. Omitted: today's behaviour (a single clue is enough). */
  accuseGate: AccuseGateSchema.optional(),
  /**
   * Optional PUBLIC tips for this case, shown in the How to Play manual under "Tips for this case" (1-8 tips of
   * 1-200 characters). Omitted or empty: the section is not shown. Never name the culprit, the weapon or the motive.
   */
  howToPlayTips: z.array(HowToPlayTipSchema).max(MAX_HOW_TO_PLAY_TIPS).optional(),
  /** Optional confrontation caps; omitted fields use the global defaults (6 per pair, 12 per game). */
  confrontation: ConfrontationCapsSchema.optional(),
  /** Phase 3 (engine/presentation.ts): in-world wording. Omitted: the default (first-case) wording. */
  setting: SettingSchema.optional(),
  /** Phase 3 (Q7): presentation only (palette tokens, logo, title art). Omitted: the default theme. */
  theme: ThemeSchema.optional(),
  /** Phase 3: order-of-events landmarks (ai/order-check.ts). Omitted: the engine's default five; [] turns the check off. */
  orderLandmarks: z.array(OrderLandmarkSchema).max(12).optional(),
  /** Phase 3 (DX5): extra absence/movement words for the order check, added to the defaults. */
  orderWords: OrderWordsSchema.optional(),
  /** Phase 3 (E9): per-screen beds and cue file overrides. Omitted: the default sound. */
  audio: CaseAudioSchema.optional(),
  /**
   * Phase 5 (3.2, D3): PUBLIC accuse-form options. `askHelper: true` shows the role-worded form ("Who struck the fatal
   * blow?", then "Did anyone help?" with an explicit "No one helped") for every game of this case, whatever the
   * answer, so it says nothing about the solution. Required when solution.accompliceId is set (V6). Omitted: the
   * single-culprit form ("Who did it?"), unchanged.
   */
  accuse: z.strictObject({ askHelper: z.boolean() }).optional(),
  /** Phase 6 (4.1): the feature modules this case opts into (engine/features/registry.ts). Omitted: none. */
  features: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).max(8).optional(),
  /** Phase 6: SERVER-ONLY config per declared feature, parsed by that module's configSchema (load errors otherwise). */
  featureConfig: z.record(z.string(), z.unknown()).optional(),
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
