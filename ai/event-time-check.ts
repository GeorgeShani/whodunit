/**
 * #44 event-bound time check: a clock time spoken about an EVENT must be that event's canon time, not merely some
 * time the speaker has seen ("the argument at twenty to nine" when it was 20:54, "I burned the letter at half past
 * eight" when it was 21:20, "the lights went out at nine o'clock" when it was 21:10).
 *
 * The event-time map is built from the case data (facts + timeline with a time or range; server-side truth, never sent
 * to the model):
 *  - each event's cue words are its id tokens (weight 2, minus the "ev"/"f" prefix and people's names: "ev-paper-burned"
 *    gives note, burned) and its statement's content words (weight 1);
 *  - a small, case-agnostic English phrase lexicon maps common phrasings onto concept words that ids use ("the lights
 *    went out" -> blackout, "quarrel" -> argument, "overheard" -> overhears, "into the fire" -> burned), weight 3 on an
 *    id token.
 * A sentence with a spoken time binds to the event(s) with the top score, if that score is at least 3. The time must
 * then fit one of the events the sentence touches (score 2 or more; a sentence may name two events, "between 21:13,
 * when he stepped away, and 21:22, when he returned"), within a tolerance that depends on how it was said:
 *  - a precise clock time ("21:17", "nine-seventeen", "seventeen minutes past nine", "twenty to nine"): +-1 minute;
 *  - a rounded form ("a quarter past nine", "half past eight") or an hour ("nine o'clock"): +-5 minutes;
 *  - hedged with "around / about / roughly / nearly / approximately / or so": +-10 minutes;
 *  - "just / shortly / a little / soon after T": the event lies in [T, T+15]; "... before T": in [T-15, T].
 * Times in the speaker's own stories (maintained lies) and beliefs are exempt: a lie may carry its own time.
 * Unbound sentences are left to the existing subject-bound check (ai/canon-check.ts).
 */
import type { LoadedCase } from "@/engine/case-schema";
import type { CharacterContext } from "@/engine/context-builder";
import { contentWords, nameWords, sameWord } from "@/engine/memory";
import { extractTimes, type TimeMention } from "./canon-check";

export const EVENT_TIME_TOLERANCE = { exact: 1, rounded: 5, hedged: 10, directional: 15 } as const;

interface EventEntry {
  id: string;
  range: [number, number];
  idWords: string[];
  words: Set<string>;
}

type EventCase = Pick<LoadedCase, "characters" | "victim"> & Partial<Pick<LoadedCase, "facts" | "timeline">>;

/** Common English phrasings of typical events -> the concept word an authored id is likely to use. */
const LEXICON: [RegExp, string[]][] = [
  [/\blights?\s+(?:went|go|goes|going|were|was|had\s+gone)\s+out\b|\blights?\s+fail\w*|\bpower\s+(?:failed|went|was\s+cut)\b|\bwent\s+dark\b|\bblack-?out\b/i, ["blackout"]],
  [/\blights?\s+(?:came|come|were|was)\s+(?:back|on)\b|\blights?\s+(?:returned|restored)\b|\bpower\s+came\s+back\b/i, ["restored"]],
  [/\b(?:quarrel\w*|rows?|rowed|rowing|had\s+words|argu\w*|spat|dispute\w*|chat)\b/i, ["argument"]],
  [/\b(?:burn\w*|burnt|into\s+the\s+fire|in\s+the\s+grate|in\s+the\s+flames)\b/i, ["burned"]],
  [/\b(?:overh[ea]\w*|eavesdrop\w*)\b/i, ["overhears"]],
  [/\b(?:scream\w*|shriek\w*)\b/i, ["scream"]],
  [/\b(?:dinner|supper)\b/i, ["dinner"]],
  [/\bfound\s+(?:him|her|the\s+body)|\bdiscover\w*\s+(?:him|her|the\s+body)\b/i, ["discovered"]],
  [/\b(?:forced|broke|burst|shouldered)\b[^.!?]{0,20}\bdoor\b/i, ["forced"]],
];

const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const cache = new WeakMap<object, EventEntry[]>();

/** The event-time map of a case (cached). */
export function eventTimeMap(c: EventCase): EventEntry[] {
  const hit = cache.get(c);
  if (hit) return hit;
  const names = nameWords(c);
  const out: EventEntry[] = [];
  for (const f of [...(c.facts ?? []), ...(c.timeline ?? [])] as { id: string; statement: string; time?: string; from?: string; to?: string }[]) {
    const a = f.time ?? f.from;
    const b = f.time ?? f.to ?? f.from;
    if (!a || !b) continue;
    const idWords = f.id
      .toLowerCase()
      .split(/[^a-z]+/)
      .slice(1)
      .filter((w) => w.length >= 4 && !names.has(w));
    out.push({ id: f.id, range: [clock(a), clock(b)], idWords, words: contentWords(f.statement, names) });
  }
  cache.set(c, out);
  return out;
}

