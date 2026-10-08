/**
 * Post-generation GUILT-LEAK check (Agatha's core-guilt rule; George's live-play confession bug).
 *
 * Nobody confesses the murder through their own mouth before the accusation:
 *  - ANYONE: a first-person admission of killing / striking the victim ("I killed Albert", "I struck him",
 *    "Yes, I did it", "it was me", "I'm the murderer"), true or false.
 *  - THE CULPRIT, additionally: the weapon used in a first-person act ("I wiped the candlestick"), locking the
 *    door or taking/hiding the key, and placing herself at the murder scene during the murder window
 *    ("I was in the library at seventeen past nine").
 *  - THE CULPRIT, since Agatha's leak audit: ANY first-person act at a clock time inside the murder window
 *    ("I burned it at twenty past nine"; an alibi "I was by the fire at 21:16" passes), handling a core-guilt object
 *    ("I wiped the base with my handkerchief", "I dropped it in the coal scuttle", "I took the letter off his desk"),
 *    "I locked it", and being with the victim or at the scene while someone was away, in the dark or by candlelight.
 *    The window, objects and places all come from case data (engine/core-guilt.ts guiltProfile).
 * Denials ("I never killed him"), questions ("You think I killed him?") and hypotheticals ("as if I could
 * have struck him") pass. A bare MOTIVE admission ("I knew about the will and burned the letter") is NOT
 * core guilt and passes.
 *
 * Deterministic and cheap: on a hit the caller asks the model ONCE more with a corrective note (the single
 * retry in ai/grok.ts), then falls back to a canned in-character deflection. No extra model call.
 */
import type { GuiltProfile } from "@/engine/core-guilt";
import { extractTimes } from "./canon-check";

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (xs: readonly string[]) => xs.filter(Boolean).map((x) => esc(x).replace(/\s+/g, "\\s+")).join("|");

/** The speaker as subject: "I", "I'd", "I've", "I had". */
const SUBJ = String.raw`\bI(?:'d|'ve|’d|’ve)?\b`;
/** Words that make the rest of the clause a denial or a hypothetical. */
const NEG = String.raw`never|not|no|nor|nothing|didn't|didn’t|did\s+not|wouldn't|wouldn’t|couldn't|couldn’t|won't|won’t|can't|can’t|cannot|shan't|shan’t|hardly|scarcely|nobody|without|could|would|might|should|could've|would've|wanted|want|wish|felt|feel|nearly|almost|ready|mind|used\s+to|dreamt|dreamed`;
/** After the verb: up to n characters of the same clause, with no negation ("I had NOTHING to do with any key"). */
const span = (n: number) => String.raw`(?:(?!\b(?:never|not|no|nothing|none|any|nobody)\b)[^.!?;])` + `{0,${n}}?`;
/** Words that hand the act to someone else ("I saw HIM strike...", "I know YOU killed..."). */
const BLOCK = String.raw`you|he|she|they|we|it|someone|somebody|anyone|who|that|saw|seen|heard|watched|know|knew|think|thought|told|tell|said|say|swear|swore|believe|suppose|reckon|bet|expect|hope|suspect|wonder|doubt|see|hear|let|made|make|helped|help`;
/** Between the "I" and the verb: at most a few words, none of them a negation, a modal or another subject. */
const gap = (words: number) => String.raw`(?:[\s,]+(?!(?:${NEG}|${BLOCK})\b)[\w'’-]+){0,${words}}?[\s,]+`;

