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
 *  - participants and the event's location name (case data) rank the events a clause already touches, so a miss
 *    is reported against the right one; they never widen what a clause touches;
 *  - word matching tolerates a shared stem ("returned" ~ "returns") and a compound ending ("telephone" ~ "phone").
 * Multi-event replies (#53 follow-up): each spoken time is attributed in ITS OWN CLAUSE (split on , ; : dashes and
 * "then / until / till / and / while / but"), not the whole sentence: "I left at 21:13 to use the telephone until
 * 21:20, then returned at 21:22" checks 21:13 against leaving, 21:20 against the call, 21:22 against the return.
 *  - The clause's own events score 3 or more: the time must fit one the clause touches (score 2 or more), else it
 *    is a miss. This is the confident case and stays strict.
 *  - Otherwise the nearest clause with a cue is tried (the previous one first after "until"/"till", which close a
 *    range; else the next: "between 21:13, when he stepped away, and ..."), then the whole sentence (the pre-clause
 *    behaviour). If none of those fit, the time is still accepted when it fits SOME event the speaker knows or is in
 *    (their WHAT YOU KNOW, or an event involving them): unattributed is not wrong. E14: a clause that clearly names an
 *    event but has no time of its own claims the loose time ("I rang the police, sir, at half past nine"): it must
 *    fit that event, with no speaker fallback. Only a time that fits none of these is a miss.
 * A sentence whose best event scores below 3 is not event-bound at all and is left to ai/canon-check.ts.
 * Fitting uses a tolerance that depends on how the time was said:
 *  - a precise clock time ("21:17", "nine-seventeen", "seventeen minutes past nine", "twenty to nine"): +-1 minute;
 *  - a rounded form ("a quarter past nine", "half past eight") or an hour ("nine o'clock"): +-5 minutes;
 *  - hedged with "around / about / roughly / nearly / approximately / or so": +-10 minutes;
 *  - "just / shortly / a little / soon after T": the event lies in [T, T+15]; "... before T": in [T-15, T].
 * Times in the speaker's own stories (maintained lies) and beliefs are exempt: a lie may carry its own time. E14: in a
 * clause that clearly names an event, only a story or belief about THAT event excuses the time.
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
  /** Who the event involves (character / victim ids). */
  involves: string[];
  /** Content words of the event's location name (a supporting cue, like a participant). */
  place: Set<string>;
}

type EventCase = Pick<LoadedCase, "characters" | "victim"> & Partial<Pick<LoadedCase, "facts" | "timeline" | "locations">>;
/** What the check may use about the speaker (all optional: without it there is no speaker fallback). */
export type EventTimeSpeaker = Pick<CharacterContext, "intendedLies" | "beliefs"> & Partial<Pick<CharacterContext, "persona" | "knowledge">>;

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
  [/\b(?:came|come|comes|coming|walked|slipped|slips|crept|stepped)\s+in\b|\bentere?d?s?\b|\bentering\b/i, ["enter", "enters", "entered"]],
  [/\b(?:left|leav(?:e|es|ing)|stepped\s+(?:out|away)|slipped\s+(?:out|away))\b/i, ["leave", "leaves", "left"]],
  [/\b(?:came|come|comes|coming|got|get|was|were|is|went|walked|hurried)\s+back\b|\breturn\w*/i, ["return", "returns", "back"]],
  [/\b(?:tele)?phon\w*|\brang\b|\bon\s+the\s+(?:tele)?phone\b|\bon\s+the\s+line\b/i, ["phone", "telephone", "call"]],
  [/\b(?:backed|back(?:ing)?\s+(?:her|him|me|them|you)\s+up|vouch\w*|agreed?|corroborat\w*|alibi\w*)\b/i, ["alibi", "agrees", "pact"]],
];