/** How many events use each id token / statement word: a word shared by many events ("door") tells nothing. */
const dfCache = new WeakMap<EventEntry[], { id: Map<string, number>; word: Map<string, number> }>();
function df(events: EventEntry[]) {
  let d = dfCache.get(events);
  if (!d) {
    d = { id: new Map(), word: new Map() };
    for (const e of events) {
      for (const w of new Set(e.idWords)) d.id.set(w, (d.id.get(w) ?? 0) + 1);
      for (const w of e.words) d.word.set(w, (d.word.get(w) ?? 0) + 1);
    }
    dfCache.set(events, d);
  }
  return d;
}

/** Id tokens weigh 2 (3 through the lexicon), 1 when three or more events share them; statement words weigh 1, 0 when four or more events share them. */
function score(e: EventEntry, said: Set<string>, concepts: Set<string>, d: ReturnType<typeof df>): number {
  let s = 0;
  for (const w of e.idWords) {
    if (concepts.has(w)) s += 3;
    else if ([...said].some((x) => sameWord(x, w))) s += (d.id.get(w) ?? 0) >= 3 ? 1 : 2;
  }
  for (const w of e.words) if ((d.word.get(w) ?? 0) < 4 && [...said].some((x) => sameWord(x, w))) s += 1;
  return s;
}

function tolerance(m: TimeMention, before: string, after: string): { lo: number; hi: number } {
  if (/\b(?:just|shortly|a\s+little|soon|right|not\s+long)\s+after\s*$/i.test(before)) return { lo: 0, hi: EVENT_TIME_TOLERANCE.directional };
  if (/\b(?:just|shortly|a\s+little|right|not\s+long)\s+before\s*$/i.test(before)) return { lo: -EVENT_TIME_TOLERANCE.directional, hi: 0 };
  if (/\b(?:around|about|roughly|nearly|almost|approximately|circa|some\s*time\s+(?:around|about)?)\s*(?:at\s+)?$/i.test(before) || /^\s*or\s+so\b/i.test(after))
    return { lo: -EVENT_TIME_TOLERANCE.hedged, hi: EVENT_TIME_TOLERANCE.hedged };
  if (m.hourOnly || m.rounded) return { lo: -EVENT_TIME_TOLERANCE.rounded, hi: EVENT_TIME_TOLERANCE.rounded };
  return { lo: -EVENT_TIME_TOLERANCE.exact, hi: EVENT_TIME_TOLERANCE.exact };
}

export interface EventTimeMiss {
  text: string;
  eventIds: string[];
}

/** Times in `text` attached to an event at the wrong time; [] = fine. */
export function checkEventTimes(text: string, c: EventCase, ctx?: Pick<CharacterContext, "intendedLies" | "beliefs">): EventTimeMiss[] {
  const events = eventTimeMap(c);
  if (!events.length) return [];
  const exempt = new Set<number>();
  for (const s of [...(ctx?.intendedLies ?? []).map((l) => l.claim), ...(ctx?.beliefs ?? []).map((b) => b.statement)]) for (const m of extractTimes(s)) m.candidates.forEach((x) => exempt.add(x));
  const misses: EventTimeMiss[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const mentions = extractTimes(sentence);
    if (!mentions.length) continue;
    const said = new Set(contentWords(sentence));
    const concepts = new Set<string>();
    for (const [re, cs] of LEXICON) if (re.test(sentence)) cs.forEach((x) => concepts.add(x));
    const d = df(events);
    const scored = events.map((e) => ({ e, s: score(e, said, concepts, d) }));
    const top = Math.max(...scored.map((x) => x.s));
    if (top < 3) continue;
    // Bound to the top event(s); a time is still fine if it fits ANY event the sentence clearly touches (score >= 2):
    // "between 21:13, when he stepped away, and 21:22, when he returned" names two events in one sentence.
    const bound = scored.filter((x) => x.s === top).map((x) => x.e);
    const touched = scored.filter((x) => x.s >= 2).map((x) => x.e);
    for (const m of mentions) {
      if (m.candidates.some((x) => exempt.has(x))) continue;
      const at = sentence.indexOf(m.text);
      const { lo, hi } = tolerance(m, sentence.slice(Math.max(0, at - 30), at), sentence.slice(at + m.text.length, at + m.text.length + 12));
      // T fits an event when the event's range overlaps [T+lo, T+hi] (directional forms: the event is after/before T).
      const fits = touched.some((e) => m.candidates.some((t) => e.range[1] >= t + lo && e.range[0] <= t + hi));
      if (!fits) misses.push({ text: m.text, eventIds: bound.map((e) => e.id) });
    }
  }
  return misses;
}

/** "twenty to nine" -> ["20:40", "08:40"] style normalisation of every spoken time in `text` (for docs and tests). */
export function normalizeSpokenTimes(text: string): string[][] {
  const hm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  return extractTimes(text).map((m) => m.candidates.map(hm));
}