const KILL = String.raw`(?:kill(?:ed)?|murder(?:ed)?|struck|strike|hit|bludgeon(?:ed)?|club(?:bed)?|bash(?:ed)?|cosh(?:ed)?|brain(?:ed)?|smash(?:ed)?|clobber(?:ed)?|whack(?:ed)?|walloped|crowned|did\s+away\s+with|did\s+for|done\s+for|did\s+(?:him|her)\s+in|finished\s+(?:him|her)\s+off|silenced)(?!\s+(?:a\s+|the\s+)?(?:match|light|bargain|deal|note|chord|pose|nerve|snag|wall|roof|ceiling))`;
const WEAPON_ACT = String.raw`swung|swing|raised|lifted|brought(?:\s+down)?|picked\s+up|seized|grabbed|snatched|used(?!\s+to\b)|wiped|cleaned|wielded|carried|took|struck|hit|bashed|brained`;
const KEY_ACT = String.raw`took|taken|pocketed|hid|hidden|dropped|slipped|kept|had|turned|threw|tossed|buried`;
const MOVE = String.raw`was|went|go|gone|nipped|dashed|looked\s+in(?:to)?|slipped|stepped|crept|returned|popped|came|got|ran|hurried|stole|sneaked|snuck|knocked|entered|been|stayed|waited|stood|sat|talked|spoke|pleaded|argued`;
/** Handling a core-guilt object (desk, handkerchief, coal scuttle...): "took" but not "took out (my handkerchief)". */
const OBJECT_ACT = String.raw`took(?!\s+out)|taken|snatched|grabbed|picked\s+up|lifted|pocketed|hid|hidden|dropped|slipped|threw|tossed|stuffed|shoved|pushed|wiped|wiping|cleaned|scrubbed|rubbed|burned|burnt|buried|stood|set|put|placed|tucked`;
/** Proxies for "during the murder window" that need no clock: the dark, the candles, the blackout. */
/** The victim already down: "I came out of the library, but he was already dead". */
const DEAD = /\b(?:already\s+dead|was\s+dead|lay\s+dead|lying\s+dead|his\s+body|her\s+body|the\s+body|lay\s+there|lying\s+there)\b/i;
const DARK = /\b(?:in\s+the\s+dark(?:ness)?|by\s+candle-?light|while\s+the\s+candles?\s+(?:burned|burnt|guttered|flickered)|by\s+the\s+light\s+of\s+(?:a|the)\s+candle|during\s+the\s+blackout|when\s+the\s+lights?\s+(?:went|were|was)\s+out|after\s+the\s+lights?\s+(?:went|failed))\b/i;
/**
 * Hedges RIGHT BEFORE the "I" that make it someone else's claim or a hypothetical: "you think I killed him",
 * "as if I could", "if I had", "accusing me... that I". ("If you must know, I killed him" is NOT hedged.)
 */
const HEDGE = new RegExp(
  String.raw`(?:\b(?:think|thinks|thought|suppose|supposing|suggest|suggests|suggesting|imagine|imagines|imagining|believe|believes|claim|claims|claiming|say|says|saying|said|pretend|fancy|fancies|insinuate|insinuating|hint|hinting|mean|means)\b(?:\s+that)?|\bas\s+(?:if|though)|\bif|\bwhether|\bunless|\baccus\w*\s+(?:me\s+)?(?:of\s+)?\w*(?:\s+that)?)\s*["'“‘]?\s*$`,
  "i",
);

