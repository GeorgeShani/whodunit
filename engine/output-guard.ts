/**
 * Case-data output guard (issues #90 / #91): optional `case.json` `guard` block.
 *
 * SERVER-ONLY. Omitted or empty: no extra checks, existing behaviour unchanged.
 * The mechanism is case-agnostic; authors fill `aliveUntil` and `gatedTopics`.
 * Case-specific values live in the case files, not in this module.
 *
 * Checks are deterministic and unit-testable: a sentence that places the victim
 * alive or interacting after `aliveUntil.until` (by clock time, after-phrase, or
 * an at-or-after anchor) is rejected, except appearance-framed times and lines
 * that match the speaker's current beliefs or knowledge. `gatedTopics` hide
 * instrument terms until `unlockedBy` evidence is found or shown in this game.
 */
import { z } from "zod";
import { extractTimes } from "@/ai/canon-check";
import { clockMinutes } from "./time";
import { GameTimeSchema, IdSchema } from "./types";

/** Structurally the same as CaseIssue; defined here to avoid an import cycle. */
interface Issue {
  file: string;
  path?: string;
  message: string;
}

const Phrase = z.string().trim().min(2).max(80);

export const AliveUntilAnchorSchema = z.strictObject({
  /** Optional fact or timeline id (must exist when set). */
  id: IdSchema.optional(),
  terms: z.array(Phrase).min(1),
});

export const AliveUntilSchema = z.strictObject({
  victimId: IdSchema,
  aliases: z.array(Phrase).min(1),
  until: GameTimeSchema,
  anchors: z.array(AliveUntilAnchorSchema).default([]),
  alivePhrases: z.array(Phrase).min(1),
  pronouns: z.array(z.string().trim().min(2).max(16)).default([]),
  appearancePhrases: z.array(Phrase).default([]),
  afterPhrases: z.array(Phrase).default([]),
});
export type AliveUntil = z.infer<typeof AliveUntilSchema>;

export const GatedTopicConceptSchema = z.strictObject({
  /** Instrument / record nouns ("recorder", "gauge", "the paper that", "strip"). */
  instruments: z.array(Phrase).min(1),
  /** Measure nouns ("heel", "tilt", "roll", "list", "lean"). */
  measures: z.array(Phrase).min(1),
  /** Maximum word gap between an instrument and a measure (inclusive). */
  window: z.number().int().min(1).max(40).default(8),
});
export type GatedTopicConcept = z.infer<typeof GatedTopicConceptSchema>;

export const GatedTopicSchema = z
  .strictObject({
    unlockedBy: IdSchema,
    terms: z.array(Phrase).default([]),
    patterns: z.array(z.string().min(1).max(200)).default([]),
    /** Optional concept net: an instrument noun within `window` words of a measure word. */
    concept: GatedTopicConceptSchema.optional(),
  })
  .superRefine((t, ctx) => {
    if (t.terms.length + t.patterns.length < 1 && !t.concept) {
      ctx.addIssue({ code: "custom", message: "each gated topic needs at least one term, pattern, or concept" });
    }
  });
export type GatedTopic = z.infer<typeof GatedTopicSchema>;

export const CaseGuardSchema = z.strictObject({
  aliveUntil: AliveUntilSchema.optional(),
  gatedTopics: z.array(GatedTopicSchema).max(16).optional(),
});
export type CaseGuard = z.infer<typeof CaseGuardSchema>;

export type OutputGuardReason = "alive_after" | "gated_topic";

export interface OutputGuardHit {
  reason: OutputGuardReason;
  note: string;
  detail: string;
}

/** The case slice this module reads. Avoids importing LoadedCase (schema cycle). */
export interface OutputGuardCase {
  victim: { id: string; name: string; aliases?: string[] };
  characters?: { id: string; name: string; aliases?: string[] }[];
  facts?: { id: string }[];
  timeline?: { id: string }[];
  evidence?: { id: string }[];
  solution?: { time: string };
  featureConfig?: Record<string, unknown>;
  guard?: CaseGuard;
}

