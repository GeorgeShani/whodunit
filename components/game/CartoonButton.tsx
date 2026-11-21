"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { getAudio } from "@/components/effects/audio";

type Tone = "red" | "yellow" | "white" | "violet";
const TONES: Record<Tone, string> = {
  red: "bg-red-600 text-white hover:bg-red-500", // #103: white on red-500 is 3.76:1; red-600 is 4.83:1 (WCAG AA)
  yellow: "bg-accent text-ink hover:bg-yellow-200",
  white: "bg-white text-ink hover:bg-yellow-50",
  violet: "bg-violet-400 text-ink hover:bg-violet-300",
};

export function CartoonButton({
  tone = "yellow",
  className = "",
  sound = true,
  onClick,
  ...props
}: HTMLMotionProps<"button"> & { tone?: Tone; /** UI click blip (debounced by the audio manager). */ sound?: boolean }) {
  return (
    <motion.button
      type="button"
      whileHover={props.disabled ? undefined : { scale: 1.05, rotate: -1 }}
      whileTap={props.disabled ? undefined : { scale: 0.95 }}
      onClick={(e) => {
        if (sound) getAudio().play("ui_click");
        onClick?.(e);
      }}
      className={`cursor-pointer rounded-xl border-[3px] border-black px-4 py-2 font-bold shadow-[4px_4px_0_#000] disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}