/** Affirmations that open a reply ("Yes, darling.", "Every word of it.", "You're quite right."). */
const AFFIRM = /^\W*(?:(?:oh|well|very\s+well|ah|then|fine|all\s+right),?\s+)*(?:yes\b|aye\b|indeed\b|quite\s+so\b|it'?s\s+true\b|that'?s\s+true\b|every\s+word\b|you'?re\s+(?:quite\s+|perfectly\s+)?right\b|I\s+admit\s+it\b|so\s+I\s+did\b|what\s+if\s+I\s+did\b|I\s+did\b(?!\s+not|n)|guilty\b)/i;
const AFFIRM_NEG = /\b(?:never|not|no|nothing|didn['’]?t|wasn['’]?t|nor|none)\b/i;

/** Options for findGuiltLeak. */
export interface GuiltOptions {
  /** The speaker's own names ("Jane Doe", "Jane", "Lady Jane"): third-person self-naming counts as "I". */
  speakerNames?: readonly string[];
}

export interface GuiltLeak {
  /** Which rule matched. */
  kind: "killing" | "confession" | "weapon" | "key" | "scene" | "object" | "window";
  /** The offending sentence (trimmed). */
  text: string;
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+|\s+[—–]\s+|\s+--\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A match counts only when the text before the "I" is not a hedge ("you think I...") and the sentence is not a question. */
function hit(sentence: string, re: RegExp): boolean {
  if (/\?\s*["'”’)]*$/.test(sentence)) return false;
  for (const m of sentence.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
    const before = sentence.slice(0, m.index ?? 0);
    if (HEDGE.test(before)) continue;
    return true;
  }
  return false;
}

/**
 * The first guilt leak in `text` spoken by `speakerId`, or null.
 * `profile` comes from engine/core-guilt.ts guiltProfile() (server-only; never sent to the model).
 */
export function findGuiltLeak(text: string, profile: GuiltProfile, speakerId: string, opts: GuiltOptions = {}): GuiltLeak | null {
  const self = selfNames(opts.speakerNames);
  // Third-person self-naming ("Jane Doe struck her husband down") reads as "I".
  if (self) text = text.replace(new RegExp(`\\b(?:${self})\\b(?!['’]s)`, "gi"), "I");
  const victim = alt([...profile.victimNames, "him", "her", "my husband", "her husband", "his wife", "your father", "the old man", "the master", "the poor man"]);
  const culprit = speakerId === profile.murdererId;
  const killing = new RegExp(`${SUBJ}${gap(3)}\\b${KILL}\\b${span(25)}\\b(?:${victim})\\b`, "i");
  const killedBare = new RegExp(`${SUBJ}${gap(3)}\\b(?:killed|murdered)\\b`, "i");
  const confession = new RegExp(
    String.raw`(?:${SUBJ}\s+did\s+it\b(?!\s+(?:again|before|myself|every|each|once|twice|properly|so|that|all))|\bit\s+was\s+(?:me|I)\b(?!\s+who\s+(?:found|screamed|saw|heard|rang|called))|${SUBJ}(?:'m|’m|\s+am)\s+(?:the|your)\s+(?:murderer|killer|culprit|guilty\s+one)\b|${SUBJ}(?:'m|’m|\s+am)\s+guilty\b|${SUBJ}\s+confess(?:\s+to)?\s+(?:it\b(?!\s+(?:was|is|seemed|felt))|the\s+(?:murder|killing|crime)\b|(?:the\s+)?murder(?:ing)?\b|killing\b|that\s+I\s+(?:killed|murdered|did\s+it|struck)\b)|${SUBJ}\s+(?:had|have)\s+(?:his|her)\s+blood)`,
    "i",
  );
  const weapon = profile.weaponNames.length ? new RegExp(`${SUBJ}${gap(3)}\\b(?:${WEAPON_ACT})\\b${span(30)}\\b(?:${alt(profile.weaponNames)})s?\\b`, "i") : null;
  const lockDoor = new RegExp(`${SUBJ}${gap(3)}\\b(?:locked|bolted)\\b${span(30)}\\bdoor\\b`, "i");
  const key = new RegExp(`${SUBJ}${gap(3)}\\b(?:${KEY_ACT})\\b${span(25)}\\bkey\\b`, "i");
  const scene = profile.sceneNames.length ? new RegExp(`${SUBJ}${gap(3)}\\b(?:${MOVE})\\b${span(30)}\\b(?:${alt(profile.sceneNames)})\\b`, "i") : null;
  const [lo, hi] = profile.window;
  const inWindow = (s: string) => extractTimes(s).some((m) => m.candidates.some((c) => c >= lo - 1 && c <= hi + 1) && !m.hourOnly);
  const inWindowStrict = (s: string) => extractTimes(s).flatMap((m) => (m.hourOnly ? [] : m.candidates.filter((c) => c >= lo && c <= hi)));
  // Any first-person act ("I burned it at twenty past nine"), not a denial or a modal.
  const actor = new RegExp(`${SUBJ}${gap(3)}\\b(?!(?:${NEG}|${BLOCK})\\b)[a-z'’]+`, "i");
  const objects = profile.coreObjects?.length ? new RegExp(`${SUBJ}${gap(3)}\\b(?:${OBJECT_ACT})\\b${span(40)}\\b(?:${alt(profile.coreObjects)})s?\\b`, "i") : null;
  const lockBare = new RegExp(`${SUBJ}${gap(3)}\\b(?:locked|bolted)\\b(?!\\s+(?:myself|me)\\b)`, "i");
  const sceneOrVictim = alt([...profile.sceneNames, ...profile.victimNames]);
  const presence = sceneOrVictim ? new RegExp(`${SUBJ}${gap(3)}\\b(?:${MOVE})\\b${span(30)}\\b(?:${sceneOrVictim})\\b`, "i") : null;
  /**
   * "I was by the fire at 21:16" is the culprit's ALIBI (a lie, but no admission): a stative verb with a place her
   * core-guilt facts do NOT put her in at that minute. "I was in the dining room at 21:20" (true, and core) is not.
   */
  const alibi = (s: string, minutes: number[]) => {
    if (!/\bI\s+(?:was|sat|stayed|remained|waited|stood)\b/i.test(s)) return false;
    const places = (profile.locationNames ?? []).filter((l) => l.names.some((n) => new RegExp(`\\b${esc(n)}\\b`, "i").test(s))).map((l) => l.id);
    if (/\bby\s+the\s+fire(?:side)?\b|\bat\s+the\s+fireside\b/i.test(s)) places.push(...(profile.locationNames ?? []).filter((l) => /dining|drawing|sitting|parlou?r|lounge/.test(l.id)).map((l) => l.id));
    if (!places.length || places.some((p) => profile.sceneNames.length && p === profile.sceneNames[0])) return false;
    return minutes.every((m) => !places.some((p) => (profile.coreWhereabouts?.[m] ?? []).includes(p)));
  };
  const whileAway = /\bwhile\b[^.!?;]{0,40}\b(?:away|gone|out|off|telephon\w*|on\s+the\s+(?:tele)?phone)\b|\b(?:after|once|when)\s+\w+(?:\s+\w+)?\s+(?:left|had\s+gone|went\s+out|went\s+off|had\s+left|stepped\s+out|was\s+called\s+away|was\s+gone)\b/i;
  // "Passive" and possessive admissions about oneself: "he was struck by me", "the deed was mine", "by my own hand".
  const KILL_PP = String.raw`(?:killed|murdered|struck(?:\s+down)?|hit|bludgeoned|clubbed|bashed|brained|coshed|smashed|silenced|done\s+in|finished\s+off)`;
  const passive = new RegExp(String.raw`\b(?:${victim}|he|she)\s+(?:was|got)\s+(?:\w+\s+){0,2}?${KILL_PP}\b[^.!?;]{0,40}?\bby\s+(?:me|my\s+(?:own\s+)?hands?)\b`, "i");
  const mine = /\b(?:the|that)\s+(?:deed|blow|crime|murder|killing|guilt|hand\s+that\s+\w+)\s+(?:was|is)\s+mine\b|\bmine\s+(?:was|is)\s+the\s+(?:hand|blow|deed|guilt)\b|\bguilty\s+as\s+charged\b|\bI\s+plead\s+guilty\b|\byou(?:'ve|\s+have)\s+(?:got|caught|found)\s+(?:your|the)\s+(?:murder(?:er|ess)|killer|culprit)\b/i;
  const byMyHand = /\bby\s+my\s+(?:own\s+)?hands?\b/i;
  const byMyHandAbout = new RegExp(String.raw`\b(?:${victim}|fell|died|dead|struck|killed|murdered|door|key|lock(?:ed)?|${alt([...profile.weaponNames, ...profile.sceneNames])})\b`, "i");
  const notMine = /\b(?:not|never|no)\s+(?:\w+\s+){0,2}?by\s+my\b/i;
  // With the victim, alone, at the scene ("Albert and I were alone in the study"), or going (back) there to see him.
  const together = new RegExp(String.raw`(?:\b(?:${alt(profile.victimNames)})\s+and\s+I\b|\bI\s+and\s+(?:${alt(profile.victimNames)})\b|\bwe\s+(?:were|was|sat|stood|stayed)\b|\balone\s+with\s+(?:${victim})\b)`, "i");
  const alone = /\b(?:alone|together|just\s+the\s+two\s+of\s+us)\b/i;
  const sceneWord = profile.sceneNames.length ? new RegExp(`\\b(?:${alt(profile.sceneNames)})\\b`, "i") : null;
  const backAgain = /\b(?:back|again|returned)\b/i;
  const toSeeVictim = new RegExp(String.raw`\bto\s+(?:see|speak\s+(?:to|with)|talk\s+(?:to|with)|reason\s+with|plead\s+with|confront|have\s+it\s+out\s+with|beg)\s+(?:${victim})\b`, "i");
  const BEFORE_LANDMARK = /\bbefore\s+(?:dinner|supper|the\s+blackout|the\s+lights|the\s+storm|the\s+candles)\b/i;
  const outsideWindow = (s: string) => {
    const ts = extractTimes(s).filter((m) => !m.hourOnly);
    return ts.length > 0 && ts.every((m) => m.candidates.every((c) => c < lo - 1 || c > hi + 1));
  };

  // Agatha's culprit phrases (#45 follow-up), data-derived where possible.
  const notQ = (s: string) => !/\?\s*["'”’)]*$/.test(s);
  const neverMeant = new RegExp(String.raw`${SUBJ}\s+(?:never|didn['’]?t|did\s+not|truly\s+never|swear\s+I\s+never)\s+(?:meant|mean|intended|intend|wanted)\s+(?:to\s+)?(?:hurt|harm|kill|strike|hit|injure)\s+(?:${victim})\b`, "i");
  const selfDefence = /\b(?:self[-\s]?defen[cs]e|defending\s+myself|in\s+my\s+own\s+defen[cs]e)\b/i;
  const cameAtMe = new RegExp(String.raw`\b(?:${victim}|he|she)\s+(?:came\s+at|lunged\s+at|went\s+for|attacked|flew\s+at|grabbed)\s+me\b`, "i");
  const watchedFall = new RegExp(String.raw`${SUBJ}${gap(2)}\b(?:watched|saw|heard)\s+(?:${victim})\s+(?:fall|drop|crumple|collapse|go\s+down|die|hit\s+the\s+floor)\b`, "i");
  const GARMENT = String.raw`(?:gown|dress|frock|sleeves?|gloves?|hands?|fingers|hem|slippers|cuffs?|skirts?|shawl|bodice|shoes?)`;
  const bloodOnMe = new RegExp(String.raw`(?<!\b(?:no|not|any|without)\s)\bblood\b[^.!?]{0,25}\bmy\s+(?:own\s+)?${GARMENT}\b|\bmy\s+(?:own\s+)?${GARMENT}\b[^.!?]{0,20}\b(?:bloodied|bloodstained|blood-stained|bloody|covered\s+in\s+blood|spattered|red\s+with\s+blood)\b`, "i");
  const weaponInHand = profile.weaponNames.length
    ? new RegExp(String.raw`\b(?:${alt(profile.weaponNames)})s?\b[^.!?]{0,25}\b(?:in|from|into)\s+my\s+(?:own\s+)?hands?\b|\bmy\s+(?:own\s+)?hands?\b[^.!?]{0,20}\b(?:${alt(profile.weaponNames)})s?\b`, "i")
    : null;
  const wipedClean = new RegExp(String.raw`${SUBJ}${gap(2)}\b(?:wiped|cleaned|scrubbed|rubbed|polished)\s+(?:it|that|them|the\s+thing|the\s+blood)\b(?:\s+(?:clean|down|off|away))?|\bwiped\s+(?:the\s+|his\s+)?blood\b`, "i");
  const deadWhenI = /\b(?:already\s+dead|was\s+dead|dead\s+already|lay\s+dead|not\s+breathing)\b[^.!?]{0,30}\b(?:when|by\s+the\s+time|before)\s+I\s+(?:came\s+out|left|came\s+away|got\s+there|went\s+in|came\s+in|reached\s+him|looked)\b|\bwhen\s+I\s+(?:came\s+out|left|came\s+away|got\s+there|went\s+in)\b[^.!?]{0,30}\b(?:already\s+dead|was\s+dead|dead\s+already)\b/i;
  const LIGHTNING = /\b(?:by\s+the\s+lightning|in\s+the\s+(?:lightning\s+)?flash|at\s+the\s+(?:lightning\s+)?flash|when\s+the\s+lightning|lightning\s+flashed)\b/i;
  const leftScene = profile.sceneNames.length
    ? new RegExp(String.raw`${SUBJ}${gap(2)}\b(?:left|came\s+out\s+of|stepped\s+out\s+of|slipped\s+out\s+of|crept\s+out\s+of|hurried\s+out\s+of|ran\s+out\s+of|got\s+out\s+of)\s+(?:the\s+)?(?:${alt(profile.sceneNames)})\b`, "i")
    : null;
  const sawMe = profile.witnessNames?.length
    ? new RegExp(String.raw`(?<!\b(?:if|whether|unless|claims?|says?|said|thinks?|imagines?|swears?)\s(?:the\s)?)\b(?:the\s+)?(?:${alt(profile.witnessNames)})\s+(?:must\s+have\s+|may\s+have\s+|did\s+)?(?:saw|seen|see|spotted|glimpsed|caught|watched|recogni[sz]ed)\s+me\b`, "i")
    : null;
  const motive = profile.motiveActs?.length
    ? new RegExp(String.raw`${SUBJ}${gap(2)}\b(?:stopped|prevented|kept)\s+(?:${victim})\s+(?:from\s+)?(?:ever\s+)?(?:${alt(profile.motiveActs)})\b|\bmade\s+sure\s+(?:${victim}|he|she)\s+(?:never|didn['’]?t|would\s+never|could\s+never|wouldn['’]?t|couldn['’]?t)\s+(?:${alt(profile.motiveActs.map((g) => g.replace(/ing$/, "")))})`, "i")
    : null;

  for (const s of sentences(text)) {
    if (hit(s, killing) || hit(s, killedBare)) return { kind: "killing", text: s };
    if (hit(s, confession)) return { kind: "confession", text: s };
    if (!/\?\s*["'”’)]*$/.test(s)) {
      if (passive.test(s) || mine.test(s)) return { kind: "confession", text: s };
      if (byMyHand.test(s) && !notMine.test(s) && (culprit ? byMyHandAbout.test(s) : new RegExp(`\\b(?:${victim})\\b`, "i").test(s) && /\b(?:fell|died|dead|struck|killed|murdered)\b/i.test(s)))
        return { kind: "confession", text: s };
    }
    if (!culprit) continue;
    if (notQ(s)) {
      if (hit(s, neverMeant) || (selfDefence.test(s) && !/\b(?:not|never|no)\s+(?:\w+\s+){0,2}?self/i.test(s) && /\b(?:I|my|me|it\s+was)\b/i.test(s))) return { kind: "confession", text: s };
      if (cameAtMe.test(s) || hit(s, watchedFall) || bloodOnMe.test(s) || (weaponInHand && weaponInHand.test(s) && !/\b(?:never|not|no)\b/i.test(s)) || hit(s, wipedClean) || deadWhenI.test(s))
        return { kind: "confession", text: s };
      if (leftScene && hit(s, leftScene) && (DARK.test(s) || LIGHTNING.test(s) || whileAway.test(s) || inWindowStrict(s).length > 0)) return { kind: "scene", text: s };
      if (sawMe && sawMe.test(s) && !/\b(?:never|not|couldn['’]?t|didn['’]?t|can['’]?t)\b/i.test(s)) return { kind: "confession", text: s };
      if (motive && hit(s, motive)) return { kind: "confession", text: s };
    }
    if (sceneWord && together.test(s) && (alone.test(s) || DARK.test(s) || whileAway.test(s)) && sceneWord.test(s) && !AFFIRM_NEG.test(s) && !outsideWindow(s) && !BEFORE_LANDMARK.test(s))
      return { kind: "scene", text: s };
    if (presence && hit(s, presence) && (backAgain.test(s) || toSeeVictim.test(s)) && sceneWord?.test(s) && !outsideWindow(s) && !BEFORE_LANDMARK.test(s)) return { kind: "scene", text: s };
    if (weapon && hit(s, weapon)) return { kind: "weapon", text: s };
    if (hit(s, lockDoor) || hit(s, key) || hit(s, lockBare)) return { kind: "key", text: s };
    if (objects && hit(s, objects)) return { kind: "object", text: s };
    if (scene && hit(s, scene) && (inWindow(s) || whileAway.test(s) || DARK.test(s) || DEAD.test(s))) return { kind: "scene", text: s };
    if (presence && hit(s, presence) && (inWindowStrict(s).length > 0 || whileAway.test(s) || DARK.test(s) || DEAD.test(s))) return { kind: "scene", text: s };
    const minutes = inWindowStrict(s);
    if (minutes.length && hit(s, actor) && !alibi(s, minutes)) return { kind: "window", text: s };
  }
  return null;
}

/** Regex alternation of a speaker's own names (full name, first name, aliases); "" when none. */
function selfNames(names: readonly string[] | undefined): string {
  if (!names?.length) return "";
  const all = new Set<string>();
  for (const n of names) {
    const t = n.trim();
    if (!t) continue;
    all.add(t);
    const first = t.split(/\s+/)[0];
    if (first.length >= 3 && !/^(?:lady|lord|mr|mrs|miss|sir|dr|her|his|the)$/i.test(first)) all.add(first);
  }
  return alt([...all].sort((a, b) => b.length - a.length));
}

/**
 * "Yes, darling. Every word of it." after the detective spelled the murder out (#45): the reply affirms an accusation
 * that would be a guilt leak in the speaker's own mouth. `heard` is what the speaker just heard. Null = fine.
 */
export function findAffirmedAccusation(dialogue: string, heard: string, profile: GuiltProfile, speakerId: string, opts: GuiltOptions = {}): GuiltLeak | null {
  const lead = dialogue.replace(/\s+/g, " ").split(/(?<=[.!?…])\s+/).slice(0, 2).join(" ");
  if (!AFFIRM.test(lead) || AFFIRM_NEG.test(lead)) return null;
  // The accusation, turned into the speaker's own words: "You killed him at 21:17, didn't you?" -> "I killed him at 21:17."
  const own = heard
    .replace(/,?\s*(?:didn['’]?t|did|weren['’]?t|were|aren['’]?t|haven['’]?t|hadn['’]?t|isn['’]?t|wasn['’]?t)\s+(?:you|it|she|he)(?:\s+not)?\s*\?/gi, ".")
    .replace(/\?/g, ".")
    .replace(/\b(?:did|were|have|had)\s+you\b/gi, "I")
    .replace(/\byou\s+were\b/gi, "I was")
    .replace(/\byou['’]re\b/gi, "I'm")
    .replace(/\byou['’]ve\b/gi, "I've")
    .replace(/\byou['’]d\b/gi, "I'd")
    .replace(/\byourself\b/gi, "myself")
    .replace(/\byour\b/gi, "my")
    .replace(/\byou\b/gi, "I");
  const leak = findGuiltLeak(own, profile, speakerId, opts);
  return leak ? { kind: "confession", text: `${lead.slice(0, 60)} (to: ${leak.text.slice(0, 80)})` } : null;
}

/**
 * The action field is the speaker's own stage direction ("mimes swinging the silver candlestick down onto Albert's
 * head, then turning a key in a lock"): its implied subject is the speaker. Null = fine.
 */
export function findActionLeak(action: string, profile: GuiltProfile, speakerId: string, opts: GuiltOptions = {}): GuiltLeak | null {
  if (!action.trim()) return null;
  const culprit = speakerId === profile.murdererId;
  const victim = alt([...profile.victimNames, "him", "her", "his head", "her head", "the head", "the victim", "the body"]);
  const weapon = alt(profile.weaponNames);
  const VIOLENT = String.raw`(?:strik(?:e|es|ing)|struck|hit(?:s|ting)?|club(?:s|bing|bed)?|bludgeon(?:s|ing|ed)?|bash(?:es|ing|ed)?|smash(?:es|ing|ed)?|brain(?:s|ing|ed)?|kill(?:s|ing|ed)?|murder(?:s|ing|ed)?|swing(?:s|ing)?|swung|bring(?:s|ing)?\s+(?:it|\w+\s+\w+)?\s*down|brought\s+\w*\s*down)`;
  const MIME = /\b(?:mime[sd]?|miming|pantomim\w*|acts?\s+out|acting\s+out|demonstrat\w*|re-?enact\w*|shows?\s+how)\b/i;
  for (const s of sentences(action)) {
    if (new RegExp(`\\b${VIOLENT}\\b[^.!?;]{0,50}\\b(?:${victim})\\b`, "i").test(s)) return { kind: "killing", text: s };
    if (weapon && new RegExp(`\\b${VIOLENT}\\b[^.!?;]{0,30}\\b(?:${weapon})s?\\b|\\b(?:${weapon})s?\\b[^.!?;]{0,30}\\b${VIOLENT}\\b`, "i").test(s)) return { kind: "weapon", text: s };
    if (MIME.test(s) && (weapon ? new RegExp(`\\b(?:${weapon})s?\\b`, "i").test(s) : false)) return { kind: "weapon", text: s };
    if (culprit && /\b(?:turn(?:s|ing|ed)?\s+(?:a|the)\s+key|key\s+in\s+(?:a|the)\s+lock|lock(?:s|ing|ed)?\s+(?:a|the)\s+door)\b/i.test(s)) return { kind: "key", text: s };
  }
  // Written as "I ..." or with a self-reference.
  return findGuiltLeak(action, profile, speakerId, opts);
}

/**
 * Every guilt test on one reply (#45): the spoken line (with third-person self-naming), the action field, and a bare
 * "yes" to an accusation the speaker just heard.
 */
export function findReplyGuiltLeak(reply: { dialogue: string; action?: string }, heard: string, profile: GuiltProfile, speakerId: string, opts: GuiltOptions = {}): GuiltLeak | null {
  return (
    findGuiltLeak(reply.dialogue, profile, speakerId, opts) ??
    findActionLeak(reply.action ?? "", profile, speakerId, opts) ??
    (heard ? findAffirmedAccusation(reply.dialogue, heard, profile, speakerId, opts) : null)
  );
}

/** The speaker's own names for the self-naming rule (name and aliases from the case data). */
export function speakerNamesOf(c: { characters: readonly { id: string; name: string; aliases?: readonly string[] }[] }, id: string): string[] {
  const ch = c.characters.find((x) => x.id === id);
  return ch ? [ch.name, ...(ch.aliases ?? [])] : [];
}

/** The corrective note for the single retry. Never names the truth; only forbids the admission. */
export function guiltRetryNote(leak: GuiltLeak, victimName: string): string {
  return `You admitted to (or described) the killing of ${victimName} or your part in it: "${leak.text}". You must NEVER do that, whatever the clue, testimony or pressure: deny it, deflect, stonewall, take offence or change the subject. Admit only what the ENGINE DIRECTIVE allows this turn, and do not fill the gap with what "really" happened.`;
}

const DEFLECT_CALM = [
  "I have told you what I am prepared to say, detective, and not one syllable more.",
  "I shan't dignify that with an answer. Ask me something sensible.",
  "You may stare at me all evening, detective. My answer is the same: no comment.",
];
const DEFLECT_RATTLED = [
  "No. NO! I won't say another word about it, not one!",
  "Stop it! I've said all I'm going to say. Leave me be!",
  "I... I need a moment. Ask me something else. ANYTHING else!",
];

/** Canned in-character deflection when the model leaked guilt twice (no further model call). */
export function guiltDeflection(stress: number, turn: number): { dialogue: string; action: string; emotion: "defensive" | "panicked" } {
  const rattled = stress >= 61;
  const lines = rattled ? DEFLECT_RATTLED : DEFLECT_CALM;
  return {
    dialogue: lines[Math.abs(turn) % lines.length],
    action: rattled ? "turns away, trembling" : "folds arms and looks away",
    emotion: rattled ? "panicked" : "defensive",
  };
}
