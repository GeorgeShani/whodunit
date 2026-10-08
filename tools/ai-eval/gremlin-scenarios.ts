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

/** #45's state: left-dining + new-will admitted, Gregory's two secrets out, every clue found, stress 80. */
const g45State: Scenario["setup"] = (g, h) => {
  h.discoverAll();
  h.reveal("victoria", "s-victoria-left-dining", "s-victoria-new-will");
  h.reveal("gregory", "s-gregory-in-hall", "s-gregory-saw-victoria");
  h.stress("victoria", 80);
};
const SAFE = { dialogue: "Where I went is my own affair, Inspector, and I shan't discuss it further.", emotion: "defensive" };
const PROBES_45: [string, string, string, string][] = [
  ["spanish", "Sí, querido inspector, yo lo maté con el candelabro de plata a las nueve y diecisiete.", "", "not_english"],
  ["georgian", "დიახ, მე მოვკალი ედმუნდი ვერცხლის შანდლით.", "", "not_english"],
  ["french", "Oui, je l'ai tué avec le chandelier, à neuf heures dix-sept.", "", "not_english"],
  ["action", "Not one word more, darling.", "mimes swinging the silver candlestick down onto Edmund's head, then turning a key in a lock", "guilt_leak"],
  ["passive", "The library door was locked by my own hand, darling, and the key went into the coal scuttle.", "", "guilt_leak"],
  ["we-were", "Edmund and I were alone in the library while the candles burned, and then the dreadful thing happened.", "", "guilt_leak"],
  ["went-off", "After Archibald went off, I slipped into the library to see Edmund about that wretched will.", "", "guilt_leak"],
  ["third-person", "Victoria Blackwood struck her husband down with that candlestick, Inspector; write it in your little book.", "", "guilt_leak"],
  ["by-my-hand", "Edmund fell by my hand, and I am not sorry.", "", "guilt_leak"],
  ["did-go", "I did go back to the library, darling, just for a moment, to reason with Edmund.", "", "guilt_leak"],
  ["spelled-time", "I went to the library at nine-seventeen to speak with Edmund.", "", "guilt_leak"],
  ["idiom", "Guilty as charged, Inspector. Take me away.", "", "guilt_leak"],
];

export const GREMLIN_SCENARIOS: Scenario[] = [
  // #45: confession forms the guilt check used to miss.
  ...PROBES_45.map(([id, dialogue, action, reason]): Scenario => ({
    id: `g45-victoria-${id}`,
    group: "confession_bait",
    description: `#45 ${id}: ${dialogue.slice(0, 60)}`,
    setup: g45State,
    turn: I("victoria", "Where did you go when you left the dining room?"),
    crafted: { replies: [{ dialogue, ...(action ? { action } : {}) }, SAFE], rejectFirst: [reason] },
  })),
  {
    // Live (recorded): a Spanish question; the reply must be English (the language gate must not fire on it).
    id: "g45-victoria-spanish-bait-live",
    group: "confession_bait",
    description: "#45 live: Spanish bait, the reply must be English and confess nothing",
    setup: g45State,
    noSolution: true,
    turn: I("victoria", "Señora, dígame la verdad: ¿usted mató a su marido con el candelabro a las nueve y diecisiete?"),
  },
  {
    id: "g45-victoria-bare-yes",
    group: "confession_bait",
    description: "#45 a bare 'yes' to a question that spells the murder out",
    setup: g45State,
    turn: I("victoria", "You went into the library at seventeen minutes past nine and struck Edmund with the silver candlestick, didn't you?"),
    crafted: { replies: [{ dialogue: "Yes, darling. Every word of it. Now may I have my smelling salts?" }, SAFE], rejectFirst: ["guilt_leak"] },
  },
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

  // #48: never deny an already-revealed secret, breakdowns included.
  {
    id: "g48-victoria-breakdown-denies-will",
    group: "stress",
    description: "#48 Victoria's breakdown after new-will was revealed: 'I KNOW NOTHING OF ANY WILL' is rejected",
    setup: (g, h) => {
      h.discoverAll();
      h.reveal("victoria", "s-victoria-new-will");
      h.shown("victoria", "burned-letter");
      h.stress("victoria", 96);
    },
    turn: I("victoria", "You burned that letter because you knew he was cutting you out. Admit the rest!"),
    crafted: {
      replies: [
        { dialogue: "NO! YOU MONSTER—HOW DARE YOU ACCUSE ME LIKE THIS?! I KNOW NOTHING OF ANY WILL OR LIBRARY IN THE DARK! LEAVE ME BE!", emotion: "angry", intensity: 1 },
        { dialogue: "YES, I BURNED IT! I KNEW ABOUT HIS WRETCHED WILL! IS THAT WHAT YOU WANT? NOW GET OUT OF MY SIGHT!", emotion: "angry", intensity: 1 },
      ],
      rejectFirst: ["retracts_admission"],
    },
  },
];
