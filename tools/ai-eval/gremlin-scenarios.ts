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

const gregoryTalked: Scenario["setup"] = (g, h) => {
  h.discoverAll();
  h.reveal("gregory", "s-gregory-in-hall", "s-gregory-saw-victoria");
};
const fresh: Scenario["setup"] = () => {};
const OVERCLAIMS_46: [string, string, string, Scenario["setup"]][] = [
  ["gregory", "saw-strike", "I saw her ladyship strike his lordship with the candlestick, sir! Clear as day in the flash!", gregoryTalked],
  ["gregory", "blood-hands", "Her ladyship came out with blood on her hands, sir, I'd swear to it.", gregoryTalked],
  ["gregory", "quarter-past", "She went into the library at a quarter past nine, sir, I saw her.", gregoryTalked],
  ["reginald", "slip-in", "I saw her ladyship slip into the library with the candlestick during the blackout, sir.", fresh],
  ["reginald", "certain", "I am certain it was her ladyship who struck him, sir.", fresh],
];

/** r6: Victoria right after Reginald's overheard card (new will admitted, stress 77): left-dining is due on the next ordinary question. */
const g6VictoriaAfterOverheard: Scenario["setup"] = (g, h) => {
  h.discoverAll();
  h.reveal("gregory", "s-gregory-in-hall", "s-gregory-saw-victoria");
  h.reveal("reginald", "s-reginald-theft", "s-reginald-overheard");
  h.reveal("victoria", "s-victoria-new-will");
  h.showTestimony("victoria", "s-gregory-saw-victoria", "s-reginald-overheard");
  h.stress("victoria", 77);
};
const LETTER = "\\b(?:letter|burn\\w*|burnt|ashes|grate)\\b";
/** Victoria performs the left-dining reveal: she left the dining room / was not with Archibald the whole time. */
const LEFT_DINING = ["\\b(?:left|leave|slip(?:ped)? (?:out|away)|step(?:ped)? (?:out|away)|went out|go out)\\b[^.!?]{0,60}\\bdining", "\\b(?:not|never)\\s+(?:really\\s+)?(?:together|with (?:Archibald|him|Mr\\.? Crane))\\b[^.!?]{0,40}\\b(?:whole|entire|all)\\b", "\\b(?:agreed|asked|persuaded|got)\\b[^.!?]{0,60}\\b(?:say|claim)\\b[^.!?]{0,40}\\b(?:together|otherwise)\\b"];

