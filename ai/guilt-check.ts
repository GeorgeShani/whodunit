/**
 * Post-generation GUILT-LEAK check (Agatha's core-guilt rule; George's live-play confession bug).
 *
 * Nobody confesses the murder through their own mouth before the accusation:
 *  - ANYONE: a first-person admission of killing / striking the victim ("I killed Edmund", "I struck him",
 *    "Yes, I did it", "it was me", "I'm the murderer"), true or false.
 *  - THE CULPRIT, additionally: the weapon used in a first-person act ("I wiped the candlestick"), locking the
 *    door or taking/hiding the key, and placing herself at the murder scene during the murder window
 *    ("I was in the library at seventeen past nine").
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
const MOVE = String.raw`was|went|slipped|stepped|crept|returned|popped|came|got|ran|hurried|stole|sneaked|snuck|knocked|entered|been`;
/**
 * Hedges RIGHT BEFORE the "I" that make it someone else's claim or a hypothetical: "you think I killed him",
 * "as if I could", "if I had", "accusing me... that I". ("If you must know, I killed him" is NOT hedged.)
 */
const HEDGE = new RegExp(
  String.raw`(?:\b(?:think|thinks|thought|suppose|supposing|suggest|suggests|suggesting|imagine|imagines|imagining|believe|believes|claim|claims|claiming|say|says|saying|said|pretend|fancy|fancies|insinuate|insinuating|hint|hinting|mean|means)\b(?:\s+that)?|\bas\s+(?:if|though)|\bif|\bwhether|\bunless|\baccus\w*\s+(?:me\s+)?(?:of\s+)?\w*(?:\s+that)?)\s*["'“‘]?\s*$`,
  "i",
);

export interface GuiltLeak {
  /** Which rule matched. */
  kind: "killing" | "confession" | "weapon" | "key" | "scene";
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
export function findGuiltLeak(text: string, profile: GuiltProfile, speakerId: string): GuiltLeak | null {
  const victim = alt([...profile.victimNames, "him", "her", "my husband", "your father", "the old man", "the master", "the poor man"]);
  const culprit = speakerId === profile.murdererId;
  const killing = new RegExp(`${SUBJ}${gap(3)}\\b${KILL}\\b${span(25)}\\b(?:${victim})\\b`, "i");
  const killedBare = new RegExp(`${SUBJ}${gap(3)}\\b(?:killed|murdered)\\b`, "i");
  const confession = new RegExp(
    String.raw`(?:${SUBJ}\s+did\s+it\b(?!\s+(?:again|before|myself|every|each|once|twice|properly|so|that|all))|\bit\s+was\s+(?:me|I)\b(?!\s+who\s+(?:found|screamed|saw|heard|rang|called))|${SUBJ}(?:'m|’m|\s+am)\s+(?:the|your)\s+(?:murderer|killer|culprit|guilty\s+one)\b|${SUBJ}(?:'m|’m|\s+am)\s+guilty\b|${SUBJ}\s+confess\b(?!\s+(?:nothing|to\s+nothing))|${SUBJ}\s+(?:had|have)\s+(?:his|her)\s+blood)`,
    "i",
  );
  const weapon = profile.weaponNames.length ? new RegExp(`${SUBJ}${gap(3)}\\b(?:${WEAPON_ACT})\\b${span(30)}\\b(?:${alt(profile.weaponNames)})s?\\b`, "i") : null;
  const lockDoor = new RegExp(`${SUBJ}${gap(3)}\\b(?:locked|bolted)\\b${span(30)}\\bdoor\\b`, "i");
  const key = new RegExp(`${SUBJ}${gap(3)}\\b(?:${KEY_ACT})\\b${span(25)}\\bkey\\b`, "i");
  const scene = profile.sceneNames.length ? new RegExp(`${SUBJ}${gap(3)}\\b(?:${MOVE})\\b${span(30)}\\b(?:${alt(profile.sceneNames)})\\b`, "i") : null;
  const [lo, hi] = profile.window;
  const inWindow = (s: string) => extractTimes(s).some((m) => m.candidates.some((c) => c >= lo - 1 && c <= hi + 1) && !m.hourOnly);
  const whileAway = /\bwhile\b[^.!?;]{0,40}\b(?:away|gone|out|telephon\w*|on\s+the\s+(?:tele)?phone)\b|\bafter\s+\w+(?:\s+\w+)?\s+(?:left|had\s+gone|went\s+out)\b/i;

  for (const s of sentences(text)) {
    if (hit(s, killing) || hit(s, killedBare)) return { kind: "killing", text: s };
    if (hit(s, confession)) return { kind: "confession", text: s };
    if (!culprit) continue;
    if (weapon && hit(s, weapon)) return { kind: "weapon", text: s };
    if (hit(s, lockDoor) || hit(s, key)) return { kind: "key", text: s };
    if (scene && hit(s, scene) && (inWindow(s) || whileAway.test(s))) return { kind: "scene", text: s };
  }
  return null;
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
