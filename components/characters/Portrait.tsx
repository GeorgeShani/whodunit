"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useEffect, useState } from "react";
import { cuesFor, poseAssetUrls, portraitSrc } from "@/components/effects/emotion-map";
import { effectMotion, overlayVariants, spriteVariants } from "@/docs/toonMotion";
import type { PublicSuspect } from "@/engine/public-view";
import type { Emotion } from "@/engine/types";
import { Silhouette } from "./Silhouette";
import { CANVAS_H, CANVAS_W, overlayPlacement, type OverlayPlacement } from "./sprite-meta";

/**
 * Warm the browser cache with every pose (and its overlays) of the suspect on
 * stage, so the first emotion swap doesn't flash an empty frame. Sprites are
 * served as-is (unoptimized), so these URLs are exactly what <Image> requests.
 */
export function usePreloadPoses(suspect: Pick<PublicSuspect, "portrait" | "poses"> | null) {
  const key = suspect ? poseAssetUrls(suspect).join("|") : "";
  useEffect(() => {
    if (!key) return;
    const imgs = key.split("|").map((src) => {
      const img = new window.Image();
      img.decoding = "async";
      img.src = src;
      return img;
    });
    return () => imgs.forEach((img) => (img.src = ""));
  }, [key]);
}

/** One effect overlay: intro variant, then its loop (if any), per docs/toonMotion.ts. Loops are skipped under reduced motion. */
function EffectOverlay({ placement }: { placement: OverlayPlacement }) {
  const { intro, loop: fullLoop } = effectMotion[placement.effect];
  const reduced = useReducedMotion();
  const loop = reduced ? undefined : fullLoop;
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
  decorative = false,
  sizes = "(max-width: 768px) 50vw, 360px",
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
  /** Inside a labelled control (e.g. a suspect card): empty alt so the name isn't read twice (#10). */
  decorative?: boolean;
  sizes?: string;
}) {
  const { pose, overlays: fx, motion: variant } = cuesFor(emotion, suspect.poses, speaking);
  const overlays = pose && effects
    ? fx
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
          animate={variant}
        >
          <AnimatePresence>
            {overlays.map((p) => (
              <EffectOverlay key={`${pose}-${p.effect}`} placement={p} />
            ))}
          </AnimatePresence>
          <Image
            src={portraitSrc(suspect.portrait, pose)}
            alt={decorative ? "" : `${suspect.name} looking ${emotion}`}
            fill
            unoptimized
            sizes={sizes}
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
