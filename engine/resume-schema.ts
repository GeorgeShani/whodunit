/**
 * Shared (client-safe) shapes for POST /api/resume. No database, no token crypto.
 */
import type { AccuseResponseBody } from "./accuse-schema";
import type { PublicProgress } from "./progress";
import type { PublicEvidence } from "./public-view";
import type { PublicTestimony } from "./testimony";
import type { Emotion } from "./types";

export interface ResumeSnapshot {
  discoveredEvidenceIds: string[];
  searchedLocationIds: string[];
  evidence: PublicEvidence[];
  testimonies: PublicTestimony[];
  emotions: Record<string, Emotion>;
  stress: Record<string, number>;
  progress: PublicProgress;
  confront: { pair: [string, string] | null; status: Record<string, { turnsUsed: number; over: boolean }> };
  outcome: "pending" | "won" | "lost";
}

export interface ResumeResponseBody {
  stateToken?: string;
  gameId?: string;
  caseId?: string;
  snapshot?: ResumeSnapshot;
  closed?: AccuseResponseBody;
  notice?: string;
  error?: string;
  line?: string;
}
