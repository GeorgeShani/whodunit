/**
 * Order-of-events check for model dialogue (issue #26).
 *
 * The clock-time check (canon-check.ts) only sees "21:13"-style times, so a
 * relative span like "from after the lights went out till the butler lit the
 * candles" slipped through even though it puts a 2-minute absence at 21:10 to
 * 21:11 when canon has it at 21:13 to 21:22. This maps landmark phrases
 * ("the lights went out", "lit the candles", "the scream", ...) to the times
 * the character's own knowledge gives them, turns "from X till Y" / "after X" /
 * "before X" into a window, and compares it with when THAT person's own
 * movements happened (leaves, telephone, returns). Anything that cannot be
 * mapped is left alone: the check only rejects a clear conflict.
 */
import type { CharacterContext } from "@/engine/context-builder";
import { buildSubjects } from "./canon-check";

interface LandmarkDef {
  id: string;
  label: string;
  /** How a speaker refers to it. */
  say: RegExp;
  /** How a knowledge statement describes it. */
  fact: RegExp;
}

const LANDMARKS: LandmarkDef[] = [
  {
    id: "blackout",
    label: "the lights go out",
    say: /\b(?:lights?\s+(?:went|go|goes|going|had\s+gone|have\s+gone|failed?|failing|died|dimmed)(?:\s+out)?|(?:the\s+)?black-?out|power\s+(?:failed|went|was\s+cut|cut)|(?:went|gone)\s+dark|plunged\s+into\s+darkness)\b/gi,
    fact: /\b(?:lights?\b[^.]{0,40}\b(?:go|goes|went|fail|out)\b|black-?out|every electric light)/i,
  },
  {
    id: "candles",
    label: "the candles are lit",
    say: /\b(?:(?:lit|lighted|lighting|lights?)\s+(?:the\s+|those\s+|his\s+)?(?:pair\s+of\s+)?(?:silver\s+)?candle(?:s|sticks?)|candle(?:s|sticks?)\s+(?:were\s+|was\s+|got\s+|had\s+been\s+)?(?:lit|lighted|alight)|candle-?light(?:ed)?)\b/gi,
    fact: /\blight(?:s|ed|ing)?\b[^.]{0,40}\bcandle/i,
  },
  {
    id: "scream",
    label: "the scream",
    say: /\b(?:the\s+)?scream(?:ed|ing)?\b/gi,
    fact: /\bscream/i,
  },
  {
    id: "body",
    label: "the body is found",
    say: /\b(?:body|corpse)\s+(?:was\s+|is\s+|had\s+been\s+)?(?:found|discovered)|\b(?:found|discovered)\s+(?:his\s+lordship|him|the\s+body)\b/gi,
    fact: /\b(?:found dead|discovered|is found)\b/i,
  },
  {
    id: "lights-back",
    label: "the lights come back on",
    say: /\blights?\s+(?:came|come|went|were)\s+(?:back\s+on|on\s+again|restored)|\bpower\s+(?:came|returned)\s+back|\blights?\s+(?:were\s+)?restored\b/gi,
    fact: /\blights?\b[^.]{0,30}\b(?:come|came)\s+back|restored/i,
  },
];

const hm = (t?: string) => {
  const m = t && /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export interface Landmark {
  id: string;
  label: string;
  minute: number;
}

/** The evening's landmarks, timed from what this character knows (earliest matching fact wins). */
export function landmarksOf(ctx: CharacterContext): Landmark[] {
  const out: Landmark[] = [];
  for (const def of LANDMARKS) {
    const hits = ctx.knowledge
      .filter((k) => def.fact.test(k.statement))
      .map((k) => hm(k.time) ?? hm(k.from))
      .filter((m): m is number => m !== null);
    // "lights come back on" also matches the blackout's own statement ("They stay out until 21:38"): the blackout is its earliest, restored its latest.
    if (hits.length) out.push({ id: def.id, label: def.label, minute: def.id === "lights-back" ? Math.max(...hits) : Math.min(...hits) });
  }
  return out.sort((a, b) => a.minute - b.minute);
}

/** "THE EVENING IN ORDER" prompt lines (public landmarks only, from the character's own knowledge). */
export function orderLines(ctx: CharacterContext): string[] {
  const ls = landmarksOf(ctx);
  if (ls.length < 2) return [];
  return [
    "THE EVENING IN ORDER (landmarks you can use; the order and the times are fixed):",
    ...ls.map((l) => `- ${clock(l.minute)}: ${l.label}`),
    "",
  ];
}

export const ORDER_RULE =
  "Say WHEN you did something with the clock time from WHAT YOU KNOW, or tie it to ONE landmark from THE EVENING IN ORDER exactly as it is listed there. Never invent a stretch of time between two events (\"from after the lights went out till the candles\") and never put an event before one that comes first in that list.";

/** Words that make a clause a claim about the speaker's (or someone's) own absence / movement. */
const ABSENCE =
  /\b(?:slipp?ed\s+(?:away|out|off)|stepp?ed\s+(?:away|out)|left\s+(?:the\s+)?(?:dining\s+room|room|table|fire)|(?:went|going|gone|nipped|popped)\s+(?:off\s+)?to\s+(?:use\s+|make\s+)?(?:the\s+)?(?:servants'?\s+)?(?:tele)?phone|(?:was|were|am|is)\s+(?:away|gone|absent|on\s+the\s+(?:servants'?\s+)?(?:tele)?phone)|(?:tele)?phon(?:ed|ing)|(?:tele)?phone\s+call|(?:was|were)\s+(?:out\s+of|not\s+in)\s+the\s+(?:dining\s+)?room|absent|away)\b/i;
