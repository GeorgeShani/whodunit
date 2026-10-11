/** "Searched" marker: a searched room where a newly unlocked clue became findable is reported as fresh (and only then). */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { InvestigateScreen } from "@/components/investigate/InvestigateScreen";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { searchLocation } from "@/engine/investigation";
import { publicProgress } from "@/engine/progress";
import type { GameState } from "@/engine/types";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

/** Deterministic pseudo-random walk over legal-ish actions (search, talk, reveal a non-core secret). */
function walk(seed: number, steps: number, visit: (g: GameState) => void) {
  let x = seed;
  const rnd = (n: number) => ((x = (x * 1103515245 + 12345) % 2 ** 31), x % n);
  const g = createInitialGameState(c);
  const core = coreGuiltSecretIds(c);
  const secrets = c.characters.flatMap((ch) => ch.secrets.filter((s) => !core.has(s.id)).map((s) => ({ ch: ch.id, s })));
  for (let i = 0; i < steps; i++) {
    const a = rnd(3);
    if (a === 0) searchLocation(c, g, c.locations[rnd(c.locations.length)]!.id);
    else if (a === 1) g.characters[c.characters[rnd(c.characters.length)]!.id].interrogationCount++;
    else {
      const pick = secrets[rnd(secrets.length)]!;
      if (!g.revealedSecretIds.includes(pick.s.id)) {
        g.revealedSecretIds.push(pick.s.id);
        g.characters[pick.ch].revealedSecretIds.push(pick.s.id);
      }
    }
    visit(g);
  }
}

describe("fresh rooms (Searched marker)", () => {
  it("fresh == searched rooms where searching again would find a clue, in every visited state", () => {
    let freshSeen = 0;
    for (let seed = 1; seed <= 40; seed++)
      walk(seed, 40, (g) => {
        const fresh = publicProgress(c, g).freshLocationIds ?? [];
        for (const l of c.locations) {
          const probe = structuredClone(g);
          const wouldFind = g.searchedLocationIds.includes(l.id) && searchLocation(c, probe, l.id).newlyFound.length > 0;
          expect(fresh.includes(l.id), `${l.id} @ ${g.discoveredEvidenceIds.join("+")}`).toBe(wouldFind);
        }
        freshSeen += fresh.length;
      });
    expect(freshSeen).toBeGreaterThan(0); // the walk does reach "searched, then a clue unlocked there"
  });

  it("the card shows 'Something new' instead of 'Searched' for a fresh room, and nothing when locked", () => {
    const locations = [
      { id: "a", name: "A", description: "d" },
      { id: "b", name: "B", description: "d" },
    ] as never;
    const props = { locations, searched: ["a", "b"], lines: {}, pendingId: null, onSearch: () => {}, onBack: () => {} };
    const out = renderToStaticMarkup(h(InvestigateScreen, { ...props, freshLocationIds: ["b"] }));
    expect(out).toContain("✨ Something new");
    expect(out.match(/✔ Searched/g)?.length).toBe(1);
    expect(renderToStaticMarkup(h(InvestigateScreen, props))).not.toContain("Something new");
  });
});
