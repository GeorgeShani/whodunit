/**
 * #48 "never deny what you have admitted": once the engine has revealed a secret, the character may not retract it,
 * breakdowns included. Cheap, data-driven cues (no model call):
 *
 *  (a) negation of the secret's key claim: a denial ("I know nothing of any will", "I never burned the letter",
 *      "there was no will", "I never left the dining room") whose object is one of the secret's KEY TERMS. Key terms
 *      are the content words of the secret's own description and testimony summary, minus people's names, minus
 *      the murder's own vocabulary (victim, weapon, scene, core-guilt objects: the culprit may always deny THOSE) and
 *      minus generic words. The object must follow a determiner ("any will", "the letter") or "no", so the modal
 *      "will" or a verb never counts.
 *  (b) a superseded story coming back: a lie whose supersededBySecretIds lists the revealed secret, restated (two or
 *      more of its distinctive words, at least 40% of them, or three or more). Distinctive = the claim's content
 *      words not shared with the secret's own text or names.
 *
 * Case-agnostic: every term comes from the case data.
 */
import type { GuiltProfile } from "@/engine/core-guilt";
import type { LoadedCase } from "@/engine/case-schema";
import { contentWords, nameWords, sameWord } from "@/engine/memory";

export interface Retraction {
  secretId: string;
  kind: "denies_key_claim" | "restates_superseded_story";
  text: string;
}

/** Generic words never worth treating as a secret's key claim. */
const GENERIC = new Set(
  (
    "about above after again against also always among another before being below between both came come could does doing done down " +
    "during each else even ever every evening from going gone have having here into just know knew last like made make many more most " +
    "much must myself never night nothing once only other over perhaps quite said same shall should since some something still such " +
    "than that their them then there these they thing this those though through told tonight under until upon very want were what when " +
    "which while whole with without would your admits admitted admit agree agreed claim claims away back while murder murdered killed " +
    "kill killing death dead body crime husband wife lord lady master mistress sister brother father mother time minute moment house " +
    "room door hall night evening someone something anyone everyone where went said says say asked business lordship ladyship meant " +
    "mean sign been outside inside stop dark darkness light lights lightning flash thunder storm rain candle candles blackout fire"
  ).split(/\s+/),
);
const DET = "(?:any|the|a|an|that|this|his|her|their|my|such|some|those|these)";
// Gap words between a negation and its object: never a new clause (pronoun), never a "not just / not only" contrast,
// never a preposition ("didn't see nothing IN the dark" denies the seeing, not the dark).
const GAP_WORD = "(?!(?:i|we|he|she|they|you|it|just|only|merely|simply|because|for|but|sorry|ashamed|proud|in|at|on|by|from|into|during|near|to|with|of|after|before)\\b)[a-z'’-]+";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Three-letter words are kept ("rum", "gun") unless they are function words. */
const SHORT_STOP = new Set("the and for was but not she her his him who why how all any own one two out off saw see met put got had has did are you our its way day man men new old now yes may can too lit sat ran let say end yet nor per via who whom get set use".split(" "));
const words = (t: string) => t.toLowerCase().replace(/[’']/g, "").split(/[^a-z]+/).filter((w) => w.length >= 4 || (w.length === 3 && !SHORT_STOP.has(w)));

/** The key terms of a secret (see the header). */
export function keyTerms(text: string, exclude: ReadonlySet<string>): string[] {
  // A word right after a subject pronoun is a verb or modal there ("she will not say", "she burned"): it only counts
  // if it also occurs somewhere else.
  const toks = text.toLowerCase().replace(/[’']/g, "").split(/[^a-z]+/).filter(Boolean);
  const nounish = new Set(toks.filter((w, i) => !/^(?:i|we|he|she|they|you|it|who)$/.test(toks[i - 1] ?? "")));
  return [...new Set(words(text).filter((w) => nounish.has(w) && !GENERIC.has(w) && !exclude.has(w)))];
}

function guiltWords(g: GuiltProfile): Set<string> {
  return new Set([...g.victimNames, ...g.weaponNames, ...g.sceneNames, ...g.coreObjects].flatMap((n) => words(n)));
}

function deniesTerm(sentence: string, term: string): string | null {
  const t = `${esc(term)}s?`;
  const res = [
    new RegExp(`\\b(?:know|knew|knows|heard|hear)\\s+(?:absolutely\\s+)?nothing\\s+(?:of|about)\\s+(?:${DET}\\s+)?(?:${GAP_WORD}\\s+){0,2}?${t}\\b`, "i"),
    new RegExp(`\\b(?:never|not|didn['’]?t|don['’]?t|haven['’]?t|hadn['’]?t|wasn['’]?t|weren['’]?t|isn['’]?t)\\b(?:\\s+${GAP_WORD}){0,3}?\\s+${DET}\\s+(?:${GAP_WORD}\\s+){0,2}?${t}\\b`, "i"),
    new RegExp(`\\b(?:there\\s+(?:was|is|were)\\s+)?no\\s+(?:such\\s+)?(?:${GAP_WORD}\\s+)?${t}\\b`, "i"),
  ];
  for (const re of res) {
    const m = re.exec(sentence);
    if (m) return m[0];
  }
  return null;
}

/** The first retraction of a revealed secret in `dialogue`, or null. */
export function findRetraction(
  dialogue: string,
  c: Pick<LoadedCase, "characters" | "victim">,
  characterId: string,
  revealedIds: readonly string[],
  guilt: GuiltProfile,
): Retraction | null {
  const ch = c.characters.find((x) => x.id === characterId);
  if (!ch || !revealedIds.length) return null;
  const names = nameWords(c);
  const exclude = new Set([...names, ...guiltWords(guilt)]);
  const sentences = dialogue.split(/(?<=[.!?…;—])\s+|\s+[—–]\s*/).filter(Boolean);
  const said = new Set(words(dialogue));
  for (const id of revealedIds) {
    const s = ch.secrets.find((x) => x.id === id);
    if (!s) continue;
    const own = `${s.description} ${s.testimonySummary ?? ""}`;
    // (a) Denial of a key term.
    for (const term of keyTerms(own, exclude)) {
      for (const sentence of sentences) {
        const hit = deniesTerm(sentence, term);
        if (hit) return { secretId: id, kind: "denies_key_claim", text: hit };
      }
    }
    // (b) A superseded story restated.
    const ownWords = new Set(words(own));
    for (const lie of ch.intendedLies.filter((l) => l.supersededBySecretIds.includes(id))) {
      const distinct = [...contentWords(lie.claim, exclude)].filter((w) => ![...ownWords].some((o) => sameWord(o, w)));
      const hits = distinct.filter((w) => [...said].some((x) => sameWord(x, w)));
      if (hits.length >= 3 || (hits.length >= 2 && hits.length / distinct.length >= 0.4)) return { secretId: id, kind: "restates_superseded_story", text: hits.join(", ") };
    }
  }
  return null;
}
