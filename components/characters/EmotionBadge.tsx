import { EMOTIONS } from "@/components/effects/emotion-map";
import type { Emotion } from "@/engine/types";

export function EmotionBadge({ emotion, className = "" }: { emotion: Emotion; className?: string }) {
  const spec = EMOTIONS[emotion];
  return (
    <span
      data-emotion-badge
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-black px-2.5 py-1 text-sm font-bold capitalize text-black shadow-[2px_2px_0_#000] ${spec?.badge ?? "bg-white"} ${className}`}
    >
      <span aria-hidden>{spec?.emoji}</span>
      {emotion}
    </span>
  );
}
