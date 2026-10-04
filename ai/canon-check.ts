/**
 * Deterministic canon post-check for model dialogue (issue #6).
 *
 * The model may only state clock times that appear in its own scoped context
 * (knowledge tags and ranges, its stories, admitted secrets, clues shown, the
 * public case facts, the conversation). Since the #6 follow-up a time said
 * about a named person or place must also come from a fact about THAT subject
 * (see checkTimes); e.g. a butler may not reuse his own 20:45 kitchen time
 * for when someone else left a room. extractTimes() finds clock times in
 * free text: "21:20", "9.20", "twenty past nine", "quarter to ten",
 * "half past nine", "half nine", "seventeen minutes past nine",
 * "nine o'clock" (hour-only, ±5 min), "a quarter past nine" / "half past nine" (rounded, ±3 min), "nine fifteen", "twenty-one hundred", "9 pm". A 12-hour
 * reading may mean h or h+12. Anything not in the allowed set fails the check,
 * and the caller retries once, then falls back.
 */
import type { CharacterContext } from "@/engine/context-builder";
import type { TurnDirectives } from "./prompts/interrogation";

export interface TimeMention {
  /** The matched text. */
  text: string;
  /** Candidate readings in minutes after midnight (12-hour readings give two). */
  candidates: number[];
  /** Hour-only mention ("nine o'clock", "9 pm"): allowed within HOUR_ONLY_TOLERANCE. */
  hourOnly: boolean;
  /** "a quarter past nine", "half past nine": a rounded way of speaking, allowed within ROUNDED_TOLERANCE. */
  rounded?: boolean;
}

const HOUR_ONLY_TOLERANCE = 5;
/** People say "a quarter past nine" for 21:17 (#23); a rounded phrase may be a couple of minutes off a time they know. */
const ROUNDED_TOLERANCE = 3;

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

const UNIT_RE = Object.keys(UNITS).filter((w) => w !== "zero" && w !== "oh").join("|");
const TENS_RE = Object.keys(TENS).join("|");
/** A number word 1..59: "nine", "twenty", "twenty-one", "twenty one". */
const NUM = `(?:(?:${TENS_RE})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|${UNIT_RE}|\\d{1,2})`;

function num(word: string): number | null {
  const w = word.toLowerCase().trim();
  if (/^\d{1,2}$/.test(w)) return Number(w);
  const parts = w.split(/[- ]/);
  if (parts.length === 2 && TENS[parts[0]] !== undefined && UNITS[parts[1]] !== undefined) return TENS[parts[0]] + UNITS[parts[1]];
  if (TENS[w] !== undefined) return TENS[w];
  if (UNITS[w] !== undefined) return UNITS[w];
  return null;
}

function readings(h: number, m: number): number[] {
  if (h < 0 || h > 24 || m < 0 || m > 59) return [];
  const hh = h % 24;
  const out = [hh * 60 + m];
  if (hh >= 1 && hh <= 12) out.push(((hh + 12) % 24) * 60 + m);
  return out;
}

const minuteOf = (w: string) => (/^quarter$/i.test(w) ? 15 : /^half$/i.test(w) ? 30 : num(w));

