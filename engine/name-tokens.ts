/**
 * C3 (DX3): which single words of a multi-word name may stand for the whole name in the guilt check.
 *
 * guiltProfile splits names into words so a surname or the weapon's head noun alone still count. Ordinary English words from
 * multi-word names ("the Marmalade KING", "Boat DECK", "Spread the BRINE") would then trip the check on innocent
 * lines, so they are dropped: a generic stoplist, plus the case's own `guiltCheck.ignoreNameTokens`, minus its
 * `guiltCheck.keepNameTokens`. Full names always count. Pure and case-agnostic.
 */
export const COMMON_NAME_WORDS: ReadonlySet<string> = new Set([
  // places and parts of buildings / ships
  "room", "hall", "house", "manor", "garden", "gardens", "kitchen", "quarters", "cellar", "attic", "study", "tower", "gate", "yard", "court", "park",
  "wood", "woods", "field", "river", "lake", "pond", "beach", "lane", "road", "street", "square", "chapel", "church", "office", "shop", "store",
  "club", "salon", "saloon", "parlour", "parlor", "lounge", "deck", "cabin", "boat", "ship", "yacht", "bridge", "dock", "pier", "harbor", "harbour",
  "galley", "hold", "stair", "stairs", "landing", "corridor", "passage", "wing", "west", "east", "north", "south", "upper", "lower", "main",
  // titles, roles and family words
  "king", "queen", "prince", "princess", "duke", "duchess", "lord", "lady", "dame", "master", "mistress", "captain", "commodore", "chief",
  "doctor", "colonel", "major", "general", "uncle", "aunt", "auntie", "father", "mother", "sister", "brother", "cousin", "madam", "miss",
  "great", "grand", "little", "young", "elder",
  // ordinary nouns and adjectives that turn up in nicknames and brand names
  "marmalade", "brine", "pickle", "pickles", "orange", "oranges", "honey", "sugar", "salt", "bitter", "sweet", "golden", "silver", "iron",
  "stone", "glass", "brass", "black", "white", "green", "blue", "red", "grey", "gray", "old", "new", "good", "bad", "best", "last", "first",
]);

export interface NameTokenOptions {
  ignoreNameTokens?: readonly string[];
  keepNameTokens?: readonly string[];
}

/** May this word of a multi-word name stand alone in the guilt check? */
export function keepNameToken(word: string, o: NameTokenOptions = {}): boolean {
  const w = word.toLowerCase();
  if (o.keepNameTokens?.includes(w)) return true;
  return !COMMON_NAME_WORDS.has(w) && !o.ignoreNameTokens?.includes(w);
}
