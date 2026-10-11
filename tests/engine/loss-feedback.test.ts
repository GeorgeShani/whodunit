/** E20 (CA-64): the loss panel is built from the investigation only and is the same for every accusation. */
import { beforeAll, describe, expect, it } from "vitest";
import { handleAccuse } from "@/engine/accuse-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { LOSS_FEEDBACK_DEFAULTS, lossFeedback } from "@/engine/loss-feedback";
import { encodeStateToken } from "@/engine/state-token";
import { memoryClosedGames } from "@/lib/closed-games";
import { TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const sol = () => c.solution;
const cited = () => ({
  keyEvidenceIds: sol().keyEvidenceIds.slice(0, sol().minKeyEvidence ?? 1),
  ...((sol().minKeyTestimony ?? 0) > 0 ? { keyTestimonyIds: sol().keyTestimonyIds!.slice(0, sol().minKeyTestimony) } : {}),
});
/** Gate open: every clue, every secret but one non-core one, everyone questioned. */
function readyGame() {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push(...c.evidence.map((e) => e.id));
  for (const ch of c.characters) {
    g.characters[ch.id].interrogationCount = 5;
    for (const s of ch.secrets) {
      g.characters[ch.id].revealedSecretIds.push(s.id);
      g.revealedSecretIds.push(s.id);
    }
  }
  return g;
}
const accuse = (accusation: Record<string, unknown>) =>
  handleAccuse({ accusation, stateToken: encodeStateToken(readyGame(), TEST_ENV) }, { caseData: c, env: TEST_ENV, closed: memoryClosedGames() });

describe("E20 loss feedback", () => {
  it("a right-person loss and a wrong-person loss with the same progress get the identical panel", async () => {
    const other = c.characters.find((x) => x.id !== sol().murdererId)!.id;
    const wrongWeapon = c.evidence.find((e) => e.id !== sol().weaponId)!.id;
    const right = await accuse({ murdererId: sol().murdererId, weaponId: wrongWeapon, motiveId: sol().motiveId, ...cited() });
    const wrong = await accuse({ murdererId: other, weaponId: sol().weaponId, motiveId: sol().motiveId, ...cited() });
    expect(right.body.outcome).toBe("lost");
    expect(wrong.body.outcome).toBe("lost");
    expect(right.body.investigation!.length).toBeGreaterThan(0);
    expect(JSON.stringify(right.body.investigation)).toBe(JSON.stringify(wrong.body.investigation));
    expect(Object.keys(right.body).sort()).toEqual(Object.keys(wrong.body).sort());
  });

  it("is byte-identical for every suspect, weapon and motive", () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push(sol().keyEvidenceIds[0]);
    const weapons = [...new Set([sol().weaponId, ...c.evidence.map((e) => e.id)])];
    const motives = [...new Set([sol().motiveId, ...c.motives.map((m) => m.id)])];
    const outs = new Set<string>();
    for (const s of c.characters)
      for (const w of weapons)
        for (const m of motives) outs.add(JSON.stringify(lossFeedback(c, g, { murdererId: s.id, weaponId: w, motiveId: m, ...cited() } as never)));
    expect(outs.size).toBe(1);
  });

  it("counts only, at most two unnamed hints, and no id or name of anything", () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push(sol().keyEvidenceIds[0]);
    const lines = lossFeedback(c, g, { keyEvidenceIds: [sol().keyEvidenceIds[0]] });
    expect(lines[0]).toBe(LOSS_FEEDBACK_DEFAULTS.foundClues.replace("{n}", "1").replace("{m}", String(sol().keyEvidenceIds.length)));
    const hints = lines.filter((l) =>
      [
        LOSS_FEEDBACK_DEFAULTS.missedRoom,
        LOSS_FEEDBACK_DEFAULTS.missedSecret,
        LOSS_FEEDBACK_DEFAULTS.missedClue,
        LOSS_FEEDBACK_DEFAULTS.untestedStory,
      ].includes(l as never),
    );
    expect(hints).toEqual([LOSS_FEEDBACK_DEFAULTS.missedRoom, LOSS_FEEDBACK_DEFAULTS.missedSecret]);
    const text = lines.join(" ").toLowerCase();
    const named = [
      ...c.characters.flatMap((x) => [x.id, x.name, ...(x.aliases ?? [])]),
      ...c.evidence.flatMap((e) => [e.id, e.name]),
      ...c.locations.flatMap((l) => [l.id, l.name]),
    ];
    for (const n of named) expect(text, n).not.toContain(n.toLowerCase());
  });

  it("core-guilt secrets never count as a secret still to get", () => {
    const g = readyGame();
    const core = coreGuiltSecretIds(c);
    g.revealedSecretIds = g.revealedSecretIds.filter((id) => !core.has(id));
    expect(lossFeedback(c, g, cited())).not.toContain(LOSS_FEEDBACK_DEFAULTS.missedSecret);
  });

  it("case wording overrides the defaults; a win carries no panel", async () => {
    const cc = { ...c, lossFeedback: { foundClues: "Clues: {n}/{m}." } };
    expect(lossFeedback(cc, createInitialGameState(c), cited())[0]).toBe(`Clues: 0/${sol().keyEvidenceIds.length}.`);
    const win = await accuse({ murdererId: sol().murdererId, weaponId: sol().weaponId, motiveId: sol().motiveId, ...cited() });
    expect(win.body.outcome).toBe("won");
    expect(win.body.investigation).toBeUndefined();
  });
});
