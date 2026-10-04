"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { bandIndex, STRESS_BANDS, stressBand, type StressBand } from "@/engine/stress";

const FILL: Record<StressBand, string> = {
  calm: "bg-emerald-400",
  defensive: "bg-yellow-300",
  nervous: "bg-orange-400",
  panicking: "bg-red-500",
  breakdown: "bg-fuchsia-500",
};

/**
 * Engine stress gauge (MASTER_PLAN §18 bands). The value comes from the server
 * reading; the meter only displays it. It jolts when the band goes up (skipped
 * under reduced motion) and is a proper role="meter" for screen readers.
 */
export function StressMeter({ value, name, compact = false, className = "" }: { value: number; name: string; compact?: boolean; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  const band = stressBand(value);
  const label = STRESS_BANDS.find((b) => b.band === band)?.label ?? band;
  const prev = useRef(band);
  const [jolt, setJolt] = useState(0);
  useEffect(() => {
    if (bandIndex(band) > bandIndex(prev.current)) setJolt((n) => n + 1);
    prev.current = band;
  }, [band]);

  return (
    <motion.div
      key={reduced ? "meter" : `meter-${jolt}`}
      role="meter"
      aria-label={`${name}'s stress`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value} of 100, ${label}`}
      data-stress-band={band}
      className={`rounded-xl border-[3px] border-black bg-white/95 text-black shadow-[3px_3px_0_#000] ${compact ? "px-2 py-1.5" : "px-2.5 py-2"} ${className}`}
      animate={jolt && !reduced ? { x: [0, -5, 5, -3, 3, 0], scale: [1, 1.08, 1] } : undefined}
      transition={{ duration: 0.4 }}
    >
      <div className={`flex items-baseline justify-between gap-2 font-black uppercase leading-none ${compact ? "text-xs" : "text-sm"}`}>
        <span>Stress</span>
        <span className={band === "panicking" || band === "breakdown" ? "text-red-600" : ""}>{label}</span>
      </div>
      <div className={`relative mt-1.5 overflow-hidden rounded-full border-2 border-black bg-neutral-200 ${compact ? "h-3" : "h-4"}`} aria-hidden>
        {/* Band boundaries (30 / 60 / 80 / 95). */}
        {[30, 60, 80, 95].map((t) => (
          <span key={t} className="absolute top-0 h-full w-px bg-black/30" style={{ left: `${t}%` }} />
        ))}
        <motion.div
          className={`h-full ${FILL[band]}`}
          initial={false}
          animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 180, damping: 20 }}
        />
      </div>
    </motion.div>
  );
}
