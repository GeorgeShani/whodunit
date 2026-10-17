/**
 * Phase 6 (case-two plan 3.3): `time-misdirection`, a staged time (a smashed watch, a recorded cheer) that the model
 * must never state as fact. Config in case.json `featureConfig["time-misdirection"]` (SERVER-ONLY; nothing public):
 *  - stagedClaims: each staged time, the facts/clues that carry it, and what it pretends ("death" / "alive");
 *  - appearanceWords: words that frame a time as what something SHOWED ("the watch said 22:41");
 *  - provedBy: the key clues that prove the true time.
 * validate: staged times are outside the opportunity window, ids exist, provedBy are key evidence, and one of them
 * points at a fact whose range holds the murder minute (proof-of-when). warn: the alibi shape (exactly one suspect
 * alone at the murder minute; the culprits accompanied at each staged time). canonCheck: a sentence with a staged time
 * and a death/alive assertion but no appearance word is rejected, unless the speaker's own maintained story asserts it.
 */
import { z } from "zod";
import { extractTimes } from "@/ai/canon-check";
import type { LoadedCase } from "../../case-schema";
import { OPPORTUNITY_WINDOW_MINUTES, type CaseIssue } from "../../case-validation";
import { gameMinutes } from "../../time";
import { GameTimeSchema, IdSchema } from "../../types";
import type { FeatureModule } from "../types";

export const TimeMisdirectionConfigSchema = z.strictObject({
  stagedClaims: z
    .array(
      z.strictObject({
        time: GameTimeSchema,
        factIds: z.array(IdSchema).default([]),
        evidenceIds: z.array(IdSchema).default([]),
        kind: z.enum(["death", "alive"]),
      }),
    )
    .min(1),
  appearanceWords: z.array(z.string().trim().min(2)).min(1),
  provedBy: z.array(IdSchema).min(1),
});
export type TimeMisdirectionConfig = z.infer<typeof TimeMisdirectionConfigSchema>;

const F = "case.json";
const P = "featureConfig.time-misdirection";
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const range = (f: { time?: string; from?: string; to?: string }, day: string): [number, number] | null =>
  f.time !== undefined
    ? [gameMinutes(f.time, day), gameMinutes(f.time, day)]
    : f.from !== undefined && f.to !== undefined
      ? [gameMinutes(f.from, day), gameMinutes(f.to, day)]
      : null;

const DEATH =
  /\b(?:died|dies|dead|killed|murdered|struck\s+down|passed\s+(?:on|away)|breathed\s+his\s+last|breathed\s+her\s+last|was\s+(?:done\s+for|finished|done\s+in))\b/i;
const ALIVE = /\b(?:alive|living|still\s+breathing|breathing|cheered|cheering|spoke|speaking|called\s+out|shouted|sang)\b/i;
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function validate(c: LoadedCase, cfg: TimeMisdirectionConfig): CaseIssue[] {
  const out: CaseIssue[] = [];
  const day = c.dayStartsAt ?? "12:00";
  const facts = new Map([...c.facts, ...c.timeline].map((f) => [f.id, f]));
  const evidence = new Map(c.evidence.map((e) => [e.id, e]));
  const murder = gameMinutes(c.solution.time, day);
  cfg.stagedClaims.forEach((s, i) => {
    const p = `${P}.stagedClaims.${i}`;
    if (Math.abs(gameMinutes(s.time, day) - murder) < OPPORTUNITY_WINDOW_MINUTES)
      out.push({
        file: F,
        path: `${p}.time`,
        message: `staged time ${s.time} is within ${OPPORTUNITY_WINDOW_MINUTES} min of the murder: it misdirects nothing`,
      });
    s.factIds.forEach((id, k) => facts.has(id) || out.push({ file: F, path: `${p}.factIds.${k}`, message: `unknown fact "${id}"` }));
    s.evidenceIds.forEach((id, k) => evidence.has(id) || out.push({ file: F, path: `${p}.evidenceIds.${k}`, message: `unknown evidence "${id}"` }));
  });
  cfg.provedBy.forEach((id, k) => {
    if (!evidence.has(id)) out.push({ file: F, path: `${P}.provedBy.${k}`, message: `unknown evidence "${id}"` });
    else if (!c.solution.keyEvidenceIds.includes(id))
      out.push({ file: F, path: `${P}.provedBy.${k}`, message: `"${id}" is not key evidence (solution.keyEvidenceIds)` });
  });
  const proves = cfg.provedBy.some((id) =>
    (evidence.get(id)?.relatedFactIds ?? []).some((fid) => {
      const f = facts.get(fid);
      const r = f && range(f, day);
      return !!r && r[0] <= murder && murder <= r[1];
    }),
  );
  if (!proves)
    out.push({
      file: F,
      path: `${P}.provedBy`,
      message: `no provedBy clue points (relatedFactIds) at a fact whose time holds the murder minute ${c.solution.time}: the true time is asserted, not proved`,
    });
  return out;
}

