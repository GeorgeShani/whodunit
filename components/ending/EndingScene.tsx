"use client";

import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAudio } from "@/components/effects/audio";
import { ClueArt } from "@/components/evidence/ClueArt";
import { InterrogationStage, type StageActor } from "@/components/stage/InterrogationStage";
import type { EndingPayload } from "@/engine/accuse-schema";
import type { PublicEvidence, PublicSuspect, StageArt } from "@/engine/public-view";
import { autoDelayMs, castAt, flashIds, lineSfx, seqNext, seqSkip, seqStart, verdictEvents, type SeqState, type StageFx } from "./sequence";

const camera: Record<"shake" | "punchIn" | "none", TargetAndTransition> = {
  shake: { x: [0, -8, 8, -5, 5, 0], scale: 1, transition: { duration: 0.35, ease: "linear" } },
  punchIn: { x: 0, scale: [1, 1.08], transition: { type: "spring", stiffness: 200, damping: 14, mass: 1.6 } },
  none: { x: 0, scale: 1 },
};

/**
 * The ending cut-scene (Phase 9): the accusation beat, then Agatha's ending
 * lines one by one on the interrogation stage. Each line shows its speaker's
 * sprite in the pose its emotion maps to (a second speaker splits the screen),
 * the narrator as a caption, and flashes the clues it cites. Lines auto-advance
 * (reading time + pauseMs); tap/click, Space or Enter advance; Skip (or Escape)
 * jumps to the end screen.
 */
