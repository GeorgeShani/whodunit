/**
 * In-character fallback performer: deterministic canned lines built from a
 * CharacterContext. Used when the model is unavailable (no key, timeout, HTTP
 * error, invalid output). Like the real performer it only sees the
 * character's scoped context; it decides nothing and never confesses.
 */
import type { CharacterContext } from "@/engine/context-builder";
import { CharacterResponseSchema, type CharacterResponse } from "./schemas";

const pick = <T,>(items: readonly T[], seed: number): T => items[Math.abs(seed) % items.length];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const base = { evidenceReactions: [], wantsToLeave: false, stressDelta: 0, trustDelta: 0 };

export function cannedCharacterResponse(
  ctx: CharacterContext,
  question: string,
  presentedEvidenceId?: string,
  turn = 0,
): CharacterResponse {
  const seed = hash(question) + turn;
  const q = question.toLowerCase();
  const victim = ctx.case.victim.name;

  if (presentedEvidenceId) {
    const ev = ctx.evidenceShown.find((e) => e.id === presentedEvidenceId);
    return CharacterResponseSchema.parse({
      ...base,
      dialogue: ev
        ? `${/^(the|a|an)\s/i.test(ev.name) ? ev.name.replace(/^./, (c) => c.toUpperCase()) : `The ${ev.name}`}?! I... I really couldn't say a word about that, detective. ...Is it warm in here?`
        : "What am I supposed to be looking at, detective?",
      emotion: "shocked",
      intensity: 0.7,
      action: "jumps a foot in the air",
      evidenceReactions: ev ? [{ evidenceId: ev.id, reaction: "surprised" }] : [],
    });
  }
  const other = ctx.case.otherCharacters.find((o) => q.includes(o.name.split(" ")[0].toLowerCase()));
  if (other) {
    return CharacterResponseSchema.parse({
      ...base,
      dialogue: pick(
        [
          `${other.name}? Hmph. I'd keep an eye on that one, if I were you. Both eyes, actually.`,
          `Between you and me, ${other.name} has been acting awfully peculiar tonight.`,
        ],
        seed,
      ),
      emotion: "suspicious",
      intensity: 0.5,
      action: "leans in conspiratorially",
    });
  }
  if (/\b(where|whereabouts|alibi)\b/.test(q)) {
    return CharacterResponseSchema.parse({
      ...base,
      dialogue: pick(
        [
          "My whereabouts? I was... around. Here and there. Mostly there. Definitely not anywhere suspicious!",
          "Where was I? Minding my own business, detective. It's a full-time job, you know.",
        ],
        seed,
      ),
      emotion: ctx.emotion.emotion === "calm" ? "defensive" : ctx.emotion.emotion,
      intensity: 0.5,
      action: "glances at the nearest exit",
    });
  }
  if (q.includes("victim") || q.includes(victim.toLowerCase()) || q.includes(victim.split(" ").pop()!.toLowerCase())) {
    return CharacterResponseSchema.parse({
      ...base,
      dialogue: pick(
        [
          `${victim}? A tragedy. A real tragedy. Pass the tissues. No, the big box.`,
          `Poor ${victim}. We weren't close... well, not THAT close. Why do you ask?`,
        ],
        seed,
      ),
      emotion: "sad",
      intensity: 0.6,
      action: "dabs eyes with an enormous handkerchief",
    });
  }
  return CharacterResponseSchema.parse({
    ...base,
    dialogue: pick(
      [
        "An excellent question, detective. I shall answer it... later. Much later.",
        "I beg your pardon? I'm sure I don't know what you mean. Ask me something else!",
        "Hmm. Hmm hmm. HMMMM. No comment.",
      ],
      seed,
    ),
    emotion: ctx.emotion.emotion,
    intensity: 0.4,
    action: "strokes chin thoughtfully",
  });
}
