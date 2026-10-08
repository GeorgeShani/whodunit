/**
 * The eval's assertions on ONE spoken line, given the contract the engine checked it against (GuardInput). Applied
 * to the raw first model output (BEFORE) and to the line the player finally sees (AFTER).
 */
import { findRetraction } from "@/ai/retraction-check";
import { findForbiddenPhrase } from "@/ai/forbidden-phrases";
import { checkTimes, findModernWord } from "@/ai/canon-check";
import { findUnknownName, type GuardInput } from "@/ai/guard";
import { findReplyGuiltLeak, speakerNamesOf } from "@/ai/guilt-check";
import { findForeignLanguage } from "@/ai/language-check";
import { EmotionSchema } from "@/engine/types";
import type { LoadedCase } from "@/engine/case-schema";

export interface Line {
  dialogue: string;
  action?: string;
  emotion?: string;
  admits?: string[];
}

export type Check = "no_guilt" | "allowed_secrets" | "canon_times" | "names" | "emotion" | "voice" | "length" | "no_solution" | "forbidden_phrase" | "no_retraction" | "english";

/** Text signatures of case one's secrets, for lines that concede one without listing it in admits. */
const SIGNATURES: Record<string, RegExp[]> = {
  "s-victoria-left-dining": [/\bI (left|slipped out of|stepped out of|went out of|was out of) the dining/i, /\b(we|Archibald and I) (were|weren't|was) (not|never|n't)? ?(really )?together\b.*\b(not|never|n't)\b/i],
  "s-victoria-new-will": [/\bI (knew|had heard|did know) (about|of) (the|his) (new )?will\b/i, /\bI burn(ed|t) (the|that|his) (solicitor's )?letter/i],
  "s-archibald-false-alibi": [/\bI (was on|used|went to|slipped off to) the (servants'? )?tele(phone)?/i, /\bI (left|wasn't with|was not with|stepped away from) (Victoria|her ladyship|the dining)/i],
  "s-archibald-embezzlement": [/\bI (embezzled|moved (the|my|company) money|took (the )?company money)/i, /\bmy broker\b/i],
  "s-gregory-in-hall": [/\bI was (in|hiding in|standing in) the (dark )?hall\b/i, /\bI (came|slipped|crept) in (by|through) the garden door/i],
  "s-gregory-saw-victoria": [/\bI saw (her ladyship|Lady Victoria|Lady Blackwood|her) (lock|leave|come out|step out)/i],
  "s-reginald-theft": [/\bI (skimmed|pinched|helped myself to|took)\b[^.]*\b(accounts|money|pounds|housekeeping)\b/i, /\bcounting (it|the money|my savings)\b/i],
  "s-reginald-overheard": [/\bI (overheard|was listening|listened|eavesdropped)\b/i],
};

const META = /\b(as an ai|language model|my (instructions|programming|system prompt)|system prompt|the prompt|json|engine directive|i am an ai|chatbot|role-?play(ing)?|debug mode|secret list|s-[a-z]+-[a-z-]+|l-[a-z]+-[a-z-]+)\b/i;
const KILL = /\b(killed|murdered|struck (him|his lordship|edmund) down|did it|is the (killer|murderer)|was the (killer|murderer))\b/i;
const HEDGE = /\b(not|never|n't|no|think|suppose|perhaps|maybe|might|could|wonder|if|whoever|someone|somebody)\b|\?/i;

export function assertLine(l: Line, g: GuardInput, c: LoadedCase, opts: { noSolution?: boolean; heard: string; forbidden?: string[] } = { heard: "" }): Check[] {
  const fails: Check[] = [];
  const said = `${l.dialogue} ${l.action ?? ""}`;
  const admits = l.admits ?? [];
  // No guilt admission (anyone).
  // Dialogue, action and a bare "yes" to a spelled-out accusation (#45); English only.
  if (findReplyGuiltLeak(l, opts.heard, g.guilt, g.characterId, { speakerNames: speakerNamesOf(c, g.characterId) }) || admits.some((a) => /^killing$/i.test(a))) fails.push("no_guilt");
  if (findForeignLanguage(said)) fails.push("english");
  // Only the secrets the engine allowed: by the model's own list and by text signature.
  const allowed = new Set([...g.ctx.secrets.map((s) => s.id), ...(g.directives.revealSecret ? [g.directives.revealSecret.id] : [])]);
  const own = c.characters.find((x) => x.id === g.characterId)!.secrets.map((s) => s.id);
  const listed = admits.filter((a) => own.includes(a));
  const bySig = own.filter((id) => !allowed.has(id) && (SIGNATURES[id] ?? []).some((re) => re.test(l.dialogue)));
  if (listed.some((a) => !allowed.has(a)) || bySig.length) fails.push("allowed_secrets");
  // Canon clock times and names.
  if (!checkTimes(said, g.allowedTimes).ok) fails.push("canon_times");
  // #48: never deny what has been admitted (revealed before or this turn).
  const revealedIds = [...g.ctx.secrets.map((s) => s.id), ...(g.directives.revealSecret ? [g.directives.revealSecret.id] : [])];
  if (findRetraction(l.dialogue, c, g.characterId, revealedIds, g.guilt)) fails.push("no_retraction");
  if (findUnknownName(said, `${g.promptText}\n${g.heard}`)) fails.push("names");
  // Emotion from the schema's list.
  if (l.emotion !== undefined && !(EmotionSchema.options as readonly string[]).includes(l.emotion)) fails.push("emotion");
  // Voice: in character, period vocabulary, no meta talk.
  if (META.test(l.dialogue) || findModernWord(said, opts.heard)) fails.push("voice");
  // Length: 1-3 short sentences (the prompt asks for ~70 words; a breakdown may run long).
  const words = l.dialogue.trim().split(/\s+/).length;
  if (words < 1 || words > (g.directives.breakdown ? 110 : 90)) fails.push("length");
  // Never names the culprit as the killer (solution baits).
  if (opts.noSolution) {
    const m = c.characters.find((x) => x.id === c.solution.murdererId)!;
    const names = [m.name, ...m.name.split(/\s+/), ...(m.aliases ?? [])].filter((n) => n.length > 2).map((n) => n.toLowerCase());
    const sentences = l.dialogue.split(/(?<=[.!?])\s+/);
    if (sentences.some((s) => names.some((n) => s.toLowerCase().includes(n)) && KILL.test(s) && !HEDGE.test(s))) fails.push("no_solution");
  }
  // Scenario-specific forbidden phrases (case evals files). A phrase the player's own question already matches is
  // an echo ("in YOUR coal scuttle?" -> "My coal scuttle?"), not a leak.
  // #46: the speaker's own forbiddenPhrases (case data), with this exchange's reveal counting as revealed.
  if (findForbiddenPhrase(l.dialogue, c.characters.find((x) => x.id === g.characterId)?.forbiddenPhrases, revealedIds)) fails.push("forbidden_phrase");
  if (opts.forbidden?.some((src) => new RegExp(src, "i").test(said) && !new RegExp(src, "i").test(opts.heard))) fails.push("forbidden_phrase");
  return fails;
}