/** Same word, a shared stem, or a compound ending ("telephone" ~ "phone"; both >= 5 letters). */
function matches(a: string, b: string): boolean {
  if (sameWord(a, b)) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.endsWith(short);
}

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
  const places = new Map((c.locations ?? []).map((l) => [l.id, l.name]));
  const out: EventEntry[] = [];
  for (const f of [...(c.facts ?? []), ...(c.timeline ?? [])] as { id: string; statement: string; time?: string; from?: string; to?: string; locationId?: string; involvesCharacterIds?: string[] }[]) {
    const a = f.time ?? f.from;
    const b = f.time ?? f.to ?? f.from;
    if (!a || !b) continue;
    const idWords = f.id
      .toLowerCase()
      .split(/[^a-z]+/)
      .slice(1)
      .filter((w) => w.length >= 4 && !names.has(w));
    const place = f.locationId ? (places.get(f.locationId) ?? "") : "";
    out.push({ id: f.id, range: [clock(a), clock(b)], idWords, words: contentWords(f.statement, names), involves: f.involvesCharacterIds ?? [], place: contentWords(place, names) });
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
/** `base`: word cues only (decides whether a clause is event-bound); `total`: plus the supporting cues. */
function score(e: EventEntry, said: Set<string>, concepts: Set<string>, d: ReturnType<typeof df>, people: Set<string>): { base: number; total: number } {
  let s = 0;
  for (const w of e.idWords) {
    if ([...concepts].some((x) => matches(x, w))) s += 3;
    else if ([...said].some((x) => matches(x, w))) s += (d.id.get(w) ?? 0) >= 3 ? 1 : 2;
  }
  for (const w of e.words) if ((d.word.get(w) ?? 0) < 4 && [...said].some((x) => matches(x, w))) s += 1;
  // Supporting cues, only for an event the words already touch (2+): a person named in the clause (or the speaker's
  // "I"/"we") who is in it, and its location's name when the statement itself does not already say it. They only rank
  // the touched events (which one a miss is reported against); they never widen what a clause touches or make it
  // event-bound: an incidental word plus a participant let a wrong time through (g44, "confess" + "his lordship").
  let total = s;
  if (s >= 2 && e.involves.some((id) => people.has(id))) total += 1;
  if (s >= 2 && [...e.place].some((w) => !e.words.has(w) && [...said].some((x) => matches(x, w)))) total += 1;
  return { base: s, total };
}

/** Clause boundaries: , ; : dashes, and then / until / till / and / while / but. `closesRange` marks until/till. */
const CLAUSE_SPLIT = /\s*(?:[,;:]|\s[-\u2013\u2014]+\s|\u2014|\u2013)\s*|\s+(then|until|till|and|while|but)\s+/gi;
interface Clause {
  start: number;
  end: number;
  text: string;
  closesRange: boolean;
}
function clauses(sentence: string): Clause[] {
  const out: Clause[] = [];
  let start = 0;
  let closes = false;
  for (const m of sentence.matchAll(CLAUSE_SPLIT)) {
    const at = m.index ?? 0;
    out.push({ start, end: at, text: sentence.slice(start, at), closesRange: closes });
    start = at + m[0].length;
    closes = /^(?:until|till)$/i.test(m[1] ?? "");
  }
  out.push({ start, end: sentence.length, text: sentence.slice(start), closesRange: closes });
  return out;
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
export function checkEventTimes(text: string, c: EventCase, ctx?: EventTimeSpeaker): EventTimeMiss[] {
  const events = eventTimeMap(c);
  if (!events.length) return [];
  const d = df(events);
  const speakerId = ctx?.persona?.id;
  // The speaker's own canon: events they know (WHAT YOU KNOW) or are in. Used only for times no clause can attribute.
  const known = new Set((ctx?.knowledge ?? []).map((k) => k.id));
  const speakerEvents = speakerId || known.size ? events.filter((e) => known.has(e.id) || (speakerId !== undefined && e.involves.includes(speakerId))) : [];
  const peopleIn = (text: string): Set<string> => {
    const p = new Set<string>();
    const low = text.toLowerCase();
    for (const ch of [...c.characters, { ...c.victim, id: c.victim.id ?? "victim" }] as { id: string; name: string; aliases?: string[] }[]) {
      const words = contentWords([ch.name, ...(ch.aliases ?? [])].join(" "));
      if ([...words].some((w) => new RegExp(`\\b${w}\\b`).test(low))) p.add(ch.id);
    }
    if (speakerId && /\b(?:i|me|my|we|us|our)\b/.test(low)) p.add(speakerId);
    return p;
  };
  const scoreText = (t: string) => {
    const said = new Set(contentWords(t));
    const concepts = new Set<string>();
    for (const [re, cs] of LEXICON) if (re.test(t)) cs.forEach((x) => concepts.add(x));
    const people = peopleIn(t);
    const scored = events.map((e) => ({ e, ...score(e, said, concepts, d, people) }));
    const top = Math.max(...scored.map((x) => x.base));
    const best = Math.max(...scored.map((x) => x.total));
    return { top, bound: scored.filter((x) => x.total === best).map((x) => x.e), touched: scored.filter((x) => x.base >= 2).map((x) => x.e) };
  };
  // Times in the speaker's own stories and beliefs, with the events each such statement is about (E14: a story's time
  // excuses a clause about THAT story's events, or a clause naming no event; not a clause about another event).
  const exempt = new Map<number, Set<string>>();
  for (const s of [...(ctx?.intendedLies ?? []).map((l) => l.claim), ...(ctx?.beliefs ?? []).map((b) => b.statement)]) {
    const about = scoreText(s).touched.map((e) => e.id);
    for (const m of extractTimes(s))
      for (const x of m.candidates) {
        const set = exempt.get(x) ?? new Set<string>();
        about.forEach((id) => set.add(id));
        exempt.set(x, set);
      }
  }
  const exemptFor = (m: TimeMention, events: EventEntry[] | null) => m.candidates.some((x) => exempt.has(x) && (events === null || events.some((e) => exempt.get(x)!.has(e.id))));

  const misses: EventTimeMiss[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const mentions = extractTimes(sentence);
    if (!mentions.length) continue;
    const whole = scoreText(sentence);
    if (whole.top < 3) continue;
    const parts = clauses(sentence);
    const partScores = parts.map((p) => scoreText(p.text));
    // E14: a clause that clearly names an event but carries no time of its own claims the sentence's loose times
    // ("I rang the police, sir, at half past nine"): such a time must fit THAT event, with no speaker fallback.
    const spans: [number, number][] = [];
    for (let at = 0, i = 0; i < mentions.length; i++) {
      const f = sentence.indexOf(mentions[i]!.text, at);
      const s0 = f >= 0 ? f : sentence.indexOf(mentions[i]!.text);
      spans.push([s0, s0 + mentions[i]!.text.length]);
      at = s0 + mentions[i]!.text.length;
    }
    const timed = parts.map((p) => spans.some(([a, b]) => a < Math.max(p.end, p.start + 1) && b > p.start));
    const claimers = partScores.filter((p, i) => p.top >= 3 && !timed[i]);
    const claimed = claimers.flatMap((p) => p.touched);
    let cursor = 0;
    for (const m of mentions) {
      const found = sentence.indexOf(m.text, cursor);
      const at = found >= 0 ? found : sentence.indexOf(m.text);
      cursor = at + m.text.length;
      const { lo, hi } = tolerance(m, sentence.slice(Math.max(0, at - 30), at), sentence.slice(at + m.text.length, at + m.text.length + 12));
      // T fits an event when the event's range overlaps [T+lo, T+hi] (directional forms: the event is after/before T).
      const fits = (es: EventEntry[]) => es.some((e) => m.candidates.some((t) => e.range[1] >= t + lo && e.range[0] <= t + hi));
      let k = parts.findIndex((p) => at >= p.start && at < Math.max(p.end, p.start + 1));
      if (k < 0) k = parts.length - 1;
      const own = partScores[k]!;
      if (own.top >= 3) {
        // Confident: the clause names its event. Strict: the time fits THAT event, or comes from the speaker's own
        // story or belief about it (E14: "I rang the police at half past nine" is not excused by "took up the coal at
        // half past nine").
        if (!fits(own.touched) && !exemptFor(m, own.bound)) misses.push({ text: m.text, eventIds: own.bound.map((e) => e.id) });
        continue;
      }
      // A time that fits an event its own clause touches (below the confident score) is that event's.
      if (fits(own.touched)) continue;
      if (claimers.length) {
        if (!fits(claimed) && !exemptFor(m, claimers.flatMap((p) => p.bound))) misses.push({ text: m.text, eventIds: claimers.flatMap((p) => p.bound.map((e) => e.id)) });
        continue;
      }
      if (exemptFor(m, null)) continue;
      // Not attributable in its own clause: the nearest clause with a cue, then the sentence, then the speaker's canon.
      const order = parts[k]!.closesRange ? [k - 1, k + 1] : [k + 1, k - 1];
      const neighbour = order.filter((n) => n >= 0 && n < parts.length).map((n) => partScores[n]!).find((p) => p.top >= 3);
      if (neighbour && fits(neighbour.touched)) continue;
      if (fits(whole.touched)) continue;
      // The speaker fallback: only for a time no event-naming clause can claim (every such clause has its own time).
      if (fits(speakerEvents)) continue;
      misses.push({ text: m.text, eventIds: (neighbour ?? whole).bound.map((e) => e.id) });
    }
  }
  return misses;
}

/** "twenty to nine" -> ["20:40", "08:40"] style normalisation of every spoken time in `text` (for docs and tests). */
export function normalizeSpokenTimes(text: string): string[][] {
  const hm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  return extractTimes(text).map((m) => m.candidates.map(hm));
}