/** Where each suspect is at a minute (located timeline entries covering it); null = no located entry. */
function whereAt(c: LoadedCase, minute: number): Map<string, string | null> {
  const day = c.dayStartsAt ?? "12:00";
  const at = new Map<string, string | null>(c.characters.map((ch) => [ch.id, null]));
  for (const f of [...c.timeline, ...c.facts]) {
    const r = f.locationId ? range(f, day) : null;
    if (!r || minute < r[0] || minute > r[1]) continue;
    for (const id of f.involvesCharacterIds) if (at.has(id) && at.get(id) === null) at.set(id, f.locationId!);
  }
  return at;
}
const alone = (at: Map<string, string | null>, id: string) => {
  const loc = at.get(id);
  return loc == null || ![...at].some(([o, l]) => o !== id && l === loc);
};

function warn(c: LoadedCase, cfg: TimeMisdirectionConfig): CaseIssue[] {
  const out: CaseIssue[] = [];
  const day = c.dayStartsAt ?? "12:00";
  const atMurder = whereAt(c, gameMinutes(c.solution.time, day));
  const lonely = c.characters.filter((ch) => alone(atMurder, ch.id)).map((ch) => ch.id);
  if (lonely.length !== 1)
    out.push({
      file: F,
      path: P,
      message: `alibi shape: ${lonely.length} suspects are unaccompanied at the murder minute ${c.solution.time} (${lonely.join(", ") || "none"}); the staged time should leave exactly one`,
    });
  const culprits = [c.solution.murdererId, ...(c.solution.accompliceId ? [c.solution.accompliceId] : [])];
  cfg.stagedClaims.forEach((s, i) => {
    const at = whereAt(c, gameMinutes(s.time, day));
    const bare = culprits.filter((id) => alone(at, id));
    if (bare.length)
      out.push({
        file: F,
        path: `${P}.stagedClaims.${i}`,
        message: `alibi shape: at the staged time ${s.time} ${bare.join(", ")} has no companion, so the decoy gives them no alibi`,
      });
  });
  return out;
}

function canonCheck(_c: LoadedCase, cfg: TimeMisdirectionConfig, line: { said: string; maintainedStories: readonly string[] }) {
  const looks = new RegExp(`\\b(?:${cfg.appearanceWords.map(esc).join("|")})\\b`, "i");
  const storyMinutes = new Set(line.maintainedStories.flatMap((t) => extractTimes(t).flatMap((m) => m.candidates)));
  for (const sentence of line.said.split(/(?<=[.!?…])\s+/)) {
    if (/\?\s*["'”’)]*$/.test(sentence) || looks.test(sentence)) continue;
    const minutes = extractTimes(sentence).flatMap((m) => (m.hourOnly ? [] : m.candidates));
    for (const s of cfg.stagedClaims) {
      const t = clock(s.time);
      if (!minutes.includes(t) || storyMinutes.has(t)) continue;
      if ((s.kind === "death" ? DEATH : ALIVE).test(sentence))
        return {
          note: `You stated ${s.time} as a fact about the ${s.kind === "death" ? "death" : "victim being alive"}: "${sentence.slice(0, 120)}". That time is only what something SHOWED or seemed to show; never state it as fact. Say what showed it ("the watch read...", "the horn sounded at..."), or leave the time out.`,
          detail: `staged:${s.time}:${sentence.slice(0, 100)}`,
        };
    }
  }
  return null;
}

export const timeMisdirection: FeatureModule<TimeMisdirectionConfig> = {
  name: "time-misdirection",
  configSchema: TimeMisdirectionConfigSchema,
  validate,
  warn,
  canonCheck,
};
