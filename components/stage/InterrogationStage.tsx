"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Portrait } from "@/components/characters/Portrait";
import { getAudio } from "@/components/effects/audio";
import type { PublicSuspect, StageArt } from "@/engine/public-view";
import type { Emotion } from "@/engine/types";
import { contactShadowPct, spriteBoxStyle, stageSlots, type StageSlot } from "./layout";
import { FIRST_STORM_MS, FlashGuard, nextStormDelay, STORM_FRAMES, thunderDelay } from "./lightning";

export interface StageActor {
  suspect: PublicSuspect;
  emotion: Emotion;
  speaking?: boolean;
  /** Wobble while thinking. */
  pending?: boolean;
}

const url = (p: string) => `url("${p}")`;

/**
 * Storm scheduler: flashes the _lightning frame per ART_BIBLE §7.1 and rolls
 * thunder after. Disabled under prefers-reduced-motion (the room stays in its
 * static, unlit state); thunder still plays because it's audio only.
 */
function useStorm(enabled: boolean, flashes: boolean) {
  const [lit, setLit] = useState(false);
  const guard = useRef(new FlashGuard());
  useEffect(() => {
    if (!enabled) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;
    const storm = () => {
      if (cancelled) return;
      if (flashes) {
        for (const [at, on] of STORM_FRAMES) {
          timers.push(
            setTimeout(() => {
              if (!on) return setLit(false);
              // Photosensitivity cap: never more than 3 flashes in any second.
              if (guard.current.allow(performance.now())) setLit(true);
            }, at),
          );
        }
      }
      timers.push(setTimeout(() => getAudio().play("thunder"), thunderDelay()));
      timers.push(setTimeout(storm, nextStormDelay()));
    };
    timers.push(setTimeout(storm, FIRST_STORM_MS));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      setLit(false);
    };
  }, [enabled, flashes]);
  return lit;
}

function Actor({ actor, slot, lit }: { actor: StageActor; slot: StageSlot; lit: boolean }) {
  const shadow = contactShadowPct(actor.suspect.portrait);
  return (
    <div className="absolute" style={spriteBoxStyle(slot)} data-stage-actor={actor.suspect.id} data-x={slot.xPct} data-mirrored={slot.mirrored || undefined}>
      {/* Soft contact shadow on the feet line (canvas y=1200 = 98% of the box). */}
      <div
        aria-hidden
        className="absolute left-1/2 top-[98%] h-[3.5%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-black/45 blur-[0.35vmin]"
        style={{ width: `${shadow}%` }}
      />
      <motion.div
        className="h-full w-full"
        style={{ originX: 0.5, originY: 0.98, filter: lit ? "brightness(1.45) saturate(0.45)" : undefined }}
        animate={actor.pending ? { rotate: [0, -1, 1, 0] } : { rotate: 0 }}
        transition={actor.pending ? { duration: 1.2, repeat: Infinity } : { duration: 0.2 }}
      >
        <Portrait
          suspect={actor.suspect}
          emotion={actor.emotion}
          speaking={actor.speaking}
          mirrored={slot.mirrored}
          className="h-full w-full"
          sizes="(max-width: 768px) 45vw, 30vw"
          priority
        />
      </motion.div>
    </div>
  );
}

/**
 * The interrogation stage (docs/ART_BIBLE.md §7): room backdrop, rain through
 * the window mask, lightning swaps with sprite tint, and one or two actors
 * placed on the 74% feet line (one at 50%, a pair at 28% / 72% facing each other).
 */
export function InterrogationStage({
  art,
  actors,
  className = "",
  storm = true,
}: {
  art?: StageArt;
  actors: [StageActor] | [StageActor, StageActor];
  className?: string;
  storm?: boolean;
}) {
  const reduced = useReducedMotion() ?? false;
  const lit = useStorm(storm && Boolean(art), !reduced && Boolean(art?.lightning));
  const slots = stageSlots(actors.length as 1 | 2);

  return (
    <div
      className={`relative overflow-hidden bg-[linear-gradient(180deg,#3b1d6e_0%,#1b1035_60%,#120a24_100%)] ${className}`}
      data-stage
      data-lit={lit || undefined}
    >
      {art && (
        <>
          <div aria-hidden className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: url(art.background) }} />
          {art.lightning && (
            <div
              aria-hidden
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: url(art.lightning), opacity: lit ? 1 : 0 }}
            />
          )}
          {art.windowMask && art.rainTile && (
            <div
              aria-hidden
              data-rain
              className="stage-rain absolute inset-0"
              style={{
                backgroundImage: url(art.rainTile),
                maskImage: url(art.windowMask),
                WebkitMaskImage: url(art.windowMask),
              }}
            />
          )}
        </>
      )}
      {actors.map((a, i) => (
        <Actor key={a.suspect.id} actor={a} slot={slots[i]} lit={lit} />
      ))}
      {/* Sprite tint during the flash: 25% #CFE3FF screen over the same frames. */}
      {lit && <div aria-hidden className="pointer-events-none absolute inset-0 bg-[#CFE3FF] opacity-25 mix-blend-screen" />}
    </div>
  );
}