export function extractTimes(text: string): TimeMention[] {
  const out: TimeMention[] = [];
  const taken: [number, number][] = [];
  const add = (re: RegExp, f: (m: RegExpExecArray) => { c: number[]; hourOnly?: boolean; rounded?: boolean } | null) => {
    for (const m of text.matchAll(re)) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      const r = f(m as RegExpExecArray);
      if (!r || r.c.length === 0) continue;
      taken.push([s, e]);
      out.push({ text: m[0].trim(), candidates: r.c, hourOnly: Boolean(r.hourOnly), ...(r.rounded ? { rounded: true } : {}) });
    }
  };
  // Order matters: most specific patterns first; later matches may not overlap earlier ones.
  // Clock times first, so the digits of "21:13 to 21:22" are never read as "13 minutes to 21" (#26 follow-up).
  add(new RegExp(`(?<![£$€\\d.])\\b(\\d{1,2})[:.](\\d{2})\\b(?!\\.\\d)`, "g"), (m) => ({ c: readings(Number(m[1]), Number(m[2])) }));
  add(new RegExp(`\\b(quarter|half|${NUM})(?:\\s+minutes?)?\\s+(past|after|to|before|till|til)\\s+(${NUM})\\b`, "gi"), (m) => {
    const mins = minuteOf(m[1]);
    const h = num(m[3]);
    if (mins === null || h === null || mins > 59 || h > 24) return null;
    const back = /^(to|before|till|til)$/i.test(m[2]);
    const r = readings(h, 0).map((t) => (t + (back ? -mins : mins) + 1440) % 1440);
    return { c: r, rounded: /^(quarter|half)$/i.test(m[1]) };
  });
  add(new RegExp(`\\bhalf\\s+(${NUM})\\b`, "gi"), (m) => {
    const h = num(m[1]);
    return h === null || h > 12 ? null : { c: readings(h, 30), rounded: true };
  });
  add(new RegExp(`\\b(${NUM})\\s+hundred(?:\\s+hours)?\\b`, "gi"), (m) => {
    const h = num(m[1]);
    return h === null || h > 24 ? null : { c: readings(h, 0) };
  });
  add(new RegExp(`\\b(${NUM})\\s*(?:o'?\\s?clock|o’clock|(?:a\\.?m\\.?|p\\.?m\\.?)(?![a-z]))`, "gi"), (m) => {
    const h = num(m[1]);
    return h === null || h > 24 ? null : { c: readings(h, 0), hourOnly: true };
  });
  // "nine fifteen", "twenty-one ten", "nine oh five": hour word then minute word.
  const WORD_NUM = NUM.replace("|\\d{1,2})", ")");
  add(new RegExp(`\\b(${WORD_NUM})\\s+(oh\\s+(?:${UNIT_RE})|${WORD_NUM})\\b`, "gi"), (m) => {
    const h = num(m[1]);
    const mm = m[2].toLowerCase().startsWith("oh") ? num(m[2].slice(2)) : num(m[2]);
    if (h === null || mm === null || h > 23 || mm < 10 && !m[2].toLowerCase().startsWith("oh")) return null;
    if (mm > 59) return null;
    return { c: readings(h, mm) };
  });
  return out;
}