export function EndingScene({
  ending,
  suspects,
  evidence,
  stage,
  onDone,
}: {
  ending: EndingPayload;
  suspects: PublicSuspect[];
  evidence: PublicEvidence[];
  stage?: StageArt;
  onDone: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const won = ending.outcome === "won";
  const beats = ending.beats;
  const [s, setS] = useState<SeqState>(seqStart);
  const [cam, setCam] = useState<"shake" | "punchIn" | "none">("none");
  const [flash, setFlash] = useState(0);
  const [desat, setDesat] = useState(0);
  const [hop, setHop] = useState(0);
  const doneRef = useRef(false);

  const next = useCallback(() => setS((x) => seqNext(x, beats.length)), [beats.length]);
  const skip = useCallback(() => setS(seqSkip(beats.length)), [beats.length]);

  // Verdict event beats (ART_BIBLE §6): sounds always, visuals unless reduced motion.
  useEffect(() => {
    const audio = getAudio();
    const apply = (fx: StageFx) => {
      if (fx === "shake" || fx === "punchIn") setCam(fx);
      else if (fx === "whiteFlash") setFlash((n) => n + 1);
      else if (fx === "desaturate") setDesat((n) => n + 1);
      else if (fx === "hop") setHop((n) => n + 1);
    };
    const timers = verdictEvents(won, reduced).map((e) =>
      setTimeout(() => {
        if (e.sfx) audio.play(e.sfx, e.gain !== undefined ? { gain: e.gain } : {});
        if (e.fx) apply(e.fx);
      }, e.at),
    );
    return () => timers.forEach(clearTimeout);
  }, [won, reduced]);

  // Auto-advance, per-line sound, and hand-off to the end screen.
  useEffect(() => {
    if (s.phase === "done") {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone();
      }
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (s.phase === "lines") {
      const cue = lineSfx(beats[s.index]);
      // Lines citing evidence get a quiet stinger; the murderer's escape is just the sneaking footsteps (the wah-wah is the verdict's).
      if (cue) getAudio().play(cue, cue === "clue_stinger" ? { gain: 0.5 } : {});
    }
    const ms = autoDelayMs(s, beats);
    if (ms !== null) timers.push(setTimeout(next, ms));
    return () => timers.forEach(clearTimeout);
  }, [s, beats, next, onDone]);

  // Space / Enter advance, Escape skips all (buttons keep their own Space/Enter).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return skip();
      if (e.key !== " " && e.key !== "Enter") return;
      if (e.target instanceof HTMLElement && e.target.closest("button, a, input, textarea")) return;
      e.preventDefault();
      next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, skip]);

  const byId = useMemo(() => new Map(suspects.map((x) => [x.id, x])), [suspects]);
  const cast = castAt(beats, s, { accusedId: ending.accusedId, won });
  const lineEmotion = s.phase === "lines" ? beats[s.index]?.emotion : undefined;
  const actors = cast.actors
    .map((a): StageActor | null => {
      const suspect = byId.get(a.id);
      // An authored emotion wins over the generic talking pose (flustered → nervous, panicked → shocked...).
      return suspect ? { suspect, emotion: a.emotion, speaking: a.speaking && !lineEmotion } : null;
    })
    .filter((a): a is StageActor => a !== null)
    .slice(0, 2);
  const beat = s.phase === "lines" ? beats[s.index] : undefined;
  const flashing = flashIds(beats, s)
    .map((id) => evidence.find((e) => e.id === id))
    .filter((e): e is PublicEvidence => Boolean(e));
  const accused = byId.get(ending.accusedId);
  const escaped = beat?.section === "escaped";

  return (
    <main
      className="relative flex min-h-0 flex-1 cursor-pointer select-none flex-col overflow-hidden bg-black"
      data-ending-scene={ending.outcome}
      data-speaker={beat?.speaker ?? "verdict"}
      data-section={beat?.section ?? "verdict"}
      data-autofocus
      tabIndex={-1}
      aria-label="Ending. Tap, Space or Enter for the next line; Escape skips."
      onClick={next}
    >
      <motion.div
        className="absolute inset-0"
        animate={camera[cam]}
        style={{ filter: reduced && !won ? "grayscale(0.5)" : undefined }}
      >
        <motion.div
          key={`desat-${desat}`}
          className="h-full w-full"
          animate={desat ? { filter: ["grayscale(0)", "grayscale(0.6)", "grayscale(0)"] } : undefined}
          transition={{ duration: 1.4, times: [0, 0.3, 1] }}
        >
          {actors.length > 0 && (
            <InterrogationStage art={stage} actors={actors as [StageActor] | [StageActor, StageActor]} storm={false} className="h-full w-full" />
          )}
        </motion.div>
      </motion.div>

      {/* White flash (case solved): 2 peaks in 0.6 s, well under 3 flashes a second. */}
      <AnimatePresence>
        {flash > 0 && (
          <motion.div
            key={`flash-${flash}`}
            aria-hidden
            className="pointer-events-none absolute inset-0 z-30 bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0, 0.8, 0] }}
            transition={{ duration: 0.6, times: [0, 0.08, 0.25, 0.35, 1] }}
          />
        )}
      </AnimatePresence>

      <div className="absolute left-3 top-3 z-40">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            skip();
          }}
          className="cursor-pointer min-h-12 rounded-xl border-[3px] border-black bg-white px-4 py-1.5 font-bold text-black shadow-[3px_3px_0_#000] hover:bg-yellow-50"
          aria-label="Skip the ending"
        >
          Skip ⏭
        </button>
      </div>

      {/* Verdict stamp, then (win) CASE SOLVED! with a victory hop; the escaped headline on a loss. */}
      <div className="pointer-events-none absolute inset-x-0 top-[12%] z-20 flex flex-col items-center gap-2 px-4 text-center">
        <AnimatePresence>
          {s.phase === "verdict" && accused && (
            <motion.p
              key="accuse"
              className="font-display text-[clamp(2rem,8vw,4.5rem)] leading-none tracking-wider text-yellow-300 [-webkit-text-stroke:2px_#000] drop-shadow-[5px_5px_0_#000]"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, scale: [0.4, 1.2, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              YOU ACCUSE {accused.name.split(" ")[0].toUpperCase()}!
            </motion.p>
          )}
          {s.phase === "verdict" && won && hop > 0 && (
            <motion.p
              key="solved"
              className="font-display text-[clamp(2.5rem,10vw,5.5rem)] leading-none tracking-wider text-red-500 [-webkit-text-stroke:3px_#000] drop-shadow-[6px_6px_0_#000]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, y: [0, -30, 0, -10, 0], scaleY: [1, 1.08, 0.9, 1.03, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            >
              {ending.headline}
            </motion.p>
          )}
          {s.phase === "verdict" && won && reduced && (
            <motion.p key="solved-rm" className="font-display text-5xl tracking-wider text-red-500 [-webkit-text-stroke:2px_#000]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {ending.headline}
            </motion.p>
          )}
          {escaped && (
            <motion.p
              key="escaped"
              className="font-display text-[clamp(2.5rem,10vw,5.5rem)] leading-none tracking-wider text-red-500 [-webkit-text-stroke:3px_#000] drop-shadow-[6px_6px_0_#000]"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -80 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              {ending.headline}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom: flashing clue cards, then the line. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 p-3 short:p-2 sm:p-5">
        <div className="flex flex-wrap justify-center gap-2" aria-live="polite">
          <AnimatePresence mode="popLayout">
            {flashing.map((e) => (
              <motion.div
                key={`${s.index}-${e.id}`}
                data-flash-evidence={e.id}
                className="flex items-center gap-2 rounded-xl border-[3px] border-black bg-yellow-200 px-3 py-1.5 font-bold text-black shadow-[4px_4px_0_#000]"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: -6 }}
                animate={
                  reduced
                    ? { opacity: 1 }
                    : { opacity: 1, scale: [0.4, 1.15, 1], rotate: 0, boxShadow: ["4px 4px 0 #000", "0 0 0 6px #fde047", "4px 4px 0 #000"] }
                }
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.6 }}
              >
                <ClueArt evidence={e} className="inline-flex size-8 items-center justify-center text-2xl" />
                {e.name}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <AnimatePresence mode="wait">
          {beat && (
            <motion.div
              key={s.index}
              role="status"
              className={`pointer-events-auto w-full max-w-3xl rounded-3xl border-4 border-black p-3 shadow-[6px_6px_0_#000] short:p-2 sm:p-4 ${
                cast.narrator ? "bg-amber-100 text-black" : "bg-[#fff8e7] text-black"
              }`}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <p className={`font-display text-xl tracking-wide sm:text-2xl ${cast.narrator ? "text-amber-800" : "text-red-600"}`}>
                {cast.narrator ? "NARRATOR" : beat.speakerName}
              </p>
              <p data-ending-line className={`text-base font-semibold leading-snug sm:text-xl ${cast.narrator ? "italic" : ""}`}>
                {beat.text}
              </p>
              <p className="mt-1 text-right text-sm font-bold text-neutral-500" aria-hidden>
                {s.index + 1}/{beats.length} · tap, Space or Enter ▶
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
