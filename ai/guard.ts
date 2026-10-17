/**
 * SERVER-ONLY. The OUTPUT CONTRACT: every model line is checked here before the engine accepts it. The engine is the
 * truth and the model is a performer it does not trust, so nothing in a reply can unlock anything; a reply can only be
 * REJECTED (perform-turn retries once with the corrective note, then plays a safe deflection keyed to the character).
 *
 * Checks, in order (the first failure wins):
 *  1. guilt      : the line admits the killing or a part in it (ai/guilt-check.ts), or the model lists "killing".
 *  2. admits     : the model's own `admits` list concedes a core-guilt secret, a secret not unlocked this turn, a story
 *                  the engine still has it MAINTAIN, or more than one new secret.
 *  3. canon time : every clock time must come from the character's context (ai/canon-check.ts).
 *  4. order      : relative timings fit the real order of events (ai/order-check.ts).
 *  5. names      : no titled or "poor X"-style person name that is not in the prompt or the player's words.
 *  6. confrontation hygiene, breakdown outburst, period vocabulary (performance rules).
 *
 * See docs/AI_GUARDRAILS.md.
 */
import { findRetraction } from "./retraction-check";
import { findForeignLanguage } from "./language-check";
import { findForbiddenPhrase, forbiddenStateOf } from "./forbidden-phrases";
import { checkEventTimes } from "./event-time-check";
import type { LoadedCase } from "@/engine/case-schema";
import type { CharacterContext } from "@/engine/context-builder";
import { coreGuiltSecretIds, type CulpritAct, type GuiltProfile } from "@/engine/core-guilt";
import { isOutburst, outburstRuleText } from "@/engine/stress";
import { checkTimes, findModernWord, type CanonTimes } from "./canon-check";
import { checkOrder } from "./order-check";
import { caseWorld } from "./world";
import { findGuiltLeak, findReplyGuiltLeak, guiltRetryNote, speakerNamesOf } from "./guilt-check";
import { addressesWrongPerson, repeatsEarlier } from "./confront-check";
import { freshPick, recentReplies, repeatsRecentReply, sameAction, saidRecently } from "./delivery";
import type { ConfrontDirective, TurnDirectives } from "./prompts/interrogation";

export type GuardReason =
  | "guilt_leak"
  | "admits_core_guilt"
  | "admits_locked_secret"
  | "concedes_maintained_lie"
  | "retracts_admission"
  | "not_english"
  | "forbidden_phrase"
  | "over_claim"
  | "multiple_reveals"
  | "unknown_time"
  | "event_order"
  | "event_time"
  | "unknown_name"
  | "repeat"
  | "wrong_addressee"
  | "no_outburst"
  | "modern_word";

/** Reasons that mean the line said something the engine did not allow (as opposed to a performance slip). */
export const CONTRACT_REASONS: ReadonlySet<GuardReason> = new Set(["guilt_leak", "admits_core_guilt", "admits_locked_secret", "concedes_maintained_lie", "retracts_admission", "not_english", "forbidden_phrase", "over_claim", "multiple_reveals", "unknown_name"]);

/**
 * E8: the culprit acts this speaker may state as fact: those described by a secret they have revealed (or reveal this
 * turn), a testimony card they have been shown, or the card presented to them now (guiltProfile.coverActs).
 */
export function coveredActs(g: Pick<GuardInput, "ctx" | "directives" | "guilt">): Set<CulpritAct> {
  const held = [
    ...g.ctx.secrets.map((s) => s.id),
    ...(g.directives.revealSecret ? [g.directives.revealSecret.id] : []),
    ...(g.directives.presentedTestimony ? [g.directives.presentedTestimony.id] : []),
    ...(g.ctx.testimonyShown ?? []).map((t) => t.id),
  ];
  return new Set(held.flatMap((id) => g.guilt.coverActs?.[id] ?? []));
}

/** E8: the corrective note for an over-claim. Quotes only the model's own sentence. */
export function overClaimNote(sentence: string): string {
  return `You stated as fact that someone else did something you never saw and nobody has told you: "${sentence}". Say only what you saw, heard or were told; if you merely suspect it, say so plainly as a suspicion ("I wonder whether...", "perhaps"), or leave it out.`;
}

export interface GuardReply {
  dialogue: string;
  action?: string;
  admits?: string[];
}

