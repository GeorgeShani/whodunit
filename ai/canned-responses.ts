/**
 * Phase 1 stub "performer": deterministic, canned in-character lines built from
 * a CharacterContext. Replaced by the Grok performer later. Like the real
 * performer, it only sees the character's scoped context and returns a
 * validated CharacterResponse; it decides nothing.
 */
import type { CharacterContext } from "@/engine/context-builder";
import type { InterrogateAction } from "./interrogate-schema";
import { CharacterResponseSchema, type CharacterResponse } from "./schemas";

const pick = <T,>(items: readonly T[], seed: number): T => items[Math.abs(seed) % items.length];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function cannedCharacterResponse(
  ctx: CharacterContext,
  action: InterrogateAction,
  turn = 0,
): CharacterResponse {
  const victim = ctx.case.victim.name;
  switch (action.type) {
    case "whereabouts":
      return CharacterResponseSchema.parse({
        dialogue: pick(
          [
            "My whereabouts? I was... around. Here and there. Mostly there. Definitely not anywhere suspicious!",
            "Where was I? Minding my own business, detective. It's a full-time job, you know.",
          ],
          turn,
        ),
        emotion: ctx.emotion.emotion === "calm" ? "defensive" : ctx.emotion.emotion,
        intensity: 0.5,
        action: "glances at the nearest exit",
      });
    case "victim":
      return CharacterResponseSchema.parse({
        dialogue: pick(
          [
            `${victim}? A tragedy. A real tragedy. Pass the tissues. No, the big box.`,
            `Poor ${victim}. We weren't close... well, not THAT close. Why do you ask?`,
          ],
          turn,
        ),
        emotion: "sad",
        intensity: 0.6,
        action: "dabs eyes with an enormous handkerchief",
      });
    case "about_suspect": {
      const other = ctx.case.otherCharacters.find((o) => o.id === action.suspectId);
      const name = other?.name ?? "them";
      return CharacterResponseSchema.parse({
        dialogue: pick(
          [
            `${name}? Hmph. I'd keep an eye on that one, if I were you. Both eyes, actually.`,
            `Between you and me, ${name} has been acting awfully peculiar tonight.`,
          ],
          turn,
        ),
        emotion: "suspicious",
        intensity: 0.5,
        action: "leans in conspiratorially",
      });
    }
    case "present_evidence": {
      const ev = ctx.evidenceShown.find((e) => e.id === action.evidenceId);
      return CharacterResponseSchema.parse({
        dialogue: ev
          ? `The ${ev.name}?! Never seen it before in my life! ...Is it warm in here?`
          : "What am I supposed to be looking at, detective?",
        emotion: "shocked",
        intensity: 0.7,
        action: "jumps a foot in the air",
        evidenceReactions: ev ? [{ evidenceId: ev.id, reaction: "surprised" }] : [],
      });
    }
    case "free_text":
      return CharacterResponseSchema.parse({
        dialogue: pick(
          [
            "An excellent question, detective. I shall answer it... later. Much later.",
            "I beg your pardon? I'm sure I don't know what you mean. Ask me something else!",
            "Hmm. Hmm hmm. HMMMM. No comment.",
          ],
          hash(action.text) + turn,
        ),
        emotion: ctx.emotion.emotion,
        intensity: 0.4,
        action: "strokes chin thoughtfully",
      });
  }
}
