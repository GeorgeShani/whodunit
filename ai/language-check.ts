/**
 * #45 language gate. Every character in a case speaks period English (case one is an English country house), so a
 * reply in another language or script is rejected: the guard retries ONCE with a note to answer in English, in
 * character (a foreign question is met with polite incomprehension), then falls back to an in-character deflection.
 *
 * Why a gate and not multilingual guilt patterns: the guilt check is a list of English constructions; porting it to
 * es/fr/ka/... would never be complete (any language the model can write is a hole), while "is this English?" is one
 * cheap, closed question, and the personas already refuse foreign tongues. The player's input is not gated: a
 * foreign question still reaches the model, whose reply must be English.
 *
 * Heuristics (no model call): (1) non-Latin letters (Georgian, Cyrillic, Greek, CJK...) make up 10% or more of the
 * letters, or there are 4 or more of them; (2) any sentence of 3+ words with 2 or more foreign function words and
 * more foreign than English ones (Spanish, French, Italian, German, Portuguese). Common loan phrases ("c'est la vie",
 * "je ne sais quoi", "mon dieu") are ignored.
 */
const LOANS = /\b(?:c['’]est\s+la\s+vie|je\s+ne\s+sais\s+quoi|mon\s+dieu|ma\s+ch[eé]rie|mon\s+cher|comme\s+il\s+faut|de\s+rigueur|savoir[\s-]faire|joie\s+de\s+vivre|raison\s+d['’][eê]tre|n[eé]e|d[eé]j[aà]\s+vu|bon\s+voyage|bon\s+app[eé]tit|au\s+revoir|ma\s+foi|par\s+excellence|tout\s+de\s+suite|ad\s+nauseam|et\s+cetera|sotto\s+voce|mea\s+culpa|faux\s+pas|coup\s+de\s+gr[aâ]ce|en\s+route|vis-[aà]-vis|in\s+flagrante(?:\s+delicto)?|carte\s+blanche|dolce\s+far\s+niente|gott\s+in\s+himmel|mein\s+gott|madre\s+de\s+dios|bonjour|bonsoir|merci)\b/gi;
const FOREIGN = new Set(
  (
    "el la los las lo le les un una unos unas del al y o que de en con por para sin sí si yo tú usted él ella nosotros ellos mi mis su sus " +
    "es era fue soy estoy está estaba muy pero como cuando donde porque también ya no señor señora querido querida " +
    "je tu il elle nous vous ils elles mon ma mes ton ta tes son sa ses du des au aux et ou est était suis été avec pour dans sur sans " +
    "oui non mais très qui quoi où quand comme aussi l'ai j'ai c'est n'est d'un d'une qu'il monsieur madame " +
    "il lo gli della dello delle degli è sono ho ha non con per che una uno ma molto anche sì " +
    "der die das den dem des ein eine einen und oder ist war bin habe hat nicht mit für auf ich du er sie wir ihr aber sehr ja nein " +
    "eu você ele ela nós não com para uma um mas muito também sim é foi"
  ).split(/\s+/),
);
const ENGLISH = new Set(
  (
    "the a an and or of to in on at by for with from is was were are am be been i you he she it we they me him her us them my your his " +
    "its our their this that these those not no yes but if then so as do did does have had has what who whom where when why how which " +
    "will would shall should can could may might must there here all any some one very just only"
  ).split(/\s+/),
);
// Words in both lists count as English (e.g. "a", "no", "me", "on", "son" is French but also English).
for (const w of ENGLISH) FOREIGN.delete(w);

export interface LanguageVerdict {
  reason: "non_latin_script" | "foreign_language";
  text: string;
}

export function findForeignLanguage(text: string): LanguageVerdict | null {
  const letters = [...text.matchAll(/\p{L}/gu)].length;
  const nonLatin = [...text.matchAll(/(?![\p{Script=Latin}])\p{L}/gu)].map((m) => m[0]);
  if (nonLatin.length >= 4 || (letters > 0 && nonLatin.length / letters >= 0.1)) return { reason: "non_latin_script", text: nonLatin.slice(0, 20).join("") };
  const cleaned = text.replace(LOANS, " ");
  for (const s of cleaned.split(/(?<=[.!?…;])\s+/)) {
    const toks = s.toLowerCase().split(/[^\p{L}'’]+/u).filter(Boolean).map((t) => t.replace(/’/g, "'"));
    if (toks.length < 3) continue;
    const foreign = toks.filter((t) => FOREIGN.has(t)).length;
    const english = toks.filter((t) => ENGLISH.has(t)).length;
    if (foreign >= 2 && foreign > english) return { reason: "foreign_language", text: s.trim().slice(0, 120) };
  }
  return null;
}
