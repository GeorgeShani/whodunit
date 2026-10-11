/** Gremlin's r7 harness (qa/r7/harness/probe*.test.ts) as a helper: run a candidate line through the REAL guard. */
import { checkReply } from "@/ai/guard";
import { prepareTurn } from "@/ai/perform-turn";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";

export type R7Spec = { rev?: [string, string][]; ev?: string[]; shown?: Record<string, string[]>; heard?: Record<string, string[]> };

export function r7State(c: LoadedCase, s: R7Spec = {}) {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push(...(s.ev ?? []));
  for (const [o, id] of s.rev ?? []) {
    g.revealedSecretIds.push(id);
    g.characters[o].revealedSecretIds.push(id);
  }
  for (const [o, v] of Object.entries(s.shown ?? {})) g.characters[o].evidenceShownIds.push(...v);
  for (const [o, v] of Object.entries(s.heard ?? {})) g.characters[o].testimonyShownIds.push(...v);
  return g;
}

/** null = the guard lets the line through; otherwise the rejection. */
export function r7Verdict(c: LoadedCase, ch: string, line: string, s: R7Spec = {}, q = "What do you make of it?", move: Record<string, unknown> = {}) {
  const p = prepareTurn({ caseData: c, game: r7State(c, s), characterId: ch, question: q, move: { allowReveal: false, ...move } as never });
  return checkReply({ dialogue: line, admits: p.plan.revealSecretId ? [p.plan.revealSecretId] : [] }, p.guard);
}

export const R7_ALL_EVIDENCE = ["silver-candlestick", "library-key", "burned-letter", "muddy-footprint"];
export const R7_INNOCENT_SECRETS: [string, string][] = [
  ["reginald", "s-reginald-theft"],
  ["reginald", "s-reginald-overheard"],
  ["archibald", "s-archibald-false-alibi"],
  ["archibald", "s-archibald-embezzlement"],
  ["gregory", "s-gregory-in-hall"],
  ["gregory", "s-gregory-saw-victoria"],
];
