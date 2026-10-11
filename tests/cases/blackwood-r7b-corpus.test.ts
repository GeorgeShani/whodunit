/**
 * Gremlin's r7b offline corpus (/workspace/qa/r7b/harness/probe5-7.test.ts, outputs in /workspace/qa/r7b/out/) as a
 * regression test, through the REAL guard (prepareTurn + checkReply), each line in its reveal state.
 *  - ALLOW: every true-canon, small-talk and innocuous line must pass (a false block of canon is a regression).
 *  - BLOCK: every attack line must be blocked, except the KNOWN_GAPS below, each left on purpose with a reason
 *    (most are the long paraphrase tail that Dexter's generic third-person culprit check, E8, is for).
 * Audit: cases/blackwood/docs/CONSISTENCY_AUDIT.md, r7b entries (CA-41 onward).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply } from "@/ai/guard";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";

type Spec = { ev?: string[]; rev?: [string, string][]; shown?: Record<string, string[]>; heard?: Record<string, string[]>; stress?: Record<string, number>; told?: Record<string, string[]> };
const ALL_EV = ["silver-candlestick", "library-key", "burned-letter", "muddy-footprint"];
const S: Record<string, Spec> = {
  fresh: {},
  regTheft: { ev: ALL_EV, rev: [["reginald", "s-reginald-theft"]], shown: { reginald: ["burned-letter"] } },
  regBoth: { ev: ALL_EV, rev: [["reginald", "s-reginald-theft"], ["reginald", "s-reginald-overheard"]], shown: { reginald: ["burned-letter"] } },
  archFA: { ev: ["silver-candlestick", "library-key"], rev: [["archibald", "s-archibald-false-alibi"]], shown: { archibald: ["library-key"] } },
  archBoth: { ev: ["silver-candlestick", "library-key"], rev: [["archibald", "s-archibald-false-alibi"], ["archibald", "s-archibald-embezzlement"]], shown: { archibald: ["library-key"] } },
  gregHall: { ev: ["silver-candlestick", "muddy-footprint"], rev: [["gregory", "s-gregory-in-hall"]], shown: { gregory: ["muddy-footprint"] } },
  gregSaw: { ev: ["silver-candlestick", "muddy-footprint", "library-key"], rev: [["gregory", "s-gregory-in-hall"], ["gregory", "s-gregory-saw-victoria"]], shown: { gregory: ["muddy-footprint", "library-key"] } },
  // r7c (Gremlin's probe8-10)
  vNewwill: { ev: ["silver-candlestick", "library-key", "burned-letter"], rev: [["victoria", "s-victoria-new-will"]], shown: { victoria: ["burned-letter"] } },
  vLeft: { ev: ["silver-candlestick", "library-key", "burned-letter"], rev: [["victoria", "s-victoria-new-will"], ["victoria", "s-victoria-left-dining"]], shown: { victoria: ["burned-letter", "library-key"] } },
  gregSawNotShown: { ev: ALL_EV, rev: [["gregory", "s-gregory-in-hall"], ["gregory", "s-gregory-saw-victoria"]] },
  gregSawShown: { ev: ALL_EV, rev: [["gregory", "s-gregory-in-hall"], ["gregory", "s-gregory-saw-victoria"]], heard: { reginald: ["s-gregory-saw-victoria"], archibald: ["s-gregory-saw-victoria"] } },
  zeroTheft: { rev: [["victoria", "s-victoria-left-dining"], ["archibald", "s-archibald-false-alibi"], ["reginald", "s-reginald-theft"]], heard: { reginald: ["s-archibald-false-alibi"], archibald: ["s-victoria-left-dining"] } },
  zeroTheftVic: { rev: [["victoria", "s-victoria-left-dining"], ["archibald", "s-archibald-false-alibi"], ["reginald", "s-reginald-theft"]], heard: { reginald: ["s-archibald-false-alibi", "s-victoria-left-dining"], archibald: ["s-victoria-left-dining"] } },
  allInnoc: { ev: ALL_EV, rev: [["reginald", "s-reginald-theft"], ["reginald", "s-reginald-overheard"], ["archibald", "s-archibald-false-alibi"], ["archibald", "s-archibald-embezzlement"], ["gregory", "s-gregory-in-hall"], ["gregory", "s-gregory-saw-victoria"]], shown: { reginald: ["burned-letter"], archibald: ["library-key"], gregory: ["muddy-footprint", "library-key"] } },
};

export type R7bResult = { tag: string; st: string; ch: string; d: string; want: "block" | "pass"; got: "block" | "pass"; why: string };
const results: R7bResult[] = [];
let c: LoadedCase;

beforeAll(async () => {
  c = await loadCase("blackwood");
  const mk = (s: Spec) => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push(...(s.ev ?? []));
    for (const [o, id] of s.rev ?? []) { g.revealedSecretIds.push(id); g.characters[o].revealedSecretIds.push(id); }
    for (const [o, v] of Object.entries(s.shown ?? {})) g.characters[o].evidenceShownIds.push(...v);
    for (const [o, v] of Object.entries(s.heard ?? {})) g.characters[o].testimonyShownIds.push(...v);
    for (const [o, v] of Object.entries(s.stress ?? {})) g.characters[o].stress = v;
    for (const [o, v] of Object.entries(s.told ?? {})) g.characters[o].liesToldIds.push(...v);
    for (const ch of Object.keys(g.characters)) g.characters[ch].interrogationCount = Math.max(g.characters[ch].interrogationCount, 2);
    return g;
  };
  const run = (tag: string, st: string, ch: string, d: string, want: "block" | "pass", q = "What do you make of it?", move: Record<string, unknown> = {}) => {
    const p = prepareTurn({ caseData: c, game: mk(S[st]), characterId: ch, question: q, move: { allowReveal: false, ...move } as never });
    const v = checkReply({ dialogue: d, admits: p.plan.revealSecretId ? [p.plan.revealSecretId] : [] }, p.guard);
    results.push({ tag, st, ch, d, want, got: v ? "block" : "pass", why: v ? `${v.reason} ${(v.detail ?? "").slice(0, 60)}` : "" });
  };
  const INN = ["reginald", "archibald", "gregory"];
  // 1. H1 new paraphrases: innocents naming Victoria the killer (fresh; want block)
  const h1 = [
    "She's done him in, sir, and that's the truth of it.",
    "'Twas her that did it, sir.",
    "'Twas her ladyship that done it.",
    "It was her ladyship that killed him.",
    "It were the missus what done it, sir.",
    "The mistress dispatched him, I'm certain.",
    "Her ladyship finished him off, sir.",
    "She did for him, sir, mark my words.",
    "Lady Blackwood killed her husband, sir.",
    "Lady Blackwood did him in.",
    "The missus done for him, sir.",
    "If you ask me, her ladyship laid him low.",
    "I'd wager her ladyship clobbered him with the candlestick.",
    "Mark my words, the widow did it.",
    "His lordship was killed by her ladyship, sir.",
    "His lordship was struck down by Lady Victoria.",
    "He was done in by his own wife, sir.",
    "Her ladyship took the candlestick to him.",
    "She cracked his skull with that candlestick, sir.",
    "Victoria murdered him, plain as day!",
    "The lady of the house is your murderess, detective.",
    "Her ladyship's the guilty party, sir.",
    "Her ladyship had a hand in his death, I'd stake my life on it.",
    "She walloped him with the silver, sir.",
    "Her ladyship put an end to him.",
    "Her ladyship saw him off, sir.",
    "Lady V. did it, by George!",
    "Victoria? Killed him, the minx! Bashed him with the candlestick!",
    "Your culprit is her ladyship, old boy, mark my words.",
    "I reckon 'er ladyship done 'im in, sir.",
    "'Er ladyship brained 'im, sir.",
    "Begging your pardon, sir, but I fear her ladyship may be responsible for his lordship's death.",
    "Her ladyship is responsible for his lordship's death.",
    "Her Ladyship killed him.",
    "HER LADYSHIP KILLED HIM!",
    "She killed Edmund. There, I've said it!",
    "She felled him like an oak, sir.",
    "Her ladyship's hand was on that candlestick, sir.",
    "It was the mistress swung the candlestick, sir.",
  ];
  for (const ch of INN) for (const d of h1) run("H1", "fresh", ch, d, "block");

  // 1b. H1 after all innocent secrets are out (want block, nobody saw the blow)
  for (const ch of INN) for (const d of ["She's done him in, sir, and that's the truth of it.", "'Twas her that did it, sir.", "The mistress dispatched him, I'm certain.", "Lady Blackwood killed her husband, sir.", "His lordship was killed by her ladyship, sir.", "It were the missus what done it, sir.", "I reckon 'er ladyship done 'im in, sir.", "Her ladyship is responsible for his lordship's death."]) run("H1b", "allInnoc", ch, d, "block");

  // 1c. H1 Gregory's eyewitness content leaked BEFORE his reveal (fresh/in-hall; want block)
  const gsee = [
    "Somebody come out of that library, sir, and it weren't no man.",
    "I seen 'er come out the library, sir.",
    "I seen her ladyship lock that door, sir.",
    "I saw the mistress lock the library door.",
    "Her ladyship locked the library door from outside, sir.",
    "The missus come out o' the library and turned the key.",
    "I seen a lady at the library door in the lightning, sir.",
    "Lady Blackwood came out of the library and pocketed the key.",
    "It were 'er ladyship at the library door, sir. I seen 'er face.",
    "The door was locked by her ladyship, sir.",
    "She put the key down her front, sir.",
    "I saw who locked it, sir. A lady, in a long gown.",
  ];
  for (const st of ["fresh", "gregHall"]) for (const d of gsee) run("H1c", st, "gregory", d, "block");
  for (const ch of ["reginald", "archibald"]) for (const d of gsee) run("H1c", "allInnoc", ch, d, "block");

  // 1d. M1: Archibald exposed-but-locked via EVIDENCE (burned-letter shown, key not shown)
  {
    const st: Spec = { ev: ["silver-candlestick", "library-key", "burned-letter"], shown: { archibald: ["burned-letter"] }, told: { archibald: ["l-archibald-together"] } };
    S.archBL = st;
    for (const d of ["I stepped into the hall for some air, nothing more.", "I went to look for the brandy in the pantry, old boy.", "I went to the gentlemen's cloakroom, if you must know!", "I popped out to the motor car for my cigar case.", "I went up to bed for ten minutes with a headache.", "I was in the study, reading.", "I went out to the garden for a smoke.", "I was in the library annex.", "Upstairs, fetching my coat!"]) run("M1e", "archBL", "archibald", d, "block", "Where were you?", { presentedEvidenceId: "burned-letter" });
  }

  // 1e. M1 attack: Archibald improvised alibi paraphrases in exposed state (Victoria's card), reveal turn
  S.archVL = { rev: [["victoria", "s-victoria-left-dining"]], heard: {}, told: { archibald: ["l-archibald-together"] } };
  for (const d of [
    "I went to find the brandy in the pantry, but the decanter was empty.",
    "I stepped into the hall for a breath of air.",
    "I went to the gentlemen's cloakroom, if you must know!",
    "I nipped out to the motor car for my cigar case.",
    "I went up to bed for ten minutes with a headache.",
    "I was in the study, reading, dash it.",
    "I went out into the garden for a smoke.",
    "I sat on the stairs in the dark, old boy.",
    "I was in the kitchen raiding the larder.",
    "I was looking for Edmund to make peace.",
    "I went to the library door and knocked, but he wouldn't answer.",
  ]) run("M1x", "archVL", "archibald", d, "block", "Lady Victoria admits she left. Where were you?", { allowReveal: true, presentedTestimonyId: "s-victoria-left-dining" });

  // 1f. M2 handkerchief: new FPs (want pass) and bypasses (want block); Archibald speaking, fresh
  for (const d of ["Victoria waved a scarlet silk handkerchief at the butler.", "Her ladyship's crimson handkerchief matched her gown.", "She dabbed her eyes with a handkerchief red with embroidery.", "Her handkerchief was soaked through with tears.", "Her ladyship's handkerchief came away wet with tears.", "She has a dozen lace handkerchiefs, all monogrammed.", "Her handkerchief was red from all that weeping, poor dear."]) run("M2fp", "fresh", "archibald", d, "pass");
  for (const d of ["Her handkerchief was rust-brown in one corner.", "There were brownish marks on her handkerchief.", "Her lace handkerchief was smudged with something red.", "I saw gore on her hankie.", "Her hankie was a sight, sir, all reddened.", "She'd a handkerchief, sir, and it was spattered.", "She wiped the base of that candlestick, sir.", "She cleaned the candlestick with her lace.", "Her handkerchief was stained, and not with tears.", "On her handkerchief: blood. I'm sure of it."]) run("M2by", "fresh", "archibald", d, "block");

  // 1g. M4 Victoria: when she burned the letter (after new-will reveal; want block)
  S.vicNW = { ev: ALL_EV, rev: [["victoria", "s-victoria-new-will"]], shown: { victoria: ["burned-letter"] } };
  for (const d of ["I burned it while I was alone, detective.", "I burned it in the dark, darling.", "I burned it by candlelight.", "I burned it just before Archibald came back.", "I burned it once the candles were lit.", "I burned it before Reginald screamed.", "I burnt the letter during the storm, when no one was looking.", "I burned it in the minutes before the scream.", "I put the letter on the fire while the lights were out.", "I burned that letter after Edmund and I spoke the second time.", "I fed it to the dining-room fire at twenty minutes past nine.", "The letter went into the fire a little after nine-fifteen.", "I burned it around nine twenty.", "I burned it when I came back from seeing Edmund."]) run("M4", "vicNW", "victoria", d, "block", "When did you burn it?");

  // 1h. M6 paraphrases (fresh; want block)
  for (const [ch, d] of [
    ["reginald", "There are two keys to the library, sir; I keep the other."],
    ["reginald", "I have a key to every door on my ring, sir."],
    ["archibald", "Edmund kept a duplicate in his desk, I'm sure of it."],
    ["gregory", "My boots left mud from one end of the hall to the other, sir."],
    ["gregory", "I muddied the library carpet, sir, I'm sorry to say."],
    ["gregory", "I went right up to the library door, sir, boots and all."],
    ["reginald", "I brought up the coals from beside the dining-room fire, sir."],
    ["reginald", "I emptied the dining-room scuttle at half past nine, sir."],
    ["victoria", "The wires are down in the storm, darling."],
    ["archibald", "Can't get a line out, old boy, the exchange won't answer."],
    ["gregory", "The constable's coming by boat tonight, sir."],
    ["reginald", "The police will arrive within the hour, sir."],
    ["reginald", "Cook had gone to bed, sir."],
    ["reginald", "The girl who does the fires was abed, sir."],
    ["gregory", "Me and the under-gardener, sir, we was in the shed."],
    ["archibald", "The chauffeur drove me down, old boy."],
    ["reginald", "Only Mrs Hughes, sir, and she was asleep."],
    ["gregory", "I went round by the greenhouse, sir."],
    ["archibald", "I was in the gun room, damn it."],
    ["archibald", "I was in the smoking-room with a cigar."],
    ["reginald", "I was in the still-room, sir."],
    ["gregory", "I were in the stables, sir."],
    ["reginald", "Her ladyship's gown smelled of smoke when I lit the candles, sir."],
    ["archibald", "When I came back the fire was roaring as if she'd fed it paper."],
    ["archibald", "Victoria? Well, she wasn't by the fire every minute, I'll grant you."],
    ["reginald", "She must have taken the letter off his desk, sir, there's no one else."],
  ] as [string, string][]) run("M6", "fresh", ch, d, "block");

  // 1i. L2/L3 paraphrases
  for (const d of ["I telephoned the police at a quarter to ten, sir.", "I rang the police at half past nine, sir.", "I rang the constable at ten o'clock, sir.", "I rang the police at about twenty to ten, sir.", "I telephoned the police at nine o'clock, sir."]) run("L2wrong", "fresh", "reginald", d, "block", "When did you call the police?");
  for (const d of ["Reginald telephoned the police at a quarter to ten, darling."]) run("L2wrong", "fresh", "victoria", d, "block");
  for (const d of ["Reginald rang the police at a quarter to ten, old boy."]) run("L2wrong", "fresh", "archibald", d, "block");
  for (const d of ["I never laid eyes on her ladyship all evening, sir.", "I didn't see the mistress once tonight, sir.", "I saw nothing of her ladyship this evening, sir.", "Her ladyship? I never saw her the whole night, sir.", "I have not set eyes upon her ladyship since dinner, sir.", "I didn't see her ladyship at all, sir, not once."]) run("L3", "fresh", "reginald", d, "block");

  // 2. OVER-BLOCKING corpus: TRUE canon lines (want pass)
  const T = (st: string, ch: string, d: string, q = "Tell me about this evening.") => run("TRUE", st, ch, d, "pass", q);
  // Reginald 20:54 (locked until overheard), 20:57, 20:58 coffee, 21:11, 21:12, 21:13, 21:30, 21:38
  for (const st of ["fresh", "regBoth"]) {
    T(st, "reginald", "At three minutes to nine her ladyship came out of the library, flushed, and swept past me in the hall without a word, sir.");
    T(st, "reginald", "Her ladyship came out of the library at three minutes to nine, sir, looking flushed.");
    T(st, "reginald", "Her ladyship swept past me in the hall just before nine, sir. She did not say a word.");
    T(st, "reginald", "I served his lordship his coffee at two minutes to nine, sir. He was alive and reading a letter.");
    T(st, "reginald", "I took his lordship his coffee at 20:58, sir, and he locked the door after me.");
    T(st, "reginald", "At eleven minutes past nine, sir, a minute after the lights failed, I lit the pair of candlesticks on the dining table.");
    T(st, "reginald", "I lit the candles in the dining room at eleven minutes past nine, sir. Her ladyship and Mr Crane were at the table.");
    T(st, "reginald", "Her ladyship was in the dining room when I lit the candles, sir.");
    T(st, "reginald", "When the lights went out her ladyship was in the dining room, sir, with Mr Crane.");
    T(st, "reginald", "I carried one candlestick to the library for his lordship, sir, at twelve minutes past nine.");
    T(st, "reginald", "His lordship unlocked the door for me, sir, and I set the candlestick on his desk.");
    T(st, "reginald", "I heard the key turn in the library lock behind me at thirteen minutes past nine, sir.");
    T(st, "reginald", "I brought the coal at half past nine, sir, and found the library door locked and the keyhole empty.");
    T(st, "reginald", "Through the keyhole I saw his lordship's hand on the floor, sir, and I screamed.");
    T(st, "reginald", "I telephoned the police at twenty-two minutes to ten, sir, but the road is flooded.");
    T(st, "reginald", "I rang the police from the servants' telephone at 21:38, sir. Nobody can come before morning.");
    T(st, "reginald", "Her ladyship was at the library door with us when Mr Crane forced it, sir.");
    T(st, "reginald", "Her ladyship screamed and swooned when we found his lordship, sir.");
    T(st, "reginald", "The candlestick on the desk is one of the pair from the dining table, sir.");
    T(st, "reginald", "There is only the one key to the library, sir, and his lordship kept it.");
    T(st, "reginald", "I did not see her ladyship between a quarter past nine and half past, sir; I was below stairs.");
    T(st, "reginald", "Her ladyship is in the hall with the others now, sir, waiting for morning.");
  }
  for (const st of ["regBoth"]) {
    T(st, "reginald", "At six minutes to nine, sir, carrying the coffee, I saw through the open library door her ladyship gripping his lordship's sleeve.");
    T(st, "reginald", "I heard her ladyship cry 'You wouldn't dare, Edmund!', sir, and his lordship spoke of the new will at ten tomorrow.");
    T(st, "reginald", "Her ladyship and his lordship argued in the library about the new will, sir. I heard it through the door.");
    T(st, "reginald", "I saw her ladyship at the library door at six minutes to nine, sir, arguing with his lordship.");
    T(st, "reginald", "I heard Mr Crane on the servants' telephone, sir, talking about moving it all before midnight.");
    T(st, "reginald", "I was counting the money in my pantry during the blackout, sir. I am ashamed of it.");
    T(st, "reginald", "I called through the pantry door who was on the telephone, sir, and Mr Crane told me to mind my own business.");
  }
  // Gregory revealed sighting
  for (const d of [
    "At nineteen minutes past nine, in a flash of lightning, I saw her ladyship come out of the library, sir.",
    "I seen her ladyship step out of the library, lock the door and slip the key into her gown, sir.",
    "Her ladyship come out o' the library, sir, locked it behind her and put the key down her dress.",
    "In the lightning I saw Lady Victoria's face, sir. She came out of the library and turned the key.",
    "I saw her ladyship lock the library door from outside and pocket the key, sir.",
    "Her ladyship locked the door and walked off towards the dining room, sir.",
    "It were her ladyship, sir. I seen her face plain as day in the flash.",
    "I heard a thud from the library at seventeen minutes past nine, sir, and then the light under the door went dim.",
    "I was in the alcove by the garden door, sir, six paces from the library.",
    "I seen her ladyship come out the library, sir, and I legged it back to the shed.",
    "She slipped the key into her gown, sir, I'd swear to it.",
    "I saw her ladyship slip something into her gown by the library door.",
    "Her ladyship came away from the library door, sir, and went towards the dining room.",
    "I saw her come out of the library at 21:19, sir.",
  ]) run("TRUE", "gregSaw", "gregory", d, "pass", "What did you see?");
  for (const d of [
    "I heard a thud from the library at seventeen minutes past nine, sir.",
    "I was dripping in the alcove by the garden door, sir, in the dark.",
    "I come in out of the rain when me lantern blew out, sir.",
  ]) run("TRUE", "gregHall", "gregory", d, "pass", "Where were you?");
  // Archibald
  for (const st of ["archFA", "archBoth"]) for (const d of [
    "I left the dining room at thirteen minutes past nine, two minutes after the candles were lit.",
    "I was on the servants' telephone from a quarter past nine until twenty past, old boy.",
    "I came back to the dining room at twenty-two minutes past nine. Nine minutes, that's all.",
    "Victoria asked me at twenty to ten to say we'd been together, and I agreed. Foolish of me.",
    "At the telephone I saw candlelight under the pantry door and heard coins clinking.",
    "Reginald called through the pantry door, 'Who's on that telephone?', and I told him to mind his own business!",
    "I told Victoria I was going to find the brandy, and I didn't come back with any.",
    "When I came back Victoria was by the fire.",
  ]) run("TRUE", st, "archibald", d, "pass", "Where were you?");
  for (const d of ["I rang my broker to move the company money before midnight. There! Satisfied?", "The row at dinner was about the money, not a racehorse. Edmund knew."]) run("TRUE", "archBoth", "archibald", d, "pass", "Who did you call?");
  for (const st of ["fresh", "archBoth"]) for (const d of [
    "When Reginald screamed I shouldered the library door open at twenty-nine minutes to ten.",
    "Victoria was by the fire with me when we heard the scream.",
    "Victoria excused herself from dinner soon after Edmund went to the library.",
    "Reginald lit the candles at eleven minutes past nine and carried one off to Edmund.",
    "Victoria screamed and swooned when we found him.",
    "The candlestick was on the desk, old boy, right there beside him.",
  ]) run("TRUE", st, "archibald", d, "pass", "What happened?");
  // Small talk mentioning her ladyship near trigger words
  const small: [string, string][] = [
    ["reginald", "Her ladyship prefers the library in the mornings, sir, for the light."],
    ["reginald", "Her ladyship chose the silver candlesticks herself, sir, as a wedding gift."],
    ["reginald", "Her ladyship dislikes the dark, sir, she always has."],
    ["reginald", "Her ladyship asked me to see to the door, sir."],
    ["reginald", "Her ladyship is in the hall, sir, by the door."],
    ["reginald", "His lordship always kept the library key in the lock, sir, on the inside."],
    ["reginald", "Her ladyship did not go into the dark garden, sir."],
    ["gregory", "Her ladyship never liked me, sir, not since the roses."],
    ["gregory", "The mistress don't hold with mud in the house, sir."],
    ["gregory", "Her ladyship sacked me this morning? No, sir, it were his lordship."],
    ["gregory", "It were dark as pitch, sir, I couldn't see me hand."],
    ["archibald", "Victoria hates a dark house, old boy. Always lighting candles."],
    ["archibald", "Victoria and I sat by the fire when the candles were lit, I'll say that much."],
    ["archibald", "Victoria said she'd never set foot in that library again after the row."],
    ["archibald", "The library door was locked, so I put my shoulder to it."],
    ["archibald", "Victoria? Charming woman. Wouldn't hurt a fly, I'd have said."],
    ["reginald", "I don't believe her ladyship killed him, sir."],
    ["archibald", "Nobody saw Victoria strike him, old boy, nobody at all."],
    ["gregory", "I never said she done it, sir!"],
    ["reginald", "Did her ladyship kill him, sir? I cannot believe it."],
  ];
  for (const [ch, d] of small) run("SMALL", "fresh", ch, d, "pass");
  for (const [ch, d] of small) run("SMALL", "allInnoc", ch, d, "pass");


  // r7b: the two retraction false blocks were fixed by sharing words with the secret text; the lies themselves,
  // restated after the reveal, must still be caught.
  for (const d of ["I was with Victoria by the dining-room fire from the moment the candles were lit until the scream. Ask her!", "The row at dinner? A racehorse, old boy. Purely sporting."])
    run("RETRACT", "archBoth", "archibald", d, "block", "Where were you?");
  // probe6: Victoria placing herself with Edmund in the murder window (want block in every state)
  const runV = (lab: string, setup: (g: ReturnType<typeof createInitialGameState>) => void, d: string) => {
    const g = createInitialGameState(c);
    setup(g);
    const p = prepareTurn({ caseData: c, game: g, characterId: "victoria", question: "Tell me the truth.", move: { allowReveal: false } as never });
    const v = checkReply({ dialogue: d, admits: [] }, p.guard);
    results.push({ tag: "N1", st: lab, ch: "victoria", d, want: "block", got: v ? "block" : "pass", why: v ? `${v.reason} ${(v.detail ?? "").slice(0, 60)}` : "" });
  };
  const nw = (g: ReturnType<typeof createInitialGameState>) => { g.discoveredEvidenceIds.push("burned-letter", "library-key", "silver-candlestick"); g.revealedSecretIds.push("s-victoria-new-will"); g.characters.victoria.revealedSecretIds.push("s-victoria-new-will"); g.characters.victoria.evidenceShownIds.push("burned-letter"); };
  const ld = (g: ReturnType<typeof createInitialGameState>) => { nw(g); g.revealedSecretIds.push("s-victoria-left-dining"); g.characters.victoria.revealedSecretIds.push("s-victoria-left-dining"); };
  for (const [lab, s] of [["fresh", () => {}], ["newwill", nw], ["newwill+left", ld]] as const) for (const d of [
    "I burned that letter after Edmund and I spoke the second time.",
    "Edmund and I spoke a second time that evening, darling. Briefly.",
    "I went back to Edmund once the candles were lit. To reason with him.",
    "I did pop in on Edmund again, after the lights failed.",
    "I saw Edmund again later, in the dark. He was perfectly beastly.",
    "While Archibald was off hunting brandy, I went to have another word with Edmund.",
    "I burned the letter once the candles were lit.",
    "I left the dining room to see my husband, if you must know.",
    "I had the letter in my hand before Archibald came back.",
    "When I left the dining room I went to the hall, darling, that's all.",
    "I stepped into the hall during the blackout, for some air.",
    "I was in the hall when the lightning flashed, darling.",
  ]) runV(lab, s, d);


  // probe7: true or innocuous lines the M6 / H1 / L3 rules must not block (fresh)
  const p7: [string, string][] = [
    ["reginald", "The lightning struck the power line, sir, and the lights went out at ten minutes past nine."],
    ["reginald", "The power line was down until twenty-two minutes to ten, sir."],
    ["archibald", "The power line's down, old boy, that's why we're sitting in the dark."],
    ["victoria", "The electric line is down, darling. Hence the candles."],
    ["gregory", "Lightning took the power line down, sir, and the house went black."],
    ["reginald", "The telephone works perfectly well, sir; the electric light is what failed."],
    ["victoria", "I shan't play parlour games with you, detective."],
    ["archibald", "No parlour tricks, old boy. Ask me straight."],
    ["archibald", "Victoria is a remarkably stable sort of woman, I'd have said."],
    ["reginald", "I would make a very poor cook, sir. I am a butler."],
    ["archibald", "Edmund said I'd cooked the books. Slander!"],
    ["victoria", "One doesn't keep a lady's maid in the country, darling, not with Edmund's purse strings."],
    ["reginald", "His lordship let the cook go last spring, sir. I see to the kitchen now."],
    ["gregory", "I left a muddy print just inside the garden door, sir, on the hall floor."],
    ["gregory", "I was dripping mud on the hall floor by the garden door, sir."],
    ["reginald", "I carried a fresh scuttle of coal up from the kitchen at half past nine, sir."],
    ["reginald", "I brought the coal scuttle past the dining room on my way to the library, sir."],
    ["reginald", "I have a spare candle, sir, if you need one."],
    ["victoria", "Edmund kept the only key in the lock, always. There is no other."],
    ["reginald", "There is only the one key, sir. No spare, never has been."],
    ["gregory", "I didn't see her ladyship at all tonight, sir, not till the shouting."],
    ["reginald", "I did not see her ladyship at all after the candles, sir, until the scream."],
    ["reginald", "I did not see her ladyship at all this evening after twenty past nine, sir, until the door was forced."],
    ["archibald", "I never saw Victoria strike anyone in my life."],
    ["gregory", "Did her ladyship kill him, sir? Lord help us."],
    ["gregory", "Folk say she done for him, sir, but I couldn't say."],
    ["reginald", "Her ladyship took the candlestick from me at dinner to admire it, sir."],
    ["archibald", "Victoria went in to Edmund before nine, old boy, to talk about money."],
    ["reginald", "Her ladyship went in to his lordship at a quarter to nine, sir."],
    ["archibald", "Victoria was with Edmund in the library before nine. Everyone knew they quarrelled."],
    ["gregory", "When the lights went out I was in the garden, sir, and she wasn't nowhere I could see."],
  ];
  for (const [ch, d] of p7) {
    run("P7", "fresh", ch, d, "pass", "Go on.");
  }

  // ===== r7c: Gremlin's probe8-10 (/workspace/qa/r7c/harness), each line in his state =====
  const V3 = ["fresh", "vNewwill", "vLeft"];
  // A1 (R1): Victoria anchored on Archibald's errand and other relative markers (want block in every state)
  for (const st of V3) for (const d of [
    "When the storm was at its worst I went to see Edmund.",
    "While Reginald was fetching candles I slipped out to see Edmund.",
    "After Archibald left me, I went to the library.",
    "After Archibald left me I had a word with Edmund.",
    "During the blackout I spoke with Edmund, briefly.",
    "Before the scream I was with my husband, darling.",
    "In those few minutes I went to Edmund.",
    "While the house was dark I went along to the library.",
    "Once Archibald had gone off for his brandy, I went to my husband.",
    "With the candles lit and Archibald gone, I paid Edmund a visit.",
    "I took the letter from his desk while the house was dark.",
    "I burned it after Archibald left me.",
    "I burned it in those few minutes on my own.",
    "I burned the letter before Reginald found him.",
    "I burned the letter after the lights went.",
    "Edmund was alive when I left him the second time.",
    "I last saw Edmund alive a little after the lights failed.",
    "When I saw Edmund last, the candle Reginald brought was burning on his desk.",
    "I knocked and Edmund unlocked the door for me himself, by candlelight.",
    "Edmund let me in, darling, while Archibald was hunting for brandy.",
    "I was in the hall when the lightning came, darling, near the library.",
    "I came back to the fire just before Archibald did.",
    "I came back to the dining room a minute or two before Archibald.",
    "I was alone with Edmund for a few minutes after the candles were lit.",
    "Between the candles and the scream I saw Edmund once.",
    "The candle on Edmund's desk was still burning when I left him.",
  ]) run("R1", st, "victoria", d, "block", "Tell me the truth.");
  // A2: Victoria's true lines (want pass)
  for (const [st, d] of [
    ["fresh", "I excused myself from dinner soon after Edmund went to the library."],
    ["fresh", "Edmund and I had a little chat in the library before nine. The Sunday menu."],
    ["fresh", "When the lights went out at ten past nine I was by the dining-room fire with Archibald."],
    ["fresh", "Reginald lit the candles at eleven minutes past nine, darling. I was at the table."],
    ["fresh", "Archibald and I sat by the fire from the moment the candles were lit until we heard the scream. Neither of us left."],
    ["fresh", "After the scream I ran to the library door with Archibald."],
    ["fresh", "When Reginald screamed, Archibald and I hurried into the hall."],
    ["fresh", "I was at the library door when Archibald forced it at twenty-nine minutes to ten."],
    ["fresh", "I went into the library with the others after the door was forced, and there was Edmund."],
    ["fresh", "I fainted clean away when I saw Edmund on the floor."],
    ["fresh", "The lights came back at twenty-two minutes to ten, thank heaven."],
    ["fresh", "Reginald telephoned the police at twenty-two minutes to ten. They can't come till morning."],
    ["fresh", "Edmund must have locked himself in. He always did."],
    ["fresh", "I loathe the dark, darling. Candlelight is so unflattering."],
    ["fresh", "The storm has been dreadful all evening."],
    ["fresh", "Archibald came back to the fire at twenty-two minutes past nine without any brandy."],
    ["vNewwill", "Yes, I knew about the new will. And yes, I burned that wretched letter. There."],
    ["vNewwill", "I knew Edmund meant to sign a new will at ten tomorrow. I'm not a fool."],
    ["vLeft", "Very well. I left the dining room while Archibald was away. Where I went is my own affair."],
    ["vLeft", "I wasn't by the fire the whole time, darling. I stepped out for a little while."],
    ["vLeft", "Archibald and I were not together all that time. He went off at thirteen minutes past and came back at twenty-two minutes past."],
    ["vLeft", "At twenty to ten I asked Archibald to say we'd been together. A small kindness."],
    ["vLeft", "I left the room for a few minutes after Archibald went off, that's all."],
    ["vLeft", "I was not in the dining room every minute between thirteen and twenty-two minutes past nine."],
    ["vLeft", "I left the dining room for a while after the candles were lit. I shan't say where."],
    ["vLeft", "When Archibald went for his brandy, I went out too. That is all you'll get."],
    ["vLeft", "I was alone for a few minutes, so I stepped out. Hardly a crime."],
  ] as const) run("R1T", st, "victoria", d, "pass", "Where were you?");
  // R4 (probe9 P9a): conceding left-dining while it is locked (fresh; want block)
  for (const d of ["I stepped out for some air while Archibald was away.", "I left the dining room after Archibald went off for his brandy.", "I wasn't by the fire every minute, darling.", "Archibald wasn't with me the whole time, if you must know.", "I was alone in the dining room for a little while after Archibald went off.", "Archibald left me alone at the fire for ten minutes, darling. Rude of him."])
    run("R4", "fresh", "victoria", d, "block", "Where were you?");
  // B1 (R2): Gregory before his reveal (want block, fresh and in-hall)
  for (const st of ["fresh", "gregHall"]) for (const d of [
    "I knows who come out o' that door, sir, but I ain't sayin'.",
    "There were a face in the lightnin', sir. A face I knowed.",
    "Whoever it were 'ad skirts on, sir.",
    "I seen the library door open and shut, sir, in the flash.",
    "It were a woman, sir. That's all I'll say.",
    "Her ladyship were in the 'all, sir, by the library.",
    "The mistress were by that door, sir, when the lightnin' come.",
    "I seen 'er ladyship's face, white as a sheet, by the library door.",
    "Me lady come out o' there, sir.",
    "Milady turned the key, sir, I'd swear it on me mother's grave.",
    "The key went down 'er bodice, sir.",
    "She 'ad the key, sir. I seen it shine.",
    "The person what come out were wearin' a gown, sir.",
    "I weren't the only one in that 'all, sir.",
    "Somebody stepped out o' the library just after the thud, sir.",
    "I seen who it were. Ask 'er ladyship where she were at nineteen past.",
    "Lady Victoria walked off towards the dining room after, sir.",
    "Someone locked that door from the outside, sir, I seen 'em do it.",
  ]) run("R2", st, "gregory", d, "block", "Go on.");
  // B2 (R3): relays by Reginald and Archibald before they hold Gregory's card (want block)
  const relay = [
    "Gregory says he saw her ladyship lock the door.",
    "The gardener saw who locked it, I'm told.",
    "Gregory told me her ladyship came out of the library in the lightning.",
    "Someone saw Victoria lock that door, old boy, mark my words.",
    "Her ladyship pocketed the key, according to the gardener.",
    "The gardener swears it was her ladyship at the door.",
    "Word below stairs is that the gardener saw her ladyship with the key.",
  ];
  for (const st of ["fresh", "gregSawNotShown"]) for (const ch of ["reginald", "archibald"]) for (const d of relay) run("R3", st, ch, d, "block", "Go on.");
  for (const ch of ["reginald", "archibald"]) for (const d of ["Gregory says her ladyship locked the door.", "The gardener told me her ladyship locked the library.", "Gregory saw her ladyship come out of the library, I'm told.", "Her ladyship locked that door, I would know her step anywhere."])
    run("R3", "fresh", ch, d, "block", "Go on.");
  // B2b: the same relays once Gregory's card has been shown to them (want pass, E13 unlessShown)
  for (const ch of ["reginald", "archibald"]) for (const d of relay.slice(0, 3)) run("R3T", "gregSawShown", ch, d, "pass", "Go on.");
  // ... but never as their own eyes, card or no card (want block)
  for (const ch of ["reginald", "archibald"]) for (const d of ["I saw her ladyship lock the library door myself.", "I saw Victoria come out of the library in the lightning, old boy."]) run("R3", "gregSawShown", ch, d, "block", "Go on.");
  // B3: Gregory after his reveal (want pass) and still no killing (want block)
  for (const d of [
    "'Twas 'er ladyship come out o' the library, sir, in the lightnin', and she locked it be'ind 'er.",
    "I seen 'er plain, sir: out the library door, key in the lock, a turn, and into 'er dress it went.",
    "The mistress, sir. Out o' the library, locked the door, popped the key down 'er front.",
    "Her ladyship it were, sir. I seen her face by the lightning and the flickers after.",
    "She locked the library door behind her, sir, and walked off towards the dining room.",
    "Lady Victoria come out of the library at nineteen minutes past nine and locked it.",
    "I saw Lady Blackwood lock his lordship's door, sir, and slip the key into her gown.",
    "Milady come out, sir, and turned the key, and off she went to the dinin' room.",
    "It were her that locked the door, sir. I'd swear to it.",
    "I seen her ladyship with the key, sir, after she locked up.",
    "She came out of the library in the dark, sir, and locked the door.",
    "I saw her leave the library just after the thud, sir.",
    "Her ladyship's the one what locked that door, sir.",
    "It was her ladyship who locked the library, sir. I seen it.",
    "She had the key in her hand, sir, and then it was gone into her gown.",
    "It was Lady Victoria that locked the door, sir.",
    "It was her ladyship who locked it, sir.",
    "It was her ladyship locked it, sir, as I live and breathe.",
    "'Twas her ladyship locked that door, sir.",
  ]) run("R2T", "gregSaw", "gregory", d, "pass", "What did you see?");
  for (const d of ["She come out o' there after she done 'im in, sir.", "She killed 'im, sir, then locked the door.", "I seen 'er come out with the candlestick, sir.", "Her ladyship locked the door on 'is dead body, sir, she did it."])
    run("R2", "gregSaw", "gregory", d, "block", "What did you see?");
  // D2 (R5): Reginald asserting the embezzlement after the zero-clue theft (want block)
  for (const d of [
    "Mr Crane was arranging to move a great deal of money before midnight, sir.",
    "He was telling someone to sell up everything before midnight, sir.",
    "It sounded as if Mr Crane was emptying the company coffers, sir.",
    "Mr Crane was hiding money from his lordship, sir, I'm sure of it.",
    "His lordship had found Mr Crane out, sir, and Mr Crane meant to bolt with the funds.",
    "Mr Crane was squirrelling away the company's money on that telephone.",
    "Mr Crane was settling his accounts before the Yard could, sir.",
    "Whatever Mr Crane was up to on that telephone, sir, it was money, and it wasn't his.",
  ]) run("R5", "zeroTheft", "reginald", d, "block", "What did you hear?");
  for (const d of [
    "I heard Mr Crane on the servants' telephone, sir, talking about moving it all before midnight.",
    "I was counting the household money in my pantry during the blackout, sir. I am ashamed.",
    "I called through the pantry door who was on the telephone, and Mr Crane told me to mind my own business.",
    "At dinner his lordship accused Mr Crane of embezzling, sir, and Mr Crane threatened him.",
  ]) run("R5T", "zeroTheft", "reginald", d, "pass", "What did you hear?");
  // D3 (R15): elimination after the zero-clue theft (two named-by-elimination lines block; the rest are accepted deductions)
  for (const st of ["zeroTheft", "zeroTheftVic"]) for (const d of [
    "If Mr Crane was on the telephone, sir, then her ladyship was alone in the dining room.",
    "That leaves only her ladyship, sir, doesn't it?",
    "With Mr Crane at the telephone and me in my pantry, sir, there was only her ladyship free to go to the library.",
    "Her ladyship had the dining room to herself, sir, and the library is but a step across the hall.",
    "Mr Crane could not have done it, sir. He was on the telephone the whole while.",
  ]) run("R15", st, "reginald", d, "block", "Who could it have been?");
  // E1 (CA-43 tail, R10 data side): hedges and aliases (want block)
  for (const ch of ["reginald", "archibald", "gregory"]) for (const d of [
    "No doubt about it, she killed him.", "Surely she killed him, sir.", "She killed him, and I would swear to it in any court.", "If you ask me, she killed him.",
    "She killed him, I'd say.", "She struck him down, I believe, with that candlestick.", "She killed him, as sure as I could ever be of anything.",
    "Whether you like it or not, Victoria killed him.", "Victoria killed him. I could swear to it.", "She killed him, they say, and they're right.",
    "Mark my words: she killed him, and she'd do it again if she could.", "Should anyone ask, Victoria killed him.", "The mistress killed him.",
    "The missus killed him, sir.", "Milady killed him.", "M'lady killed him, sir.", "Mrs Blackwood killed him.", "The widow killed him, old boy.",
    "His wife killed him.", "Lady B. killed him.", "She did for him with the candlestick.", "She finished him, sir.", "She caved his head in.", "She struck his lordship dead.",
  ]) run("E8", "fresh", ch, d, "block", "Go on.");
  // E2: negations and true innocent lines (want pass)
  for (const [ch, d] of [
    ["archibald", "No one saw her kill him, old boy."],
    ["reginald", "Not a soul saw her ladyship strike him, sir."],
    ["reginald", "Nobody can say Victoria killed him, sir."],
    ["archibald", "Victoria never killed anyone in her life."],
    ["archibald", "She couldn't have killed him; she was with me."],
    ["gregory", "She didn't kill him, sir, not as I know."],
    ["archibald", "Her ladyship killed him? Never!"],
    ["reginald", "Her ladyship came out of the library at three minutes to nine, sir, flushed."],
    ["archibald", "Victoria went into the library before nine to see Edmund."],
    ["reginald", "Her ladyship came into the library with us when the door was forced, sir, in the dark."],
    ["archibald", "Victoria went into the library with the rest of us after I forced the door, and Edmund was dead."],
    ["reginald", "Her ladyship was in the library by candlelight when we found his lordship dead, sir."],
    ["gregory", "Her ladyship were in the library with the others when I come in, sir, and the master was dead."],
    ["reginald", "Her ladyship screamed and swooned in the library when we found him, sir."],
    ["archibald", "Victoria locked eyes with me across the table, old boy."],
    ["reginald", "Her ladyship always locks her jewel case, sir."],
    ["archibald", "She left the library door open after their row, before nine."],
    ["reginald", "Her ladyship went to the library at a quarter to nine, sir, after dinner."],
  ] as const) run("E8T", "fresh", ch, d, "pass", "Go on.");
  // P10 (R14): CA-48/49/50 tails (fresh; want block)
  for (const [ch, d] of [
    ["reginald", "Her ladyship? I never once clapped eyes on her the whole evening, sir."],
    ["reginald", "Not hide nor hair of her ladyship did I see tonight, sir."],
    ["reginald", "I had no sight of her ladyship from dinner to the discovery, sir."],
    ["reginald", "Her ladyship's handkerchief had a dark stain on it, sir."],
    ["archibald", "Her lace was soiled with something that wasn't wine, old boy."],
    ["gregory", "There were muck on her ladyship's 'anky, sir, dark muck."],
    ["archibald", "We could take a cue in the billiard room while we wait."],
    ["reginald", "I could serve tea in the morning room, sir."],
    ["victoria", "I shall be in the smoking room if anyone needs me."],
    ["reginald", "The footman had the evening off, sir."],
    ["gregory", "The scullery maid seen nothing, sir, she were abed."],
    ["reginald", "There is a second key in the butler's pantry, sir."],
    ["archibald", "The constable says they'll row across before midnight."],
    ["reginald", "The telephone line went dead at ten past nine, sir."],
  ] as const) run("P10", "fresh", ch, d, "block", "Go on.");
}, 120_000);

/** probe7/probe8 lines that SHOULD block (they are not canon, or the speaker does not hold that time), with the reason. */
const P7_EXPECT_BLOCK: Record<string, string> = {
  "His lordship let the cook go last spring, sir. I see to the kitchen now.": "invents a cook and her dismissal; f-household-tonight names no other staff, past or present",
  "I did not see her ladyship at all this evening after twenty past nine, sir, until the door was forced.": "engine time check (unknown_time): 21:20 is no time Reginald knows; he was below stairs 21:13-21:30",
  "Folk say she done for him, sir, but I couldn't say.": "an accusation dressed as rumour: no one in canon says it",
  "Her ladyship took the candlestick from me at dinner to admire it, sir.": "invented, and puts the weapon in her hand (#46 rule 6)",
  "Her ladyship went in to his lordship at a quarter to nine, sir.": "engine time check (unknown_time): she did leave at 20:45 (ev-victoria-leaves-for-library), but Reginald does not hold that event (he knows 20:54 and 20:57), so the time is not his to state",
  "Her ladyship went to the library at a quarter to nine, sir, after dinner.": "same as above (r7c): true of Victoria at 20:45, but not a time Reginald holds (unknown_time)",
  "Archibald came back to the fire at twenty-two minutes past nine without any brandy.": "r7c: Victoria conceding Archibald's absence before left-dining is out breaks her own 'together' story, and 21:22 is not a time she states (unknown_time); Gremlin marked a block acceptable",
};
/** Attack lines deliberately left open: line -> reason. Never drop a line silently; list it here. */
const KNOWN_GAPS: Record<string, string> = {
  "The wires are down in the storm, darling.": "ambiguous: the POWER line is canonically down until 21:38 (ev-blackout), so 'the wires are down' is true of it",
  "She must have taken the letter off his desk, sir, there's no one else.": "E8: deduction hedged with 'must have' is exempt by design (an innocent may suspect); the generic culprit-act check should weigh it",
};
/**
 * Lines whose verdict depends on the reveal state: "line@state" -> reason. They block before the secret is out (the
 * corpus wants block) and pass in the listed state, where they are true.
 */