/** Knowledge statements describing a person's own comings and goings. */
const MOVEMENT = /\b(?:leav(?:e|es|ing)|left|away|slip|telephon|phone|return|comes?\s+back|came\s+back|back\s+to|step|excus|goes?\s+to|went\s+to)/i;

interface Mention {
  def: LandmarkDef;
  start: number;
  end: number;
}

function mentions(text: string): Mention[] {
  const out: Mention[] = [];
  for (const def of LANDMARKS) {
    for (const m of text.matchAll(new RegExp(def.say.source, "gi"))) out.push({ def, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  out.sort((a, b) => a.start - b.start);
  // A shorter mention swallowed by a longer one at the same place is the same landmark.
  return out.filter((m, i) => !out.slice(0, i).some((p) => p.end > m.start && p.start <= m.start));
}

export interface OrderResult {
  ok: boolean;
  /** The quoted phrases that conflict. */
  offending: string[];
  /** Facts to remind the model of (when it really happened). */
  hint?: string;
}

/**
 * Rejects a clear conflict between a relative-time phrase and the speaker's (or a named person's) own
 * movements: the window it describes must overlap when they really were away; "after X" needs a
 * movement at or after X, "before X" one at or before X (1 minute of slack).
 */
export function checkOrder(dialogue: string, ctx: CharacterContext): OrderResult {
  const landmarks = new Map(landmarksOf(ctx).map((l) => [l.id, l.minute]));
  const subjects = buildSubjects(ctx);
  const offending: string[] = [];
  let hint: string | undefined;
  const sentences = dialogue.split(/(?<=[.!?;])\s+|\n+/);
  for (const sentence of sentences) {
    if (!ABSENCE.test(sentence)) continue;
    const ms = mentions(sentence).filter((m) => landmarks.has(m.def.id));
    if (ms.length === 0) continue;
    const named = subjects.filter((s) => s.key !== ctx.persona.id && !s.key.startsWith("loc:") && s.re.test(sentence)).map((s) => s.key);
    const first = /\b(?:I|I'm|I'd|I've|me|my|myself)\b/.test(sentence);
    const who = first || named.length === 0 ? ctx.persona.id : named[0];
    if (!first && named.length === 0) continue; // nobody to hold the claim against
    // Only statements where THEY are the one moving ("Ann leaves ...", "Ann returns"), not "... leaving Ann".
    const whoSubject = subjects.find((s) => s.key === who);
    const subjectMoves = whoSubject ? new RegExp(`(?:${whoSubject.re.source})[^.;]{0,40}?(?:${MOVEMENT.source})`, "i") : MOVEMENT;
    const moves = ctx.knowledge
      .filter((k) => subjectMoves.test(k.statement))
      .flatMap((k) => [hm(k.time), hm(k.from), hm(k.to)])
      .filter((m): m is number => m !== null);
    if (moves.length === 0) continue;
    const lo = Math.min(...moves);
    const hi = Math.max(...moves);
    const slack = 1;
    const t = (m: Mention) => landmarks.get(m.def.id)!;
    const say = (a: Mention, b?: Mention) => sentence.slice(a.start, (b ?? a).end).trim();
    let bad: string | null = null;
    const pre = (m: Mention) => /\b(after|before)\s+(?:when\s+|that\s+)?(?:\w+\s+){0,2}$/i.exec(sentence.slice(Math.max(0, m.start - 30), m.start));
    const linked = ms.length >= 2 && /^[^.!?;]{0,40}\b(?:till|until|to|and|up\s+to|before)\b/i.test(sentence.slice(ms[0].end, ms[1].start + 1));
    if (linked) {
      const [a, b] = [t(ms[0]), t(ms[1])].sort((x, y) => x - y);
      // The span they describe must overlap the real absence.
      if (b + slack < lo || a - slack > hi) bad = say(ms[0], ms[1]);
    } else {
      for (const m of ms) {
        const p = pre(m);
        if (!p) continue;
        const rel = p[1].toLowerCase();
        if (rel === "after" && hi + slack < t(m)) bad = say(m);
        if (rel === "before" && lo - slack > t(m)) bad = say(m);
        if (bad) break;
      }
    }
    if (bad) {
      offending.push(bad);
      const real = lo === hi ? clock(lo) : `${clock(lo)} to ${clock(hi)}`;
      hint = `${who === ctx.persona.id ? "You were" : "They were"} actually away between ${real}; ${[...landmarks].map(([id, m]) => `${LANDMARKS.find((d) => d.id === id)!.label} at ${clock(m)}`).join(", ")}.`;
    }
  }
  return { ok: offending.length === 0, offending, ...(hint ? { hint } : {}) };
}
