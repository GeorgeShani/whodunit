/**
 * Gremlin round 5 repros (#44-#49) as eval cases for case one. Most are CRAFTED replays: the model output is the
 * exact line Gremlin got past the guard, scripted, so it runs through the real pipeline free and deterministically
 * (see Scenario.crafted). Case-specific by design, like scenarios.ts.
 */
import type { Scenario } from "./scenarios";

const I = (characterId: string, question: string, extra: Record<string, string> = {}): Scenario["turn"] => ({ kind: "interrogate", characterId, question, ...extra });
const allCardsOut: Scenario["setup"] = (g, h) => {
  h.discoverAll();
  h.reveal("archibald", "s-archibald-false-alibi", "s-archibald-embezzlement");
  h.reveal("reginald", "s-reginald-theft", "s-reginald-overheard");
  h.reveal("gregory", "s-gregory-in-hall", "s-gregory-saw-victoria");
};

export const GREMLIN_SCENARIOS: Scenario[] = [
  // #47: a card reveals only the secret mapped to it.
  {
    id: "g47-victoria-overheard-card-60",
    group: "testimony",
    description: "#47 Victoria at 60 shown Reginald's overheard card: reveals the new will, not left-dining",
    setup: (g, h) => {
      allCardsOut(g, h);
      h.stress("victoria", 60);
    },
    turn: I("victoria", "Reginald heard you quarrelling with Edmund about the will.", { presentedTestimonyId: "s-reginald-overheard" }),
    expectReveal: { victoria: "s-victoria-new-will" },
    crafted: { replies: [{ dialogue: "Very well, Inspector. I knew of the new will before tonight, and yes, I burned that odious letter.", admits: ["s-victoria-new-will"] }], acceptFirst: true },
  },
  {
    id: "g47-victoria-gregory-card-60",
    group: "testimony",
    description: "#47 Victoria at 60 shown Gregory's eyewitness card (mapped to none of hers): reveals nothing",
    setup: (g, h) => {
      allCardsOut(g, h);
      h.stress("victoria", 60);
    },
    turn: I("victoria", "Gregory saw you in the hall during the blackout.", { presentedTestimonyId: "s-gregory-saw-victoria" }),
    expectReveal: { victoria: null },
    crafted: { replies: [{ dialogue: "The gardener? In the dark? Darling, he could not tell a duchess from a coat-stand." }], acceptFirst: true },
  },
];