export interface GuardInput {
  caseData: Pick<LoadedCase, "characters" | "victim"> &
    Partial<Pick<LoadedCase, "facts" | "timeline" | "dayStartsAt" | "solution" | "setting" | "orderLandmarks" | "orderWords">>;
  characterId: string;
  ctx: CharacterContext;
  directives: TurnDirectives;
  guilt: GuiltProfile;
  allowedTimes: CanonTimes;
  /** What the character just heard (question + partner line): names and times in it may be echoed. */
  heard: string;
  /** The full prompt text (system + user): the name check's vocabulary. */
  promptText: string;
  confrontation?: ConfrontDirective;
  /** E12/E13: every secret revealed so far in the game (any character's, core guilt never), for forbidden-phrase switches. */
  revealedAnyIds?: readonly string[];
}

export interface GuardVerdict {
  reason: GuardReason;
  /** Corrective note for the retry. Never contains locked content (only ids the model already has, or nothing). */
  note: string;
  /** Short offending fragment for the log. */
  detail: string;
}

const TITLES = "Mr|Mrs|Miss|Ms|Mx|Master|Madam|Madame|Lady|Lord|Sir|Dame|Dr|Doctor|Professor|Inspector|Chief Inspector|Sergeant|Constable|Superintendent|Captain|Colonel|Major|General|Reverend|Father|Sister|Nurse|Uncle|Aunt|Cousin|Count|Countess|Baron|Baroness|Duke|Duchess";
// "Mr. Smith" may carry a period; "Inspector. I'm" is two sentences, not a name.
const TITLED_NAME = new RegExp(`\\b(?:(?:Mr|Mrs|Ms|Dr|St)\\.?|${TITLES})[ \\t]+((?:[A-Z][a-z'’-]+)(?:[ \\t]+[A-Z][a-z'’-]+)?)`, "g");
const FAMILIAR_NAME = /\b(?:[Pp]oor|[Dd]ear|[Oo]ld|[Yy]oung|[Ll]ittle|[Dd]arling|[Ss]weet)\s+([A-Z][a-z'’-]{2,})/g;
/** Capitalized words that can follow a title or "poor" without being a person. */
const NOT_NAMES = new Set(["I", "I'm", "I’m", "I'll", "I've", "I'd", "God", "Heaven", "Heavens", "Lord", "Lady", "Sir", "Madam", "Christ", "Jove", "Gad", "Detective", "Inspector", "Darling", "Dear", "Mother", "Father", "Fellow", "Thing", "Soul", "Man", "Woman", "Chap", "Boy", "Girl", "England", "London", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Christmas", "Yard", "Scotland"]);

const wordIn = (w: string, hay: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay);

/** A person name in the line that the character was never told about (null = fine). */
export function findUnknownName(text: string, vocabulary: string): string | null {
  for (const re of [TITLED_NAME, FAMILIAR_NAME]) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const parts = m[1].split(/\s+/).map((p) => p.replace(/['’]s$/, "")).filter((p) => !NOT_NAMES.has(p));
      // A name is known if any of its words is in the prompt ("Mr Bunting" when the prompt says "Bunting, the butler").
      if (parts.length && !parts.some((p) => wordIn(p, vocabulary))) return m[0];
    }
  }
  return null;
}

/** Check one reply against the contract; null = accepted. */
export function checkReply(r: GuardReply, g: GuardInput): GuardVerdict | null {
  const v = checkReplyRules(r, g);
  return v && withPlannedReveal(v, g.directives);
}

/** Phrases that tell the model to confess nothing; wrong on a turn whose directive REQUIRES a confession. */
const ADMIT_NOTHING = /\s*Still admit nothing new\.?/g;

/**
 * C2: on a turn with a planned reveal (directives.revealSecret: a deferred stress reveal, a breakdown that is also a
 * reveal, a clue or testimony that cracks a story), a retry note must never tell the model to admit nothing: that
 * contradicts the directive and costs the beat. Any "admit nothing new" is dropped, and the note ends by keeping the
 * confession this turn requires and fixing only the flagged problem. General: applies to every reason.
 */
export function withPlannedReveal(v: GuardVerdict, d: Pick<TurnDirectives, "revealSecret">): GuardVerdict {
  if (!d.revealSecret) return v;
  const note = v.note.replace(ADMIT_NOTHING, "").trim();
  return { ...v, note: `${note} ${plannedRevealNote(d.revealSecret.id)}` };
}

export function plannedRevealNote(secretId: string): string {
  return `This turn still REQUIRES your confession ("${secretId}", as your ENGINE DIRECTIVE says): keep that confession in your reply and fix only the problem above.`;
}

function checkReplyRules(r: GuardReply, g: GuardInput): GuardVerdict | null {
  const said = `${r.dialogue} ${r.action ?? ""}`;
  const victim = g.caseData.victim.name;

  // 0. English only (#45): the guilt check reads English, and every persona speaks period English.
  const foreign = findForeignLanguage(said);
  if (foreign) {
    return {
      reason: "not_english",
      note: "Your line was not in English. Speak ONLY English, in your own period voice, in dialogue and action alike. If the detective used another language, you do not understand it: say so, politely or haughtily, in English, and answer nothing in that language.",
      detail: `${foreign.reason}:${foreign.text.slice(0, 80)}`,
    };
  }

  // 1. Core guilt first: a line admitting the killing is never accepted, whatever else it gets right.
  // Dialogue (third-person self-naming included), the action field, and a bare "yes" to a spelled-out accusation (#45).
  const admits = (r.admits ?? []).map((a) => a.trim()).filter(Boolean);
  const leak = findReplyGuiltLeak(r, g.heard, g.guilt, g.characterId, { speakerNames: speakerNamesOf(g.caseData, g.characterId) });
  if (leak) return { reason: "guilt_leak", note: guiltRetryNote(leak, victim), detail: leak.text.slice(0, 120) };
  if (admits.some((a) => /^killing$/i.test(a))) {
    return { reason: "guilt_leak", note: guiltRetryNote({ kind: "killing", text: r.dialogue }, victim), detail: "admits:killing" };
  }

  // 2. The model's own account of what the line concedes, checked against what the engine unlocked.
  const ch = g.caseData.characters.find((c) => c.id === g.characterId);
  if (ch && admits.length) {
    const core = coreGuiltSecretIds(g.caseData);
    const own = new Map(ch.secrets.map((s) => [s.id, s]));
    const admitted = new Set(g.ctx.secrets.map((s) => s.id));
    const thisTurn = g.directives.revealSecret?.id;
    const conceded = new Set([...g.directives.exposedLieIds, ...(g.directives.retiredLieIds ?? [])]);
    const lies = new Map(g.ctx.intendedLies.map((l) => [l.id, l]));
    const stonewall = "Say your line again WITHOUT admitting it: keep your story, or deflect and refuse to discuss it. Leave it out of admits.";
    const coreHit = admits.find((a) => core.has(a));
    if (coreHit) return { reason: "admits_core_guilt", note: `Your line conceded "${coreHit}", which you never admit. ${stonewall}`, detail: `admits:${coreHit}` };
    const fresh = admits.filter((a) => own.has(a) && !admitted.has(a));
    if (fresh.length > 1) {
      return { reason: "multiple_reveals", note: `Your line confessed several things (${fresh.join(", ")}). Confess at most ${thisTurn ? `only "${thisTurn}"` : "nothing"} this turn. ${stonewall}`, detail: `admits:${fresh.join(",")}` };
    }
    const locked = fresh.find((a) => a !== thisTurn);
    if (locked) return { reason: "admits_locked_secret", note: `Your line confessed "${locked}", which the engine has not unlocked. ${stonewall}`, detail: `admits:${locked}` };
    const kept = admits.find((a) => {
      const l = lies.get(a);
      return l !== undefined && l.status === "maintain" && !conceded.has(a);
    });
    if (kept) return { reason: "concedes_maintained_lie", note: `Your line conceded the story "${kept}", which you still MAINTAIN. ${stonewall}`, detail: `admits:${kept}` };
  }

  // 2a. Per-character forbidden phrases from the case data (#46). A secret revealed this exchange counts as revealed.
  const banned = findForbiddenPhrase(r.dialogue, ch?.forbiddenPhrases, forbiddenStateOf(g));
  if (banned) {
    return {
      reason: "forbidden_phrase",
      note: `Your line said "${banned.match.slice(0, 80)}", which you cannot say: you did not see, hear or do that, or you have not admitted it. Say only what WHAT YOU KNOW, your stories and ALREADY ADMITTED support; if you only suspect something, say it is a suspicion, or deflect.`,
      detail: `forbidden:${banned.index}:${banned.match.slice(0, 80)}`,
    };
  }  // 2a'. E8: the generic third-person over-claim (a non-culprit stating a culprit act as fact), after the case's own
  // forbidden phrases so a data entry still names its reason; acts covered by a held secret or card pass.
  if (g.characterId !== g.guilt.murdererId) {
    const oc = findGuiltLeak(r.dialogue, g.guilt, g.characterId, { speakerNames: speakerNamesOf(g.caseData, g.characterId), overClaim: { covered: coveredActs(g) } });
    if (oc?.overClaim) return { reason: "over_claim", note: overClaimNote(oc.text), detail: `over_claim:${oc.kind}:${oc.text.slice(0, 100)}` };
  }

  // 2b. Never retract what the engine has revealed (#48), breakdowns included.
  const revealedNow = [...g.ctx.secrets.map((s) => s.id), ...(g.directives.revealSecret ? [g.directives.revealSecret.id] : [])];
  const retraction = findRetraction(r.dialogue, g.caseData, g.characterId, revealedNow, g.guilt);
  if (retraction) {
    const what = g.ctx.secrets.find((s) => s.id === retraction.secretId)?.description ?? g.directives.revealSecret?.description ?? retraction.secretId;
    return {
      reason: "retracts_admission",
      note: `Your line took back something you have ALREADY ADMITTED ("${what}"). Never deny it, retract it or go back to the old story, not even in a breakdown or in anger: rage, weep, refuse to say more, or change the subject instead.`,
      detail: `${retraction.kind}:${retraction.text.slice(0, 100)}`,
    };
  }

  // 3. Canon clock times (#6).
  const res = checkTimes(said, g.allowedTimes);
  if (!res.ok) {
    return {
      reason: "unknown_time",
      note: `You stated a time you do not know (${res.offending.map((x) => `"${x}"`).join(", ")}). Use only times from WHAT YOU KNOW or your stories, and only the time on the line about THAT person or event, or stay vague ("I couldn't say, sir"). Do not work out a clock time yourself: if it is not listed, say it relative to a listed event ("a couple of minutes after the candles").`,
      detail: res.offending.join(","),
    };
  }
  // 3b. A time attached to an event must be that event's time (#44), for every speaker.
  const evMiss = checkEventTimes(said, g.caseData, g.ctx);
  if (evMiss.length) {
    return {
      reason: "event_time",
      note: `You put the wrong clock time on an event (${evMiss.map((m) => `"${m.text}"`).join(", ")}). Give an event only the time listed for THAT event in WHAT YOU KNOW or ALREADY ADMITTED; if no time is listed for it, do not put a clock time on it at all: say it vaguely ("that evening", "before the lights went out") or relative to a listed event.`,
      detail: evMiss.map((m) => `${m.text}@${m.eventIds.join("|")}`).join(",").slice(0, 160),
    };
  }

  // 4. Order of events (#26).
  const world = caseWorld(g.caseData);
  const order = checkOrder(said, g.ctx, g.directives.revealSecret ?? null, world.order);
  if (!order.ok) {
    return {
      reason: "event_order",
      note: `You described when something happened in a way that contradicts the order of events (${order.offending.map((x) => `"${x}"`).join(", ")}). ${order.hint ?? ""} Use the clock times from WHAT YOU KNOW, or one landmark from THE EVENING IN ORDER exactly as listed.`,
      detail: order.offending.join(","),
    };
  }
  // 5. Names: nobody the character was never told about.
  const name = findUnknownName(said, `${g.promptText}\n${g.heard}`);
  if (name) return { reason: "unknown_name", note: `You mentioned "${name}", who is not part of this case. Speak only of people named in your instructions or by the detective.`, detail: name };

  // 6. Performance rules.
  if (g.confrontation) {
    const again = repeatsEarlier(r.dialogue, g.ctx);
    if (again) return { reason: "repeat", note: `You already said almost exactly this earlier in the conversation: "${again}". Do NOT repeat it or reword it lightly. Answer ${g.confrontation.partnerName}'s last point first, then say something NEW (a different fact, angle or reaction).`, detail: again.slice(0, 120) };
    const wrong = addressesWrongPerson(r.dialogue, g.ctx, g.confrontation.partnerName);
    if (wrong) return { reason: "wrong_addressee", note: `You addressed "${wrong}" but you are face to face with ${g.confrontation.partnerName}. Speak only to ${g.confrontation.partnerName} (and the detective).`, detail: wrong };
  }
  // #52: one on one, a reply that says nothing new (every sentence nearly repeats the last replies) is retried once.
  // Partial repeats, openers and actions are rewritten for free after acceptance (ai/delivery.ts). Never on a reveal or
  // breakdown turn (those always carry something new, and a second miss would cost the beat).
  if (!g.confrontation && !g.directives.revealSecret && !g.directives.breakdown) {
    const again = repeatsRecentReply(r.dialogue, g.ctx);
    if (again) return { reason: "repeat", note: `You already said almost exactly this in your last replies: "${again}". Do NOT repeat it or reword it lightly: answer what the detective just said, with something new (a different angle, reaction or fact you know), keeping every story the same.`, detail: again.slice(0, 120) };
  }
  if (g.directives.breakdown && !isOutburst(r.dialogue)) {
    return { reason: "no_outburst", note: `This turn is your BREAKDOWN: burst out loud, panicked, furious or sobbing. Your dialogue must contain ${outburstRuleText()}. Still admit nothing new.`, detail: "" };
  }
  const { setting } = caseWorld(g.caseData);
  const modern = findModernWord(said, g.heard, setting.isDefault ? undefined : setting);
  if (modern) {
    const who = setting.isDefault ? "A 1920s character" : `Someone living ${setting.place} in ${setting.era}`;
    return { reason: "modern_word", note: `You used the modern word "${modern}". ${who} would never say or repeat it; react with period bafflement ("A what, sir?") without the word.`, detail: modern };
  }
  return null;
}

/** One structured line per rejection (never the prompt, never a key). */
export function logReject(e: { gameId?: string; characterId: string; reason: GuardReason; attempt: number; detail: string }): void {
  console.warn(JSON.stringify({ event: "ai_guard_reject", gameId: e.gameId ?? null, character: e.characterId, reason: e.reason, attempt: e.attempt, detail: e.detail.slice(0, 120) }));
}

const CALM = [
  "I have said all I intend to say on that subject.",
  "That is not a question I shall dignify with an answer.",
  "You may ask it as many ways as you please; my answer is the same.",
  "I think we had better talk about something else.",
];
const RATTLED = [
  "No. No, I won't be drawn on that. Ask me something else!",
  "Stop it! I have nothing more to say about that!",
  "You twist everything I say. I am not answering that.",
  "I... I need a moment. And then I'll still not answer that.",
];

/**
 * The safe in-character line when a reply broke the contract twice: keyed to the character's stress, quirks/tells and
 * authored `voice` (#52). Lines rotate by turn and never repeat one said in the character's recent replies; authored
 * voice.deflections come first, but only those `isSafe` accepts (the caller runs them through the guard's own checks).
 *
 * E9 (CA-37): the REASON never changes the pool. A guilt-path rejection (guilt_leak, admits_core_guilt) draws from the
 * same authored deflections, actions, quirks and tells, the same generic lines and the same emotions as any other
 * rejection. Only the culprit really hits the guilt path, so a separate guilt-only pool was a tell. Actions are
 * filtered by `isSafeAction` (the caller runs the guilt and era checks on them) for every reason alike.
 */
export function safeDeflection(
  ctx: CharacterContext,
  reason: GuardReason,
  turn: number,
  isSafe: (line: string) => boolean = () => true,
  isSafeAction: (action: string) => boolean = () => true,
): { dialogue: string; action: string; emotion: "defensive" | "panicked" | "nervous" } {
  void reason; // kept for logging callers; deliberately not used to pick the pool (E9)
  const rattled = ctx.state.stress >= 61;
  const generic = rattled ? RATTLED : CALM;
  const authored = (ctx.voice?.deflections ?? []).filter(isSafe);
  const lines = [...authored, ...generic];
  const i = Math.abs(turn);
  const dialogue = freshPick(lines, i, (l) => !saidRecently(l, ctx)) ?? lines[i % lines.length]!;
  const p = ctx.persona.personality;
  const own = rattled ? [...(p.tells ?? []), ...(p.quirks ?? [])] : [...(p.quirks ?? []), ...(p.tells ?? [])];
  // The character's own actions for every reason; any that could touch the scene are dropped by isSafeAction.
  const pool = [...(ctx.voice?.actions ?? []), ...own].filter(isSafeAction);
  const recentActions = recentReplies(ctx).map((r) => r.action).filter((x): x is string => Boolean(x));
  const action = pool.length ? (freshPick(pool, i, (a) => !recentActions.some((x) => sameAction(x, a))) ?? pool[i % pool.length]!) : rattled ? "looks away, flustered" : "folds arms";
  return { dialogue, action, emotion: rattled ? "nervous" : "defensive" };
}