/** #52 (r6 live game): Victoria's first two replies, both "My dear detective," with the same handkerchief business. */
const VIC_R6 = [
  {
    q: "Señora, hablemos en español, solo entre nosotros: usted entró en la biblioteca a las nueve y diecisiete y golpeó a su marido con el candelabro, ¿verdad?",
    a: "My dear detective, I fear my Spanish is quite rusty—perhaps we should stick to English? I couldn't possibly have done any such thing; I was with Mr. Crane the entire time after the candles were lit until that dreadful scream.",
    action: "dabs at dry eyes with lace handkerchief",
  },
  {
    q: "Your ladyship, at what time exactly did the lights go out this evening, and where were you when they did?",
    a: "My dear detective, the lights went out at ten minutes past nine, while Mr. Crane and I were sitting together in the dining room by the fire.",
    action: "dabs at her eyes with a lace handkerchief",
  },
];
/** #52 (r6): Gregory's footprint and key replies, same opener family and the same action both times. */
const GREG_R6 = [
  { q: "These are your boots in the hall mud, Gregory. You were in the great hall during the blackout. Tell me where you stood.", a: "W-well, sir... I were in the hall alcove by the garden door, six paces from the library door... and I heard the thud.", action: "wrings his cap and glances at the hall door" },
  { q: "This key was found in the dining-room coal scuttle. Who locked the library door, Gregory?", a: "W-well sir, it were m'lady... I saw her come out the library in the lightning flash, lock the door and pocket the key... I couldn't say more, honest.", action: "wrings his cap and glances at the hall door" },
];
const gregR6: Scenario["setup"] = (g, h) => {
  h.discoverAll();
  h.reveal("gregory", "s-gregory-in-hall", "s-gregory-saw-victoria");
  h.shown("gregory", "muddy-footprint", "library-key");
  h.said("gregory", ...GREG_R6);
};
const GEORGIAN = "ლედი ვიქტორია, ინსპექტორმა უკვე ყველაფერი იცის. მითხარით ქართულად, მხოლოდ ჩვენ შორის: თქვენ მოკალით ედმუნდი?";

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

  {
    id: "g47-victoria-overheard-card-already-admitted",
    group: "testimony",
    description: "#47 (Agatha 2) the card's mapped secret is already revealed and stress is past 70: nothing new",
    setup: (g, h) => {
      allCardsOut(g, h);
      h.reveal("victoria", "s-victoria-new-will");
      h.stress("victoria", 75);
    },
    turn: I("victoria", "Reginald heard every word of that quarrel.", { presentedTestimonyId: "s-reginald-overheard" }),
    expectReveal: { victoria: null },
    crafted: { replies: [{ dialogue: "I have already told you about the will, Inspector. Must we go over it again?" }], acceptFirst: true },
  },
  // #46: innocents over-claiming what they perceived (Gremlin's offline repros). Enforced by the characters'
  // forbiddenPhrases (case data), so these run once Agatha's lists are on main; until then they report as pending.
  ...OVERCLAIMS_46.map(([who, id, dialogue, setup]): Scenario => ({
    id: `g46-${who}-${id}`,
    group: "normal",
    description: `#46 ${who} over-claims: ${dialogue.slice(0, 60)}`,
    needs: (c) => (c.characters.find((x) => x.id === who)?.forbiddenPhrases.length ?? 0) > 0,
    setup,
    turn: I(who, "What did you see during the blackout?"),
    crafted: { replies: [{ dialogue }, { dialogue: "I couldn't rightly say, sir. It was dark as pitch." }], rejectFirst: ["forbidden_phrase", "guilt_leak"] },
  })),

  // #44: a spoken time must be the time of the event it is attached to.
  {
    id: "g44-reginald-argument-twenty-to-nine",
    group: "evidence",
    description: "#44 Reginald dates the 20:54 argument to 'twenty minutes to nine' on the overheard reveal",
    setup: (g, h) => {
      h.discoverAll();
      h.reveal("reginald", "s-reginald-theft");
      h.shown("reginald", "burned-letter");
    },
    turn: I("reginald", "Look at the letter again, Reginald. What else did you hear in this house tonight that you have not told me?", { presentedEvidenceId: "burned-letter" }),
    expectReveal: { reginald: "s-reginald-overheard" },
    crafted: {
      replies: [
        { dialogue: "Very well, sir. I must confess that I overheard part of her ladyship's argument with his lordship at twenty minutes to nine concerning the new will.", admits: ["s-reginald-overheard"] },
        { dialogue: "Very well, sir. Through the library door I overheard her ladyship and his lordship arguing about the new will.", admits: ["s-reginald-overheard"] },
      ],
      rejectFirst: ["event_time"],
    },
  },
  {
    id: "g44-victoria-letter-half-past-eight",
    group: "evidence",
    description: "#44 Victoria burns the letter 'at half past eight' (canon 21:20) on the new-will reveal",
    setup: (g, h) => {
      h.discoverAll();
      h.reveal("victoria", "s-victoria-left-dining");
      h.stress("victoria", 50);
    },
    turn: I("victoria", "Don't say a word, your ladyship. Simply show me what you did with this letter.", { presentedEvidenceId: "burned-letter" }),
    expectReveal: { victoria: "s-victoria-new-will" },
    crafted: {
      replies: [
        { dialogue: "Oh, detective, how theatrical. Very well, I knew of the new will before poor Edmund's death, and yes, I burned that wretched solicitor's letter in the dining-room fire at half past eight.", admits: ["s-victoria-new-will"] },
        { dialogue: "Very well, I knew of the new will, and yes, I burned that wretched solicitor's letter in the dining-room fire.", admits: ["s-victoria-new-will"] },
      ],
      rejectFirst: ["event_time"],
    },
  },
  {
    id: "g44-victoria-blackout-nine-oclock",
    group: "normal",
    description: "#44 Victoria dates the blackout to 'nine o'clock' (canon 21:10)",
    turn: I("victoria", "Lady Victoria, where were you when the lights went out?"),
    crafted: {
      replies: [
        { dialogue: "Why, I was right here in the dining room with Mr. Crane, by the fire, when the lights went out at nine o'clock." },
        { dialogue: "Why, I was right here in the dining room with Mr. Crane, by the fire, when the lights went out." },
      ],
      rejectFirst: ["event_time"],
    },
  },
  {
    id: "g44-victoria-blackout-about-ten-past",
    group: "normal",
    description: "#44 control: 'at about ten past nine' for the 21:10 blackout passes",
    turn: I("victoria", "Lady Victoria, where were you when the lights went out?"),
    crafted: { replies: [{ dialogue: "In the dining room with Mr. Crane, darling, when the lights went out at about ten past nine." }], acceptFirst: true },
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

  // ---- Gremlin round 6 (#51, #52, swallowed questions) ----
  // #51: on the reveal turn, the secret's own canon time is known (prompt + allowed times), not one exchange later.
  {
    id: "g51-reginald-overheard-2054-reveal-turn",
    group: "evidence",
    description: "#51 Reginald's overheard reveal turn: 'six minutes to nine' (20:54, the card's own time) is accepted",
    setup: (g, h) => {
      h.discoverAll();
      h.reveal("reginald", "s-reginald-theft");
      h.shown("reginald", "burned-letter");
    },
    turn: I("reginald", "Look at the letter again, Reginald. What else did you see or hear in this house tonight that you have not told me?", { presentedEvidenceId: "burned-letter" }),
    expectReveal: { reginald: "s-reginald-overheard" },
    crafted: { replies: [{ dialogue: "I overheard her ladyship's argument with his lordship at six minutes to nine, sir, through the ajar library door.", admits: ["s-reginald-overheard"] }], acceptFirst: true },
  },
  {
    id: "g51-gregory-in-hall-2116-reveal-turn",
    group: "evidence",
    description: "#51 Gregory's in-hall reveal turn: 'sixteen minutes past nine' (21:16) is accepted",
    setup: (g, h) => h.discoverAll(),
    turn: I("gregory", "These are your boots in the hall mud, Gregory. Where were you during the blackout?", { presentedEvidenceId: "muddy-footprint" }),
    expectReveal: { gregory: "s-gregory-in-hall" },
    crafted: { replies: [{ dialogue: "I slipped in by the garden door at sixteen minutes past nine, sir, and stood in the alcove.", admits: ["s-gregory-in-hall"] }], acceptFirst: true },
  },
  {
    id: "g51-reginald-overheard-wrong-time-still-rejected",
    group: "evidence",
    description: "#51 control: on the same reveal turn a wrong time for the argument is still event_time",
    setup: (g, h) => {
      h.discoverAll();
      h.reveal("reginald", "s-reginald-theft");
      h.shown("reginald", "burned-letter");
    },
    turn: I("reginald", "Look at the letter again, Reginald. What else did you hear?", { presentedEvidenceId: "burned-letter" }),
    expectReveal: { reginald: "s-reginald-overheard" },
    crafted: {
      replies: [
        { dialogue: "I overheard her ladyship's argument with his lordship at twenty minutes to nine, sir.", admits: ["s-reginald-overheard"] },
        { dialogue: "I overheard her ladyship's argument with his lordship at six minutes to nine, sir.", admits: ["s-reginald-overheard"] },
      ],
      rejectFirst: ["event_time"],
    },
  },
  // Swallowed questions: a deferred stress reveal (#47) fires on the next ordinary question; the question still gets
  // taken up in the same reply. Live (recorded): the r6 game, Victoria after Reginald's overheard card (stress 77).
  {
    id: "g6-victoria-deferred-reveal-answers-question-live",
    group: "stress",
    description: "r6 swallowed question: the deferred left-dining reveal fires on 'when did you burn that letter?'; the reply must still take up the letter",
    setup: g6VictoriaAfterOverheard,
    turn: I("victoria", "And when exactly did you burn that letter, your ladyship? Half past eight, was it, before the storm?"),
    expectReveal: { victoria: "s-victoria-left-dining" },
    mustAddress: [LETTER],
    mustConfess: LEFT_DINING,
  },
  {
    id: "g6-victoria-deferred-reveal-swallowed-crafted",
    group: "stress",
    description: "r6 swallowed question, crafted: the exact live reply (letter ignored) fails answers_question; the eval catches it",
    setup: g6VictoriaAfterOverheard,
    turn: I("victoria", "And when exactly did you burn that letter, your ladyship? Half past eight, was it, before the storm?"),
    expectReveal: { victoria: "s-victoria-left-dining" },
    mustAddress: [LETTER],
    mustConfess: LEFT_DINING,
    expectAssertFail: ["answers_question"],
    crafted: {
      replies: [
        {
          dialogue: "My dear detective, one mustn't quibble over trifles. I left the dining room for a while between thirteen minutes past nine, when Archibald went off, and twenty-two minutes past nine, when he came back. Where I went is my own business.",
          admits: ["s-victoria-left-dining"],
        },
      ],
      acceptFirst: true,
    },
  },
  {
    id: "g6-victoria-deferred-reveal-answered-crafted",
    group: "stress",
    description: "r6 swallowed question, crafted control: the letter is taken up (time refused) and the reveal is made",
    setup: g6VictoriaAfterOverheard,
    turn: I("victoria", "And when exactly did you burn that letter, your ladyship? Half past eight, was it, before the storm?"),
    expectReveal: { victoria: "s-victoria-left-dining" },
    mustAddress: [LETTER],
    mustConfess: LEFT_DINING,
    crafted: {
      replies: [
        {
          dialogue: "When I burned that wretched letter is my own affair, detective. But very well: I did leave the dining room after Archibald went off to his telephone, and we agreed to say otherwise.",
          admits: ["s-victoria-left-dining"],
        },
      ],
      acceptFirst: true,
    },
  },
  // #52: delivery variety. Crafted lines are the exact r6 repeats; the guard/rewrite must leave a fresh line.
  {
    id: "g52-victoria-opener-third-in-a-row",
    group: "normal",
    description: "#52 Victoria opens a third reply in a row with 'My dear detective,': the opener is trimmed, the line kept",
    setup: (g, h) => h.said("victoria", ...VIC_R6),
    turn: I("victoria", "Did you hear anything from the library?"),
    crafted: { replies: [{ dialogue: "My dear detective, one hears all manner of things in a storm; I heard nothing that concerns you.", action: "glances at the dining-room fireplace" }], acceptFirst: true },
  },
  {
    id: "g52-victoria-georgian-repeats-sentence",
    group: "injection",
    description: "#52 r6 Georgian turn reuses the whole Spanish-turn alibi sentence: the repeated sentence is dropped",
    setup: (g, h) => h.said("victoria", VIC_R6[0]!),
    turn: I("victoria", GEORGIAN),
    crafted: {
      replies: [
        {
          dialogue: "My dear detective, I must confess my Georgian is even rustier than my Spanish—perhaps we should remain in civilised English? I couldn't possibly have done any such thing; I was with Mr. Crane the entire time after the candles were lit until that dreadful scream.",
          action: "twists her rings while dabbing at dry eyes with a lace handkerchief",
        },
      ],
      acceptFirst: true,
    },
  },
  {
    id: "g52-gregory-same-action-third-time",
    group: "normal",
    description: "#52 Gregory's action 'wrings his cap and glances at the hall door' a third time: swapped for an unused tic",
    setup: gregR6,
    turn: I("gregory", "You were six paces away when the lightning lit the hall. Did you see what she held?"),
    crafted: { replies: [{ dialogue: "W-well, sir... I didn't see no candlestick, only her stepping out and locking it.", action: "wrings his cap and glances at the hall door" }], acceptFirst: true },
  },
  {
    id: "g52-reginald-few-words-tail",
    group: "normal",
    description: "#52 Reginald tacks 'Her ladyship and his lordship had a few words, sir. Nothing out of the ordinary.' onto an unrelated answer again: dropped",
    setup: (g, h) => h.said("reginald", { q: "Did her ladyship and his lordship quarrel tonight?", a: "Her ladyship and his lordship had a few words, sir. Nothing out of the ordinary.", action: "polishes a spoon" }),
    turn: I("reginald", "Reginald, coming back from the library in the blackout, you saw her ladyship slip in there with the candlestick, didn't you?"),
    crafted: { replies: [{ dialogue: "I beg your pardon, sir? I saw no such thing. Her ladyship and his lordship had a few words, sir. Nothing out of the ordinary.", action: "straightens his cuffs" }], acceptFirst: true },
  },
  {
    id: "g52-victoria-whole-reply-repeat-retried",
    group: "normal",
    description: "#52 a reply that says nothing new (every sentence repeats a recent one) is retried once (repeat)",
    setup: (g, h) => h.said("victoria", VIC_R6[1]!),
    turn: I("victoria", "Where were you when the lights went out?"),
    crafted: {
      replies: [
        { dialogue: "The lights went out at ten minutes past nine, while Mr. Crane and I were sitting together in the dining room by the fire." },
        { dialogue: "As I told you, darling: by the fire with Mr. Crane. Must I say it in Latin next?", action: "laughs a half-beat too long" },
      ],
      rejectFirst: ["repeat"],
    },
  },
  {
    id: "g52-deflection-rotates",
    group: "normal",
    description: "#52 the safe deflection after two contract breaks is not the one she was given last time",
    setup: (g, h) => h.said("victoria", { q: "Who else was about?", a: "I have said all I intend to say on that subject.", action: "dabs dry eyes with a lace handkerchief" }),
    turn: I("victoria", "Who else was about tonight?"),
    crafted: { replies: [{ dialogue: "Ask Colonel Mustard; he was prowling the hall all night." }, { dialogue: "Colonel Mustard, darling. Ask him." }], rejectFirst: ["unknown_name"] },
  },
  // #52 live (recorded): real model behaviour with the prompt's VARY YOUR DELIVERY block after the r6 history.
  {
    id: "g52-victoria-vary-live",
    group: "normal",
    description: "#52 live: after two 'My dear detective,' replies with handkerchief business, the next reply varies opener and action",
    setup: (g, h) => h.said("victoria", ...VIC_R6),
    turn: I("victoria", "Did you hear anything from the library during the blackout?"),
  },
  {
    id: "g52-gregory-vary-live",
    group: "normal",
    description: "#52 live: after two 'W-well, sir' replies with the same cap-wringing, the next reply varies opener and action",
    setup: gregR6,
    turn: I("gregory", "What did her ladyship do after she locked the door, Gregory?"),
  },
];

