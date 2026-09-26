/**
 * Deterministic canon post-check for model dialogue (issue #6).
 *
 * The model may only state clock times that appear in its own scoped context
 * (knowledge tags and ranges, its stories, admitted secrets, clues shown, the
 * public case facts, the conversation). extractTimes() finds clock times in
 * free text: "21:20", "9.20", "twenty past nine", "quarter to ten",
 * "half past nine", "half nine", "seventeen minutes past nine",
 * "nine o'clock", "nine fifteen", "twenty-one hundred", "9 pm". A 12-hour
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
}

const HOUR_ONLY_TOLERANCE = 5;

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
  const add = (re: RegExp, f: (m: RegExpExecArray) => { c: number[]; hourOnly?: boolean } | null) => {
    for (const m of text.matchAll(re)) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      const r = f(m as RegExpExecArray);
      if (!r || r.c.length === 0) continue;
      taken.push([s, e]);
      out.push({ text: m[0].trim(), candidates: r.c, hourOnly: Boolean(r.hourOnly) });
    }
  };
  // Order matters: most specific patterns first; later matches may not overlap earlier ones.
  add(new RegExp(`\\b(quarter|half|${NUM})(?:\\s+minutes?)?\\s+(past|after|to|before|till|til)\\s+(${NUM})\\b`, "gi"), (m) => {
    const mins = minuteOf(m[1]);
    const h = num(m[3]);
    if (mins === null || h === null || mins > 59 || h > 24) return null;
    const back = /^(to|before|till|til)$/i.test(m[2]);
    const r = readings(h, 0).map((t) => (t + (back ? -mins : mins) + 1440) % 1440);
    return { c: r };
  });
  add(new RegExp(`(?<![£$€\\d.])\\b(\\d{1,2})[:.](\\d{2})\\b(?!\\.\\d)`, "g"), (m) => ({ c: readings(Number(m[1]), Number(m[2])) }));
  add(new RegExp(`\\bhalf\\s+(${NUM})\\b`, "gi"), (m) => {
    const h = num(m[1]);
    return h === null || h > 12 ? null : { c: readings(h, 30) };
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

/** Allowed clock times (minutes after midnight) for one reply. */
export function allowedTimes(ctx: CharacterContext, d: TurnDirectives, question: string): Set<number> {
  const allowed = new Set<number>();
  const hm = (t?: string) => {
    const m = t && /^(\d{1,2}):(\d{2})$/.exec(t);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  for (const k of ctx.knowledge) {
    const t = hm(k.time);
    if (t !== null) allowed.add(t);
    const a = hm(k.from);
    const b = hm(k.to);
    if (a !== null && b !== null) for (let x = a; x !== (b + 1) % 1440; x = (x + 1) % 1440) allowed.add(x);
  }
  const f = hm(ctx.case.victim.foundAt);
  if (f !== null) allowed.add(f);
  const texts = [
    ctx.case.victim.foundAt,
    ctx.case.victim.description,
    ctx.case.victim.causeOfDeath,
    ctx.persona.bio,
    ...ctx.goals,
    ...ctx.knowledge.map((k) => k.statement),
    ...ctx.beliefs.map((b) => b.statement),
    ...ctx.intendedLies.map((l) => `${l.topic ?? ""} ${l.claim}`),
    ...ctx.secrets.map((s) => s.description),
    ...ctx.evidenceShown.map((e) => e.description),
    ...ctx.memory.map((m) => m.text),
    ...ctx.statements.map((s) => s.text),
    d.revealSecret?.description ?? "",
    d.presentedEvidence?.description ?? "",
    question,
  ];
  for (const m of extractTimes(texts.join("\n"))) for (const c of m.candidates) allowed.add(c);
  return allowed;
}

export interface CanonCheckResult {
  ok: boolean;
  /** Mentions that match no allowed time. */
  offending: string[];
}

export function checkTimes(dialogue: string, allowed: Set<number>): CanonCheckResult {
  const offending: string[] = [];
  for (const m of extractTimes(dialogue)) {
    const tol = m.hourOnly ? HOUR_ONLY_TOLERANCE : 0;
    const ok = m.candidates.some((c) => {
      for (let dx = -tol; dx <= tol; dx++) if (allowed.has((c + dx + 1440) % 1440)) return true;
      return false;
    });
    if (!ok) offending.push(m.text);
  }
  return { ok: offending.length === 0, offending };
}
