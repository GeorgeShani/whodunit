import type { Emotion } from "@/engine/types";

const EMOJI: Record<Emotion, string> = {
  calm: "😌",
  nervous: "😰",
  defensive: "😤",
  angry: "😡",
  sad: "😢",
  scared: "😱",
  smug: "😏",
  amused: "😄",
  flustered: "😳",
  suspicious: "🤨",
  shocked: "😲",
  panicked: "🫨",
  relieved: "😮‍💨",
};

const COLOR: Partial<Record<Emotion, string>> = {
  angry: "bg-red-400",
  defensive: "bg-orange-300",
  nervous: "bg-lime-300",
  scared: "bg-lime-300",
  panicked: "bg-lime-300",
  flustered: "bg-pink-300",
  sad: "bg-sky-300",
  smug: "bg-violet-300",
  suspicious: "bg-violet-300",
  shocked: "bg-yellow-300",
};

export function EmotionBadge({ emotion }: { emotion: Emotion }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 border-black px-2 py-0.5 text-sm font-bold capitalize text-black shadow-[2px_2px_0_#000] ${COLOR[emotion] ?? "bg-white"}`}
    >
      <span aria-hidden>{EMOJI[emotion]}</span>
      {emotion}
    </span>
  );
}