const STATE_CANON: Record<string, string> = {
  "I left the dining room to see my husband, if you must know.@newwill+left": "r7c (George via the brief): blocked until s-victoria-left-dining is out ([r7c-R4-left]); after it, leaving the dining room is admitted. It also fits her 20:45 exit, and she still may not say WHEN she saw him (core, [r7c-R1-errand])",
  "When I left the dining room I went to the hall, darling, that's all.@newwill+left": "r7c: same as above; after left-dining the hall is where any exit leads, and no window anchor is given",
  "I came back to the fire just before Archibald did.@vLeft": "r7c: true once left-dining is out (she was back at 21:20-21, he at 21:22); before that it concedes her absence ([r7c-R1-return])",
  "I came back to the dining room a minute or two before Archibald.@vLeft": "r7c: same as above",
};
/** Hedged deductions the brief accepts (Gremlin r7c R15): an innocent may reason aloud from what he knows. */
const ACCEPTED_DEDUCTIONS: Record<string, string> = {
  "If Mr Crane was on the telephone, sir, then her ladyship was alone in the dining room.": "R15: a conditional deduction from Archibald's card, which Reginald holds on this route; nothing new reaches the player",
  "Her ladyship had the dining room to herself, sir, and the library is but a step across the hall.": "R15: an inference from the same card, with no act or time stated",
  "Mr Crane could not have done it, sir. He was on the telephone the whole while.": "R15: clears Archibald from the card Reginald holds; names nobody",
};
/** Canon or innocuous lines the ENGINE (not data) blocks: listed for Dexter, and the test fails once fixed so the entry is removed. */
const ENGINE_FALSE_BLOCKS: Record<string, string> = {
  "Her ladyship came into the library with us when the door was forced, sir, in the dark.": "engine (E15, r7c R8): E8's scene predicate fires on DARK although the sentence is anchored at the discovery (forced, with us); data rule [8] now exempts it",
  "Victoria went into the library with the rest of us after I forced the door, and Edmund was dead.": "engine (E15, r7c R8): E8 scene on DEAD at the discovery (loc-victoria-2132)",
  "Her ladyship was in the library by candlelight when we found his lordship dead, sir.": "engine (E15, r7c R8): E8 scene at the discovery; data rule [8] now exempts it",
  "I left the dining room for a while after the candles were lit. I shan't say where.": "engine (E16, r7c R9): event_order binds 'left the dining room' to ev-victoria-leaves-for-library (20:45) and rejects 'after the candles'; true once left-dining is out",
  "It was her ladyship who locked the library, sir. I seen it.": "engine (E17, r7c R7): E8's cleft rule files 'it was MURDERER who locked' under killing, so the key cover from s-gregory-saw-victoria does not apply",
  "It was Lady Victoria that locked the door, sir.": "engine (E17, r7c R7): same cleft rule",
  "It was her ladyship who locked it, sir.": "engine (E17, r7c R7): same cleft rule",
};
/** Lines Gremlin listed as attacks that are canon: they move to the allow side. */
const ACTUALLY_CANON: Record<string, string> = {
  "I went round by the greenhouse, sir.": "the greenhouse is canon (garden)",
  "I rang the police at about twenty to ten, sir.": "hedged 'about' gives +-10 minutes, and 21:38 is inside it",
};

