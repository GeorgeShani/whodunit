/**
 * The testimony chain SUGGESTED for Blackwood (applied to an in-memory copy;
 * the case files are Agatha's and stay untouched): the Victoria/Archibald
 * "together all blackout" alibi cracks from what Reginald, Archibald and
 * Gregory admit, once the player confronts them with it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences, checkCaseWarnings } from "@/engine/case-validation";
import { createInitialGameState } from "@/engine/game-state";
import { commitTurn, planTurn } from "@/engine/interrogation";
import { brokenLieIds } from "@/engine/testimony";
import type { GameState } from "@/engine/types";

/** The breaksOnSecretIds proposed to Agatha, by lie id. */
const SUGGESTED_BREAKS: Record<string, string[]> = {
  "l-archibald-together": ["s-reginald-theft"],
  "l-reginald-heard-nothing": ["s-archibald-false-alibi"],
  "l-victoria-together": ["s-reginald-theft", "s-archibald-false-alibi", "s-gregory-saw-victoria"],
  "l-victoria-never-in-hall": ["s-gregory-saw-victoria"],
  "l-victoria-locked-in": ["s-gregory-saw-victoria"],
  "l-victoria-menu": ["s-reginald-overheard"],
};

let c: LoadedCase;
beforeAll(async () => {
  c = structuredClone(await loadCase("blackwood"));
  for (const ch of c.characters) for (const l of ch.intendedLies) if (SUGGESTED_BREAKS[l.id]) l.breaksOnSecretIds = SUGGESTED_BREAKS[l.id];
  for (const ch of c.characters) for (const s of ch.secrets) s.testimonySummary = `summary of ${s.id}`;
});

function turn(g: GameState, who: string, move: { presentedEvidenceId?: string; presentedTestimonyId?: string }) {
  const plan = planTurn(c, g, who, move);
  commitTurn(g, plan, { playerText: "?", dialogue: "…", emotion: "nervous", intensity: 0.5, stressDelta: 0, trustDelta: 0, performed: true });
  return plan;
}
const lies = (g: GameState, who: string) => brokenLieIds(c, c.characters.find((x) => x.id === who)!, g.characters[who]);

describe("Blackwood testimony suggestions", () => {
  it("validate cleanly (no errors, no design warnings)", () => {
    expect(checkCaseReferences(c)).toEqual([]);
    expect(checkCaseWarnings(c)).toEqual([]);
  });

  it("the alibi cracks through testimony, not just clues", () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push("burned-letter", "library-key", "muddy-footprint");

    // Reginald: the letter makes him admit the pantry, and that he heard Mr Crane on the telephone.
    expect(turn(g, "reginald", { presentedEvidenceId: "burned-letter" }).revealSecretId).toBe("s-reginald-theft");
    expect(g.revealedSecretIds).toEqual(["s-reginald-theft"]);

    // Put Reginald's admission to Archibald and to Victoria: "together all blackout" is blown for both.
    expect(turn(g, "archibald", { presentedTestimonyId: "s-reginald-theft" }).newlyExposedLieIds).toEqual(["l-archibald-together"]);
    expect(lies(g, "victoria")).toEqual([]);
    const v = turn(g, "victoria", { presentedTestimonyId: "s-reginald-theft" });
    expect(v.newlyExposedLieIds).toEqual(["l-victoria-together"]);
    expect(v.engineStressDelta).toBe(15);

    // Gregory: footprint, then key → he saw her lock the door; confronting her with it breaks two more stories.
    turn(g, "gregory", { presentedEvidenceId: "muddy-footprint" });
    expect(turn(g, "gregory", { presentedEvidenceId: "library-key" }).revealSecretId).toBe("s-gregory-saw-victoria");
    const v2 = turn(g, "victoria", { presentedTestimonyId: "s-gregory-saw-victoria" });
    expect(v2.newlyExposedLieIds.sort()).toEqual(["l-victoria-locked-in", "l-victoria-never-in-hall"]);
    expect(v2.engineStressDelta).toBe(30);
  });
});