export interface OutputGuardContext {
  beliefs?: { statement: string }[];
  knowledge?: { statement: string }[];
  evidenceShown?: { id: string }[];
}

const F = "case.json";
const P = "guard";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.toLowerCase().replace(/['’]/g, "'").replace(/\s+/g, " ").trim();

/** Case-insensitive phrase match with flexible whitespace and word edges. */
export function hasPhrase(text: string, phrase: string): boolean {
  const parts = phrase.trim().split(/\s+/).map(esc);
  if (!parts.length) return false;
  return new RegExp(`\\b${parts.join("\\s+")}\\b`, "i").test(text);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function compilePattern(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

function appearanceWords(c: OutputGuardCase, alive?: AliveUntil): string[] {
  const out = [...(alive?.appearancePhrases ?? [])];
  const tm = c.featureConfig?.["time-misdirection"];
  if (tm && typeof tm === "object" && tm && Array.isArray((tm as { appearanceWords?: unknown }).appearanceWords)) {
    for (const w of (tm as { appearanceWords: unknown[] }).appearanceWords) {
      if (typeof w === "string" && w.trim()) out.push(w);
    }
  }
  return out;
}

function victimAliases(c: OutputGuardCase, alive: AliveUntil): string[] {
  const raw = [c.victim.name, ...(c.victim.aliases ?? []), ...alive.aliases];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of raw) {
    const n = norm(a);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(a);
  }
  // Longer aliases first so "the Old Man" wins over "Man" if both appear.
  return out.sort((a, b) => b.length - a.length);
}

function otherNamePhrases(c: OutputGuardCase, victimId: string): string[] {
  const out: string[] = [];
  for (const ch of c.characters ?? []) {
    if (ch.id === victimId) continue;
    out.push(ch.name, ...(ch.aliases ?? []));
  }
  return out.filter((x) => x.trim().length >= 2);
}

function mentionsVictim(sentence: string, aliases: string[], pronouns: string[], otherNames: string[]): boolean {
  if (aliases.some((a) => hasPhrase(sentence, a))) return true;
  if (!pronouns.length) return false;
  if (otherNames.some((n) => hasPhrase(sentence, n))) return false;
  return pronouns.some((p) => hasPhrase(sentence, p));
}

function hasAlivePhrase(sentence: string, phrases: string[]): boolean {
  return phrases.some((p) => hasPhrase(sentence, p));
}

const AFTER_PREP = /\b(?:after|afterwards|afterward|since|following|once|past|subsequent\s+to)\b/i;
const AT_WHEN_PREP = /\b(?:when|while|during|as|at)\b/i;
const BEFORE_PREP = /\b(?:before|prior\s+to|until|till|up\s+to|preceding)\b/i;

type AnchorRel = "before" | "after" | "none";

function windowBefore(sentence: string, index: number, chars = 48): string {
  return sentence.slice(Math.max(0, index - chars), index);
}

function anchorRelation(sentence: string, term: string): AnchorRel {
  const re = new RegExp(`\\b${term.trim().split(/\s+/).map(esc).join("\\s+")}\\b`, "i");
  const m = re.exec(sentence);
  if (!m) return "none";
  const before = windowBefore(sentence, m.index);
  if (BEFORE_PREP.test(before) && !AFTER_PREP.test(before) && !AT_WHEN_PREP.test(before)) return "before";
  // Mentioned without a clear "before": treat as at-or-after the event.
  return "after";
}

function isAppearanceFramed(sentence: string, timeIndex: number, timeText: string, words: string[]): boolean {
  // Frame the time ("the watch said 22:41", "the horn sounded at 22:38"), not a
  // later clause ("After 22:20 I heard the Old Man").
  const before = sentence.slice(Math.max(0, timeIndex - 64), timeIndex);
  const after = sentence.slice(timeIndex, Math.min(sentence.length, timeIndex + timeText.length + 16));
  return words.some((w) => hasPhrase(before, w) || hasPhrase(after, w));
}

function afterCutoffClock(sentence: string, untilMin: number, aliveState: boolean, appearance: string[] = []): boolean {
  const mentions = extractTimes(sentence);
  if (!mentions.length) return false;
  for (const t of mentions) {
    const idx = sentence.toLowerCase().indexOf(t.text.toLowerCase());
    if (idx >= 0 && isAppearanceFramed(sentence, idx, t.text, appearance)) continue;
    const prep = idx >= 0 ? windowBefore(sentence, idx) : "";
    const afterPrep = AFTER_PREP.test(prep);
    const later = t.candidates.some((m) => m > untilMin);
    const atOrAfter = t.candidates.some((m) => m >= untilMin);
    if (later) return true;
    if (afterPrep && atOrAfter) return true;
    // "still alive after ten past ten" (T may be before the cutoff, but the
    // claimed living-interval is unbounded and covers the post-cutoff period).
    if (aliveState && afterPrep) return true;
  }
  return false;
}

/** Alive-state + after-cutoff time with no other person named (e.g. "Alive at 22:38, dead by 22:41."). */
function implicitVictim(sentence: string, otherNames: string[]): boolean {
  if (otherNames.some((n) => hasPhrase(sentence, n))) return false;
  // "I was still alive..." is the speaker, not the victim.
  if (/\bi\s+(?:was|am|have\s+been)\b/i.test(sentence) && !/\b(?:he|she|they|him|her)\b/i.test(sentence)) return false;
  return true;
}

function matchesCanon(line: string, statements: string[]): boolean {
  const L = norm(line);
  if (L.length < 12) return false;
  for (const raw of statements) {
    const S = norm(raw);
    if (S.length < 12) continue;
    if (L.includes(S)) return true;
    if (S.startsWith(L) && L.length >= 20) return true;
    if (S.includes(L) && L.length >= S.length * 0.7) return true;
  }
  return false;
}

function isAliveStatePhrase(sentence: string, phrases: string[]): boolean {
  // State-of-being (not a one-off interaction) for the "alive after T" rule.
  const STATE =
    /\b(?:alive|living|still\s+(?:alive|breathing|with\s+us)|up\s+and\s+about|living\s+and\s+breathing|still\s+breathing)\b/i;
  if (STATE.test(sentence)) return true;
  return phrases.some((p) => /\b(?:alive|living|still\s+with\s+us|up\s+and\s+about|breathing)\b/i.test(p) && hasPhrase(sentence, p));
}

const CARRY_SENTENCES = 2;

/** `post-lurch`, `post the Great Lurch` from an anchor term. */
function hasPostAnchor(sentence: string, term: string): boolean {
  const parts = term.trim().split(/\s+/).map(esc);
  if (!parts.length) return false;
  const joined = parts.join("\\s+");
  const last = parts[parts.length - 1]!;
  return new RegExp(`\\bpost(?:[\\s-]+(?:the\\s+)?${joined}|[\\s-]+${last})\\b`, "i").test(sentence);
}

function sentenceHasAfterAnchor(sentence: string, alive: AliveUntil, untilMin: number, appearance: string[]): boolean {
  if (afterCutoffClock(sentence, untilMin, true, appearance)) return true;
  for (const phrase of alive.afterPhrases ?? []) {
    if (hasPhrase(sentence, phrase)) return true;
  }
  for (const anchor of alive.anchors ?? []) {
    for (const term of anchor.terms) {
      if (hasPostAnchor(sentence, term)) return true;
      if (hasPhrase(sentence, term) && anchorRelation(sentence, term) === "after") return true;
    }
  }
  return false;
}

function mentionsCarriedVictim(sentence: string, aliases: string[], pronouns: string[], otherNames: string[]): boolean {
  if (otherNames.some((n) => hasPhrase(sentence, n))) return false;
  if (pronouns.some((p) => hasPhrase(sentence, p))) return true;
  return aliases.some((a) => hasPhrase(sentence, a));
}

/** Word-distance concept net: an instrument phrase within `window` words of a measure phrase. */
export function conceptDistanceHit(text: string, concept: GatedTopicConcept): boolean {
  const tokens = text.toLowerCase().replace(/['’]/g, "'").split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return false;
  const spans = (phrase: string): [number, number][] => {
    const parts = phrase.toLowerCase().replace(/['’]/g, "'").split(/\s+/).filter(Boolean);
    if (!parts.length) return [];
    const out: [number, number][] = [];
    for (let i = 0; i <= tokens.length - parts.length; i++) {
      if (parts.every((p, k) => tokens[i + k] === p)) out.push([i, i + parts.length - 1]);
    }
    return out;
  };
  const inst = concept.instruments.flatMap(spans);
  const meas = concept.measures.flatMap(spans);
  const window = concept.window ?? 8;
  for (const [is, ie] of inst) {
    for (const [ms, me] of meas) {
      const gap = ms > ie ? ms - ie - 1 : is > me ? is - me - 1 : 0;
      if (gap <= window) return true;
    }
  }
  return false;
}


export function validateOutputGuard(c: OutputGuardCase): Issue[] {
  if (!c.guard) return [];
  const parsed = CaseGuardSchema.safeParse(c.guard);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      file: F,
      path: [P, ...i.path.map(String)].join("."),
      message: i.message,
    }));
  }
  const g = parsed.data;
  const issues: Issue[] = [];
  const evidenceIds = new Set((c.evidence ?? []).map((e) => e.id));
  const factIds = new Set([...(c.facts ?? []), ...(c.timeline ?? [])].map((x) => x.id));

  if (g.aliveUntil) {
    const a = g.aliveUntil;
    const p = `${P}.aliveUntil`;
    if (a.victimId !== c.victim.id) {
      issues.push({ file: F, path: `${p}.victimId`, message: `victimId "${a.victimId}" must equal victim.id "${c.victim.id}"` });
    }
    if (c.solution?.time && clockMinutes(a.until) < clockMinutes(c.solution.time)) {
      issues.push({
        file: F,
        path: `${p}.until`,
        message: `until "${a.until}" must be at or after solution.time "${c.solution.time}"`,
      });
    }
    a.anchors.forEach((anchor, i) => {
      if (anchor.id && !factIds.has(anchor.id)) {
        issues.push({ file: F, path: `${p}.anchors.${i}.id`, message: `unknown fact or timeline id "${anchor.id}"` });
      }
    });
  }

  (g.gatedTopics ?? []).forEach((t, i) => {
    const p = `${P}.gatedTopics.${i}`;
    if (!evidenceIds.has(t.unlockedBy)) {
      issues.push({ file: F, path: `${p}.unlockedBy`, message: `unknown evidence "${t.unlockedBy}"` });
    }
    t.patterns.forEach((src, k) => {
      if (!compilePattern(src)) issues.push({ file: F, path: `${p}.patterns.${k}`, message: `invalid regex: ${src}` });
    });
  });

  return issues;
}

/**
 * Run the optional case-data output checks. `foundEvidenceIds` is everything
 * discovered in this game (and shown/presented ids are also treated as found).
 * null = no hit (including when `guard` is omitted).
 */
export function checkOutputGuard(
  said: string,
  c: OutputGuardCase,
  ctx: OutputGuardContext = {},
  foundEvidenceIds: readonly string[] = [],
): OutputGuardHit | null {
  const g = c.guard;
  if (!g) return null;

  const found = new Set(foundEvidenceIds);
  for (const e of ctx.evidenceShown ?? []) found.add(e.id);

  const aliveHit = g.aliveUntil ? checkAliveUntil(said, c, g.aliveUntil, ctx) : null;
  if (aliveHit) return aliveHit;
  const topicHit = g.gatedTopics?.length ? checkGatedTopics(said, g.gatedTopics, found) : null;
  if (topicHit) return topicHit;
  return null;
}

function checkGatedTopics(said: string, topics: GatedTopic[], found: ReadonlySet<string>): OutputGuardHit | null {
  for (const t of topics) {
    if (found.has(t.unlockedBy)) continue;
    for (const term of t.terms) {
      if (hasPhrase(said, term)) {
        return {
          reason: "gated_topic",
          note: `You mentioned something the detective has not yet found ("${term}"). Speak only of what is already in the open; leave that instrument or record out until it has been found.`,
          detail: `gated:${t.unlockedBy}:${term}`,
        };
      }
    }
    for (const src of t.patterns) {
      const re = compilePattern(src);
      if (re?.test(said)) {
        return {
          reason: "gated_topic",
          note: `You mentioned something the detective has not yet found. Speak only of what is already in the open; leave that instrument or record out until it has been found.`,
          detail: `gated:${t.unlockedBy}:pattern`,
        };
      }
    }
    if (t.concept && conceptDistanceHit(said, t.concept)) {
      return {
        reason: "gated_topic",
        note: `You mentioned a record or instrument of the ship's list that the detective has not yet found. Speak only of what is already in the open; leave that instrument or reading out until it has been found.`,
        detail: `gated:${t.unlockedBy}:concept`,
      };
    }
  }
  return null;
}

function checkAliveUntil(said: string, c: OutputGuardCase, alive: AliveUntil, ctx: OutputGuardContext): OutputGuardHit | null {
  const statements = [...(ctx.beliefs ?? []).map((b) => b.statement), ...(ctx.knowledge ?? []).map((k) => k.statement)];
  if (matchesCanon(said, statements)) return null;

  const aliases = victimAliases(c, alive);
  const others = otherNamePhrases(c, alive.victimId);
  const appearance = appearanceWords(c, alive);
  const untilMin = clockMinutes(alive.until);
  const phrases = [...alive.alivePhrases].sort((a, b) => b.length - a.length);
  const pronouns = alive.pronouns ?? [];

  let victimCarry = 0;
  let afterCarry = 0;

  for (const sentence of sentences(said)) {
    const aliveState = isAliveStatePhrase(sentence, phrases);
    const named = mentionsVictim(sentence, aliases, pronouns, others);
    const implied = !named && (aliveState || hasAlivePhrase(sentence, phrases)) && implicitVictim(sentence, others);
    const carriedVictim = !named && !implied && victimCarry > 0 && mentionsCarriedVictim(sentence, aliases, pronouns, others);
    const victimNow = named || implied || carriedVictim;
    const hasAlive = hasAlivePhrase(sentence, phrases) || aliveState || implied;
    const anchorNow = sentenceHasAfterAnchor(sentence, alive, untilMin, appearance);
    const afterNow = anchorNow || afterCarry > 0;

    if (victimNow && hasAlive && afterNow) return hitAlive(sentence);

    if (named || implied) victimCarry = CARRY_SENTENCES;
    else if (anchorNow) victimCarry = Math.max(victimCarry, CARRY_SENTENCES);
    else victimCarry = Math.max(0, victimCarry - 1);

    if (anchorNow) afterCarry = CARRY_SENTENCES;
    else afterCarry = Math.max(0, afterCarry - 1);
  }
  return null;
}

function hitAlive(sentence: string): OutputGuardHit {
  const clip = sentence.replace(/\s+/g, " ").trim().slice(0, 140);
  return {
    reason: "alive_after",
    note: `You placed the victim alive or in company after the time they could still have been. Do not say you saw, heard or spoke to them after that moment, or that they were still living then. You may talk about the event itself, about finding them already dead, or about what a watch, horn or similar appearance showed.`,
    detail: `alive_after:${clip}`,
  };
}