const hm = (t?: string) => {
  const m = t && /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Minutes covered by a knowledge item's tag: its point, or every minute of its window. */
function tagMinutes(k: { time?: string; from?: string; to?: string }): number[] {
  const out: number[] = [];
  const t = hm(k.time);
  if (t !== null) out.push(t);
  const a = hm(k.from);
  const b = hm(k.to);
  if (a !== null && b !== null) for (let x = a; x !== (b + 1) % 1440; x = (x + 1) % 1440) out.push(x);
  return out;
}

// ---------------------------------------------------------------------------
// Subjects: who / where a sentence is about (#6 follow-up)
// ---------------------------------------------------------------------------

const TITLES = new Set(["lady", "lord", "mr", "mrs", "miss", "ms", "sir", "dr", "the", "madam", "master", "old", "young"]);
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phrase = (x: string) => esc(x.trim()).replace(/[-\s]+/g, "[-\\s]+");

interface Subject {
  /** Character/victim id, or "loc:<locationId>". */
  key: string;
  re: RegExp;
}

/** Name / alias / id patterns for every person and place this character can talk about. */
export function buildSubjects(ctx: CharacterContext): Subject[] {
  const people = [
    { id: ctx.persona.id, name: ctx.persona.name, aliases: ctx.persona.aliases ?? [] },
    ...ctx.case.otherCharacters.map((o) => ({ id: o.id, name: o.name, aliases: o.aliases ?? [] })),
    ...(ctx.case.victim.id ? [{ id: ctx.case.victim.id, name: ctx.case.victim.name, aliases: ctx.case.victim.aliases ?? [] }] : []),
  ];
  // A single name part (a first name) identifies someone only if nobody else shares it (a family surname).
  const partOwners = new Map<string, Set<string>>();
  const partsOf = (name: string) =>
    name
      .split(/[\s-]+/)
      .map((w) => w.replace(/[^A-Za-z']/g, ""))
      .filter((w) => w.length >= 3 && !TITLES.has(w.toLowerCase()));
  for (const p of people) for (const w of [...partsOf(p.name), ...partsOf(p.id)]) {
    const k = w.toLowerCase();
    partOwners.set(k, (partOwners.get(k) ?? new Set()).add(p.id));
  }
  const subjects: Subject[] = people.map((p) => {
    const alts = new Set<string>([phrase(p.name), phrase(p.id), ...p.aliases.map(phrase)]);
    for (const w of [...partsOf(p.name), ...partsOf(p.id)]) if (partOwners.get(w.toLowerCase())?.size === 1) alts.add(phrase(w));
    return { key: p.id, re: new RegExp(`\\b(?:${[...alts].join("|")})\\b`, "i") };
  });
  for (const l of ctx.case.locations) {
    const alts = new Set<string>([phrase(l.name.replace(/^the\s+/i, "")), phrase(l.id)]);
    subjects.push({ key: `loc:${l.id}`, re: new RegExp(`\\b(?:${[...alts].join("|")})\\b`, "i") });
  }
  return subjects;
}

const detect = (subjects: Subject[], text: string) => new Set(subjects.filter((s) => s.re.test(text)).map((s) => s.key));
const FIRST_PERSON = /\b(?:I|I'm|I'd|I've|me|my|myself|we|us|our)\b/;

export interface CanonTimes {
  /** Times allowed whatever the sentence is about: stories, confessions, clues, the conversation, public case facts. */
  general: Set<number>;
  /** Times from WHAT YOU KNOW, each with the subjects (people/places) its fact is about. */
  facts: { minutes: number[]; subjects: Set<string> }[];
  subjects: Subject[];
  selfId: string;
}

/** Allowed clock times for one reply, keyed by subject where the character's knowledge says who/where. */
export function canonTimes(ctx: CharacterContext, d: TurnDirectives, question: string): CanonTimes {
  const subjects = buildSubjects(ctx);
  const general = new Set<number>();
  const f = hm(ctx.case.victim.foundAt);
  if (f !== null) general.add(f);
  const texts = [
    ctx.case.victim.foundAt,
    ctx.case.victim.description,
    ctx.case.victim.causeOfDeath,
    ctx.persona.bio,
    ...ctx.goals,
    ...ctx.beliefs.map((b) => b.statement),
    ...ctx.intendedLies.map((l) => `${l.topic ?? ""} ${l.claim}`),
    ...ctx.secrets.map((s) => s.description),
    ...ctx.evidenceShown.map((e) => e.description),
    ...(ctx.testimonyShown ?? []).map((t) => t.summary),
    ...ctx.memory.map((m) => m.text),
    ...ctx.statements.map((s) => s.text),
    d.revealSecret?.description ?? "",
    d.presentedEvidence?.description ?? "",
    d.presentedTestimony?.summary ?? "",
    question,
  ];
  for (const m of extractTimes(texts.join("\n"))) for (const c of m.candidates) general.add(c);

  const facts = ctx.knowledge.map((k) => {
    const minutes = tagMinutes(k);
    for (const m of extractTimes(k.statement)) minutes.push(...m.candidates);
    const subj = new Set<string>([...(k.involves ?? []), ...(k.locationId ? [`loc:${k.locationId}`] : []), ...detect(subjects, k.statement)]);
    return { minutes, subjects: subj };
  });
  return { general, facts, subjects, selfId: ctx.persona.id };
}

/** Every allowed time regardless of subject (the pre-#6-follow-up rule; still the fallback). */
export function allowedTimes(ctx: CharacterContext, d: TurnDirectives, question: string): Set<number> {
  return flatten(canonTimes(ctx, d, question));
}

function flatten(c: CanonTimes): Set<number> {
  const all = new Set(c.general);
  for (const f of c.facts) f.minutes.forEach((m) => all.add(m));
  return all;
}

export interface CanonCheckResult {
  ok: boolean;
  /** Mentions that match no allowed time. */
  offending: string[];
}

function matches(m: TimeMention, allowed: Set<number>): boolean {
  const tol = m.hourOnly ? HOUR_ONLY_TOLERANCE : m.rounded ? ROUNDED_TOLERANCE : 0;
  return m.candidates.some((c) => {
    for (let dx = -tol; dx <= tol; dx++) if (allowed.has((c + dx + 1440) % 1440)) return true;
    return false;
  });
}

/** Sentences, then clauses joined by and/but/while/dashes. */
function clauses(text: string): { text: string; sentence: number }[] {
  const out: { text: string; sentence: number }[] = [];
  text.split(/(?<=[.!?;])\s+|\n+/).forEach((sentence, i) => {
    for (const c of sentence.split(/\s+(?:and|but|while|whereas)\s+|\s+[—–]\s*|\s+--\s+/i)) if (c.trim()) out.push({ text: c, sentence: i });
  });
  return out;
}

/**
 * Every clock time in the dialogue must be allowed.
 * With a Set: any allowed time passes (legacy rule).
 * With CanonTimes (#6 follow-up): a time in a clause that names a person or place must match a fact
 * the character knows ABOUT that subject (or a general time: their stories, confessions, clues, the
 * conversation). A clause naming nobody but speaking in the first person is about the speaker; a clause
 * with no subject inherits the previous clause's subjects in the same sentence; if the sentence names
 * no subject at all, any allowed time passes.
 */
export function checkTimes(dialogue: string, allowed: Set<number> | CanonTimes): CanonCheckResult {
  const offending: string[] = [];
  if (allowed instanceof Set) {
    for (const m of extractTimes(dialogue)) if (!matches(m, allowed)) offending.push(m.text);
    return { ok: offending.length === 0, offending };
  }
  const all = flatten(allowed);
  let prev: { sentence: number; subjects: Set<string> } | null = null;
  for (const c of clauses(dialogue)) {
    let subjects = detect(allowed.subjects, c.text);
    if (subjects.size === 0 && FIRST_PERSON.test(c.text)) subjects = new Set([allowed.selfId]);
    if (subjects.size === 0 && prev && prev.sentence === c.sentence) subjects = prev.subjects;
    if (subjects.size > 0) prev = { sentence: c.sentence, subjects };
    const mentions = extractTimes(c.text);
    if (mentions.length === 0) continue;
    let pool = all;
    if (subjects.size > 0) {
      pool = new Set(allowed.general);
      for (const f of allowed.facts) if ([...f.subjects].some((s) => subjects.has(s))) f.minutes.forEach((m) => pool.add(m));
    }
    for (const m of mentions) if (!matches(m, pool)) offending.push(m.text);
  }
  return { ok: offending.length === 0, offending };
}

/** Modern / meta words a 1920s character must never say (#13). "AI" is matched case-sensitively. */
const MODERN_WORDS = /\b(emojis?|computers?|internet|online|e-?mails?|apps?|smartphones?|website|chatbots?|system prompts?|prompt injection|debug(?:ging)?|developers?|JSON|LLMs?|language model|artificial intelligence|okay|OK)\b/i;
const MODERN_CASED = /\bAI\b/;
/** "any prompt", "the prompt" (the model echoing a request for its prompt, #13) but not "a prompt reply" or "promptly". */
const MODERN_PROMPT = /\b(?:any|the|your|my|this|that|some|no)\s+prompts?\b(?!\s+(?:reply|response|answer|payment|action|service|attention|departure|return|dispatch))/i;

/** Returns the first modern/meta word found in the text, or null. */
export function findModernWord(text: string, heard = ""): string | null {
  // "prompt" is a fine old word ("a prompt reply"), so it is only banned when the detective just said it (an echo, #13) or used as a noun.
  const echo = /\bprompts?\b/i.test(heard) ? /\bprompts?\b/i.exec(text) : null;
  const m = MODERN_WORDS.exec(text) ?? MODERN_CASED.exec(text) ?? MODERN_PROMPT.exec(text) ?? echo;
  return m ? m[0] : null;
}
