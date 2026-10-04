/**
 * Pure ending sequencer (Phase 9). The cut-scene is: a short "verdict" beat
 * (the accusation lands), then each ending line in order, then done (end
 * screen). The UI only renders what these functions return.
 */
import type { AudioCue } from "@/components/effects/emotion-map";
import type { EndingBeat } from "@/engine/accuse-schema";
import type { Emotion } from "@/engine/types";

export type SeqPhase = "verdict" | "lines" | "done";
export interface SeqState {
  phase: SeqPhase;
  /** Current line (-1 during the verdict). */
  index: number;
}

/** How long the verdict beat holds before the first line (auto-advance). */
export const VERDICT_MS = 2600;

export const seqStart = (): SeqState => ({ phase: "verdict", index: -1 });

/** Tap / click / Space / Enter, or the auto-advance timer. */
export function seqNext(s: SeqState, total: number): SeqState {
  if (s.phase === "done") return s;
  const i = s.phase === "verdict" ? 0 : s.index + 1;
  return i < total ? { phase: "lines", index: i } : { phase: "done", index: total };
}

/** Skip all: straight to the end screen. */
export const seqSkip = (total: number): SeqState => ({ phase: "done", index: total });

/** Reading time for a line: ~55 ms a character, clamped to 2.5-10 s, plus the line's authored pause. */
export function lineDurationMs(beat: Pick<EndingBeat, "text" | "pauseMs">): number {
  const read = Math.min(10_000, Math.max(2_500, 1_200 + beat.text.length * 55));
  return read + Math.max(0, beat.pauseMs);
}

/** Auto-advance delay for the current state (null when done). */
export function autoDelayMs(s: SeqState, beats: readonly EndingBeat[]): number | null {
  if (s.phase === "verdict") return VERDICT_MS;
  if (s.phase === "done") return null;
  const b = beats[s.index];
  return b ? lineDurationMs(b) : null;
}

export interface CastMember {
  id: string;
  emotion: Emotion;
  speaking: boolean;
}

export interface Cast {
  /** 1 or 2 characters on stage (2 = split-screen, first-to-appear on the left). */
  actors: CastMember[];
  /** The current line is the narrator's (shown as a caption). */
  narrator: boolean;
}

/**
 * Who is on stage for the current state:
 * - verdict: the accused alone (shocked when right, smug when wrong: ART_BIBLE beats);
 * - a character line: the speaker plus the most recent other speaker (so
 *   Archibald's interjection puts him beside Victoria), first-to-appear on the left;
 * - a narrator line: the stage as it stood after the last character line;
 * - the escaped line: the real murderer alone, smug (MASTER_PLAN §36).
 */
export function castAt(
  beats: readonly EndingBeat[],
  s: SeqState,
  opts: { accusedId: string; won: boolean; escapedId?: string },
): Cast {
  if (s.phase === "verdict" || s.index < 0) {
    return { actors: [{ id: opts.accusedId, emotion: opts.won ? "shocked" : "smug", speaking: false }], narrator: false };
  }
  const i = Math.min(s.index, beats.length - 1);
  const beat = beats[i];
  if (beat?.section === "escaped") {
    return { actors: [{ id: opts.escapedId ?? opts.accusedId, emotion: "smug", speaking: false }], narrator: true };
  }
  const emotions = new Map<string, Emotion>();
  const order: string[] = [];
  const speakers: string[] = []; // character speakers, most recent last
  for (let k = 0; k <= i; k++) {
    const b = beats[k];
    if (!b || b.speaker === "narrator") continue;
    if (!order.includes(b.speaker)) order.push(b.speaker);
    if (b.emotion) emotions.set(b.speaker, b.emotion);
    speakers.push(b.speaker);
  }
  if (!speakers.length) return { actors: [{ id: opts.accusedId, emotion: opts.won ? "angry" : "smug", speaking: false }], narrator: true };
  const current = speakers[speakers.length - 1];
  const partner = [...speakers].reverse().find((x) => x !== current);
  const narrator = beat?.speaker === "narrator";
  const on = partner ? [current, partner].sort((a, b) => order.indexOf(a) - order.indexOf(b)) : [current];
  return {
    actors: on.map((id) => ({ id, emotion: emotions.get(id) ?? "calm", speaking: !narrator && id === current })),
    narrator,
  };
}

/** Clue ids to flash on the current line. */
export const flashIds = (beats: readonly EndingBeat[], s: SeqState): string[] => (s.phase === "lines" ? (beats[s.index]?.evidenceIds ?? []) : []);

export type StageFx = "shake" | "whiteFlash" | "punchIn" | "desaturate" | "hop";
export interface TimedEvent {
  at: number;
  sfx?: AudioCue;
  fx?: StageFx;
  /** Linear gain on the cue (default 1). */
  gain?: number;
}

/**
 * ART_BIBLE §6 event beats, retimed to the new kit (docs/SOUND_NOTES.md §8B),
 * as ms offsets from the start of the verdict: the accusation roll (with the
 * camera shake just after) for every ending, then case solved (thunder + white
 * flash, then fanfare with the camera punch-in and victory hop, then the
 * resolved theme) or wrong accusation (wah-wah + desaturate, then the minor
 * theme). The fanfare is for the SOLVED ending only.
 */
export function verdictEvents(won: boolean, reduced: boolean): TimedEvent[] {
  const ev: TimedEvent[] = [{ at: 0, sfx: "accusation_roll" }, { at: 1200, fx: "shake" }];
  if (won) {
    ev.push(
      { at: 1300, sfx: "thunder", fx: "whiteFlash" },
      { at: 2400, sfx: "fanfare", fx: "punchIn" },
      { at: 2400, fx: "hop" },
      { at: 5800, sfx: "theme_resolved" },
    );
  } else {
    ev.push({ at: 1500, sfx: "wah_wah", fx: "desaturate" }, { at: 4900, sfx: "theme_noir_minor" });
  }
  if (!reduced) return ev;
  // Reduced motion: no flash, shake, punch-in, hop or animated desaturate, and no flash-synced thunder.
  // The roll (a touch quieter), the fanfare / wah-wah and the themes stay.
  return ev
    .filter((e) => e.sfx && e.sfx !== "thunder")
    .map((e) => ({ at: e.at, sfx: e.sfx, ...(e.sfx === "accusation_roll" ? { gain: 0.8 } : {}) }));
}

/** Sound for entering a line: the escaped line sneaks off (footsteps), evidence lines ding, others pop. */
export function lineSfx(beat: EndingBeat | undefined): AudioCue | null {
  if (!beat) return null;
  if (beat.section === "escaped") return "footsteps_sneak";
  if (beat.evidenceIds.length) return "clue_stinger";
  return "dialogue_pop";
}
