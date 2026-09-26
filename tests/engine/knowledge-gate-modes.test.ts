/**
 * Explicit per-fact hiding (hiddenUntil) and the case-level knowledgeGate mode
 * ("proximity" default vs "explicit"), on the harbor-light fixture.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { CaseEnvelopeSchema } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { knowledgeGate } from "@/engine/knowledge-gate";
import { TimelineEntrySchema } from "@/engine/types";
import { FIXTURES_DIR } from "../helpers/fixture";

let base: LoadedCase;
beforeAll(async () => {
  base = await loadCase("harbor-light", FIXTURES_DIR);
});

/** Clone with an extra per-minute whereabouts entry right next to the cook's protected 22:00 rum fact. */
function withNeighbour(mode: "proximity" | "explicit", hiddenUntil?: { secretIds?: string[]; lieIds?: string[] }): LoadedCase {
  const c = structuredClone(base);
  c.knowledgeGate = mode;
  c.timeline.push(
    TimelineEntrySchema.parse({
      id: "marlow-2201",
      statement: "HL_NEIGHBOUR: Marlow is in the galley.",
      category: "location",
      time: "22:01",
      locationId: "galley",
      involvesCharacterIds: ["cook-marlow"],
      ...(hiddenUntil ? { hiddenUntil } : {}),
    }),
  );
  c.characters.find((x) => x.id === "cook-marlow")!.knownFactIds.push("marlow-2201");
  return c;
}
const cook = (c: LoadedCase) => c.characters.find((x) => x.id === "cook-marlow")!;
const known = (c: LoadedCase, game = createInitialGameState(c), who = "cook-marlow") =>
  buildCharacterContext({ caseData: c, game }, who).knowledge.map((k) => k.id);

describe("knowledgeGate mode", () => {
  it('defaults to "proximity" for existing cases', () => {
    expect(base.knowledgeGate).toBe("proximity");
    const env = CaseEnvelopeSchema.parse({
      id: "x", title: "t", tagline: "t", intro: "i",
      victim: { id: "v", name: "V", description: "d", foundAtLocationId: "a", foundAt: "21:00", causeOfDeath: "c" },
      locations: [{ id: "a", name: "A", description: "d" }],
      motives: [{ id: "m1", label: "M1" }, { id: "m2", label: "M2" }],
    });
    expect(env.knowledgeGate).toBe("proximity");
  });

  it("proximity: a whereabouts entry near a protected time is withheld by the window heuristic", () => {
    const c = withNeighbour("proximity");
    const g = knowledgeGate(c, cook(c), createInitialGameState(c).characters["cook-marlow"]);
    expect(g.windows.length).toBeGreaterThan(0);
    expect(known(c)).not.toContain("marlow-2201");
    expect(known(c)).not.toContain("marlow-rum"); // direct link (lie aboutFactId / secret relatedFactIds)
  });

  it("explicit: no window heuristic, direct links still hold", () => {
    const c = withNeighbour("explicit");
    const g = knowledgeGate(c, cook(c), createInitialGameState(c).characters["cook-marlow"]);
    expect(g.windows).toEqual([]);
    expect(known(c)).toContain("marlow-2201");
    expect(known(c)).not.toContain("marlow-rum");
  });
});

describe("hiddenUntil", () => {
  it("hides a fact from its knower until the listed secret is revealed (fixture: the cook's sighting)", () => {
    const g = createInitialGameState(base);
    expect(known(base, g)).not.toContain("marlow-sees-quill");
    g.characters["cook-marlow"].revealedSecretIds = ["marlow-secret", "marlow-saw-quill"];
    expect(known(base, g)).toContain("marlow-sees-quill");
  });

  it("skips the proximity heuristic for that fact: once unlocked it shows even inside a protected window", () => {
    const c = withNeighbour("proximity", { secretIds: ["finch-secret"] });
    const g = createInitialGameState(c);
    expect(known(c, g)).not.toContain("marlow-2201"); // locked by its own rule
    // Another character's secret unlocks it only once the knower is CONFRONTED with it as testimony.
    g.characters.finch.revealedSecretIds = ["finch-secret"];
    g.revealedSecretIds = ["finch-secret"];
    expect(known(c, g)).not.toContain("marlow-2201");
    g.characters["cook-marlow"].testimonyShownIds = ["finch-secret"];
    expect(known(c, g)).toContain("marlow-2201"); // the 22:00 window would have withheld it
    expect(known(c, g)).not.toContain("marlow-rum");
  });

  it("lieIds: unlocks when the named lie (anyone's) is broken for its owner", () => {
    const c = withNeighbour("explicit", { lieIds: ["quill-lie"] });
    const g = createInitialGameState(c);
    expect(known(c, g)).not.toContain("marlow-2201");
    g.characters["keeper-quill"].evidenceShownIds = ["brass-spyglass"];
    expect(known(c, g)).toContain("marlow-2201");
  });

  it("an explicitly hidden fact overrides the direct link too (the author decides)", () => {
    const c = structuredClone(base);
    const rum = c.timeline.find((t) => t.id === "marlow-rum")!;
    rum.hiddenUntil = { secretIds: [], lieIds: ["marlow-lie"] };
    const g = createInitialGameState(c);
    expect(known(c, g)).not.toContain("marlow-rum");
    g.characters["cook-marlow"].evidenceShownIds = ["wet-logbook"]; // breaks marlow-lie; marlow-secret still locked
    expect(known(c, g)).toContain("marlow-rum");
  });
});
