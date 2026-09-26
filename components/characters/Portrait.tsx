"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useState } from "react";
import { effectMotion, emotionMap, overlayVariants, spriteVariants } from "@/docs/toonMotion";
import type { PublicSuspect } from "@/engine/public-view";
import type { Emotion } from "@/engine/types";
import { portraitSrc, resolvePose } from "./portrait-poses";
import { Silhouette } from "./Silhouette";
import { CANVAS_H, CANVAS_W, overlayPlacement, type OverlayPlacement, type SpritePose } from "./sprite-meta";

/** One effect overlay: intro variant, then its loop (if any), per docs/toonMotion.ts. */
function EffectOverlay({ placement }: { placement: OverlayPlacement }) {
  const { intro, loop } = effectMotion[placement.effect];
  const [phase, setPhase] = useState<string>(intro);
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: `${placement.leftPct}%`,
        top: `${placement.topPct}%`,
        width: `${placement.widthPct}%`,
        transformOrigin: `${placement.pivot[0] * 100}% ${placement.pivot[1] * 100}%`,
        zIndex: placement.layer === "front" ? 20 : 0,
      }}
      variants={overlayVariants}
      initial="hidden"
      animate={phase}
      exit="exit"
      onAnimationComplete={() => loop && phase === intro && setPhase(loop)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative overlay, positioned by % */}
      <img src={placement.src} alt="" className={`block w-full ${placement.flip ? "-scale-x-100" : ""}`} />
    </motion.div>
  );
}

/**
 * Full-body sprite (784x1224 canvas, facing LEFT, feet on a shared baseline)
 * with Toon's per-pose motion and emotion overlays. Falls back to a silhouette
 * when no sprites exist for the character.
 */
export function Portrait({
  suspect,
  emotion,
  speaking = false,
  mirrored = false,
  effects = true,
  className = "",
  priority = false,
}: {
  suspect: PublicSuspect;
  emotion: Emotion;
  /** Show the "talking" pose (if available) while a line is being delivered. */
  speaking?: boolean;
  /** Face right instead of left; overlay offsets are mirrored too. */
  mirrored?: boolean;
  /** Render emotion overlays (sweat, anger, shock...). */
  effects?: boolean;
  className?: string;
  priority?: boolean;
}) {
  const pose = resolvePose(emotion, suspect.poses, speaking);
  const overlays = pose && effects
    ? (emotionMap[pose as SpritePose]?.overlays ?? [])
        .map((fx) => overlayPlacement(suspect.portrait, pose, fx, { mirrored }))
        .filter((p): p is OverlayPlacement => p !== null)
    : [];

  return (
    <div className={`relative ${className}`} style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}>
      {pose ? (
        <motion.div
          className="absolute inset-0"
          style={{ originX: 0.5, originY: 1 }}
          variants={spriteVariants}
          animate={pose}
        >
          <AnimatePresence>
            {overlays.map((p) => (
              <EffectOverlay key={`${pose}-${p.effect}`} placement={p} />
            ))}
          </AnimatePresence>
          <Image
            src={portraitSrc(suspect.portrait, pose)}
            alt={`${suspect.name} looking ${emotion}`}
            fill
            sizes="(max-width: 768px) 50vw, 360px"
            className={`z-10 object-contain object-bottom drop-shadow-[6px_6px_0_rgba(0,0,0,0.35)] ${mirrored ? "-scale-x-100" : ""}`}
            priority={priority}
          />
        </motion.div>
      ) : (
        <Silhouette className="absolute inset-0 h-full w-full" />
      )}
    </div>
  );
}