const key = (r: R7bResult) => `${r.tag} ${r.ch}@${r.st} :: ${r.d}`;
const wanted = (r: R7bResult): "block" | "pass" =>
  `${r.d}@${r.st}` in STATE_CANON || r.d in ACTUALLY_CANON || r.d in ACCEPTED_DEDUCTIONS ? "pass" : r.d in P7_EXPECT_BLOCK ? "block" : r.want;
const show = (rs: R7bResult[]) => rs.map((r) => `[${r.why || "PASS"}] ${key(r)}`);

describe("r7b + r7c corpus through the real guard (Gremlin's probe5-10)", () => {
  it("ALLOW: every true-canon, small-talk and innocuous line passes in its reveal state", () => {
    const allow = results.filter((r) => wanted(r) === "pass");
    expect(allow.length).toBe(255);
    expect(show(allow.filter((r) => r.got === "block" && !(r.d in ENGINE_FALSE_BLOCKS)))).toEqual([]);
  });

  it("ENGINE false blocks are still engine-blocked (remove the entry once Dexter fixes it)", () => {
    for (const d of Object.keys(ENGINE_FALSE_BLOCKS)) expect(results.some((r) => r.d === d && r.got === "block"), d).toBe(true);
  });

  it("BLOCK: every attack line is blocked, except the listed known gaps", () => {
    const block = results.filter((r) => wanted(r) === "block");
    expect(block.length).toBe(573);
    expect(show(block.filter((r) => r.got === "pass" && !(r.d in KNOWN_GAPS)))).toEqual([]);
  });

  it("every known gap is still a real gap (remove it once fixed) and every listed line exists in the corpus", () => {
    const lines = new Set(results.map((r) => r.d));
    for (const d of [...Object.keys(KNOWN_GAPS), ...Object.keys(P7_EXPECT_BLOCK), ...Object.keys(ACTUALLY_CANON), ...Object.keys(ENGINE_FALSE_BLOCKS), ...Object.keys(ACCEPTED_DEDUCTIONS)]) expect(lines.has(d), d).toBe(true);
    for (const k of Object.keys(STATE_CANON)) expect(results.some((r) => `${r.d}@${r.st}` === k), k).toBe(true);
    for (const d of Object.keys(KNOWN_GAPS)) expect(results.some((r) => r.d === d && r.got === "pass"), d).toBe(true);
  });

  it("dump (R7B_DUMP=path writes every mismatch, for debugging)", async () => {
    if (!process.env.R7B_DUMP) return;
    const out = results.filter((r) => r.got !== wanted(r)).map((r) => `${wanted(r) === "pass" ? "FP  " : r.d in KNOWN_GAPS ? "GAP " : "MISS"} [${r.why}] ${key(r)}`);
    out.push(`allow ${results.filter((r) => wanted(r) === "pass").length} block ${results.filter((r) => wanted(r) === "block").length}`);
    (await import("node:fs")).writeFileSync(process.env.R7B_DUMP, out.join("\n") + "\n");
  });
});
