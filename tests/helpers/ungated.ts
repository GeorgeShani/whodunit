import type { LoadedCase } from "@/engine/case-schema";

/**
 * A copy of a loaded case with every progression field removed (leads, accuse gate, gated rooms and clues,
 * the key-testimony win rule). Engine-mechanics tests use it so they keep testing the ungated behaviour;
 * the real Blackwood progression has its own tests (tests/cases/blackwood-progression.test.ts).
 */
export function ungated(c: LoadedCase): LoadedCase {
  const copy = structuredClone(c) as LoadedCase;
  delete copy.leads;
  delete copy.accuseGate;
  for (const l of copy.locations) {
    delete l.requires;
    delete l.lockedLine;
  }
  for (const e of copy.evidence) {
    delete e.requires;
    delete e.lockedLine;
  }
  delete copy.solution.minKeyEvidence;
  delete copy.solution.keyTestimonyIds;
  delete copy.solution.minKeyTestimony;
  return copy;
}
