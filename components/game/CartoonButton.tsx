"use client";

import { motion, type HTMLMotionProps } from "framer-motion";

type Tone = "red" | "yellow" | "white" | "violet";
const TONES: Record<Tone, string> = {
  red: "bg-red-500 text-white hover:bg-red-400",
  yellow: "bg-yellow-300 text-black hover:bg-yellow-200",
  white: "bg-white text-black hover:bg-yellow-50",
  violet: "bg-violet-400 text-black hover:bg-violet-300",
};

export function CartoonButton({
  tone = "yellow",
  className = "",
  ...props
}: HTMLMotionProps<"button"> & { tone?: Tone }) {
  return (
    <motion.button
      type="button"
      whileHover={props.disabled ? undefined : { scale: 1.05, rotate: -1 }}
      whileTap={props.disabled ? undefined : { scale: 0.95 }}
      className={`cursor-pointer rounded-xl border-[3px] border-black px-4 py-2 font-bold shadow-[4px_4px_0_#000] disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}
