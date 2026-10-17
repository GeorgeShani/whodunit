/**
 * Request/response contract for POST /api/accuse (shared by client and server).
 * Nothing about the solution or the endings exists client-side until the
 * server returns an AccuseResponseBody for a graded accusation.
 */
import type { PublicProgress } from "@/engine/progress";
import { z } from "zod";
import type { PublicEvidence } from "./public-view";
import { AccusationSchema, CaseIdSchema, type Accusation, type Emotion } from "./types";

export const MAX_ACCUSE_EVIDENCE = 5;

export const AccuseRequestSchema = z.strictObject({
  caseId: CaseIdSchema.optional(),
  accusation: AccusationSchema,
  /** Required: the signed state proves which clues have been discovered. */
  stateToken: z.string().min(1).max(60_000),
});
export type AccuseRequest = z.input<typeof AccuseRequestSchema>;

/** One line of the ending cut-scene, with the speaker resolved for display. */
export interface EndingBeat {
  /** A character id, or "narrator". */
  speaker: string;
  speakerName: string;
  text: string;
  emotion?: Emotion;
  pauseMs: number;
  evidenceIds: string[];
  section: "confession" | "recap" | "wrong" | "escaped" | "remark";
}

export interface EndingPayload {
  outcome: "won" | "lost";
  headline: string;
  accusedId: string;
  beats: EndingBeat[];
}

export interface AccuseVerdict {
  murdererCorrect: boolean;
  /** Phase 5: only for a case that asks "Did anyone help?" or has an accomplice (a win, so always true). */
  accompliceCorrect?: boolean;
  weaponCorrect: boolean;
  motiveCorrect: boolean;
  /** Enough cited clues are key evidence (solution.minKeyEvidence, default 1). */
  hasKeyEvidence: boolean;
  keyEvidenceCited: string[];
  /** Enough cited testimony is key testimony (solution.minKeyTestimony, default 0). */
  hasKeyTestimony: boolean;
}

/** The full solution, revealed only after the case is over. */
export interface SolutionReveal {
  murderer: { id: string; name: string };
  /** Phase 5: the helper, only in a two-culprit case (the reveal is win-only). */
  accomplice?: { id: string; name: string };
  weapon: { id: string; name: string };
  motive: { id: string; label: string };
  location: { id: string; name: string };
  time: string;
  keyEvidence: { id: string; name: string }[];
  explanation?: string;
}

export interface AccuseResponseBody {
  outcome?: "won" | "lost";
  accusation?: Accusation;
  verdict?: AccuseVerdict;
  /** E2: "sloppy" when a WIN cited something that supports nothing; never on a loss. */
  rating?: "clean" | "sloppy";
  solution?: SolutionReveal;
  ending?: EndingPayload;
  /** E20: on a loss only, "your investigation" lines (counts and unnamed hints; engine/loss-feedback.ts). */
  investigation?: string[];
  /** Public cards for every clue the ending or the solution mentions. */
  evidence?: PublicEvidence[];
  stateToken?: string;
  /** Leads, locked rooms and the accuse checklist after this action (engine/route-progress.ts). */
  progress?: PublicProgress;
  /** In-character line for rejections (undiscovered clue, case closed...). */
  line?: string;
  notice?: string;
  error?: string;
}

/** Client-side check before submitting (the server re-checks everything). */
export interface AccusationDraft {
  murdererId?: string;
  /** Phase 5 (3.2): undefined = not answered yet, null = "No one helped", an id = that suspect. */
  accompliceId?: string | null;
  weaponId?: string;
  motiveId?: string;
  keyEvidenceIds: string[];
  /** Revealed confessions (secret ids) cited as proof. */
  keyTestimonyIds?: string[];
}

export const MAX_ACCUSE_TESTIMONY = 3;

export function validateAccusationDraft(
  d: AccusationDraft,
  options: {
    suspectIds: readonly string[];
    evidenceIds: readonly string[];
    motiveIds: readonly string[];
    testimonyIds?: readonly string[];
    requireTestimony?: boolean;
    /** E2: the case's "Cite up to N" (progress.accuse.citeCap); absent = the absolute maxima. */
    caps?: { evidence: number; testimony: number };
    /** Phase 5: the case asks "Did anyone help?" (an answer is required, and it can't be the murderer). */
    askHelper?: boolean;
  },
): { ok: true; accusation: Accusation } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!d.murdererId || !options.suspectIds.includes(d.murdererId)) errors.push(options.askHelper ? "Pick who struck the fatal blow." : "Pick the murderer.");
  if (options.askHelper) {
    if (d.accompliceId === undefined) errors.push("Say whether anyone helped.");
    else if (d.accompliceId !== null && !options.suspectIds.includes(d.accompliceId)) errors.push("Pick a helper from the suspects, or say no one helped.");
    else if (d.accompliceId !== null && d.accompliceId === d.murdererId) errors.push("The helper can't be the one who struck the blow.");
  }
  if (!d.weaponId || !options.evidenceIds.includes(d.weaponId)) errors.push("Pick the weapon from your clues.");
  if (!d.motiveId || !options.motiveIds.includes(d.motiveId)) errors.push("Pick a motive.");
  const ids = [...new Set(d.keyEvidenceIds)];
  if (ids.length < 1) errors.push("Cite at least one clue as proof.");
  const maxEvidence = Math.min(MAX_ACCUSE_EVIDENCE, options.caps?.evidence ?? MAX_ACCUSE_EVIDENCE);
  const maxTestimony = Math.min(MAX_ACCUSE_TESTIMONY, options.caps?.testimony ?? MAX_ACCUSE_TESTIMONY);
  if (ids.length > maxEvidence) errors.push(`Cite at most ${maxEvidence} clues.`);
  if (!ids.every((id) => options.evidenceIds.includes(id))) errors.push("You can only cite clues in your notebook.");
  const testimony = [...new Set(d.keyTestimonyIds ?? [])];
  if (options.requireTestimony && testimony.length < 1) errors.push("Cite a confession as proof: pick revealed testimony from your notebook.");
  if (testimony.length > maxTestimony) errors.push(`Cite at most ${maxTestimony} confessions.`);
  if (!testimony.every((id) => (options.testimonyIds ?? []).includes(id))) errors.push("You can only cite confessions in your notebook.");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    accusation: {
      murdererId: d.murdererId!,
      ...(options.askHelper ? { accompliceId: d.accompliceId ?? null } : {}),
      weaponId: d.weaponId!,
      motiveId: d.motiveId!,
      keyEvidenceIds: ids,
      ...(testimony.length ? { keyTestimonyIds: testimony } : {}),
    },
  };
}
