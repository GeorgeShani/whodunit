"use client";

import { useState } from "react";
import { InterrogationStage } from "@/components/stage/InterrogationStage";
import type { PublicSuspect, StageArt } from "@/engine/public-view";
import { EmotionSchema, type Emotion } from "@/engine/types";

/** Dev-only controls around the split-screen stage. */
export function StagePreview({ suspects, art }: { suspects: PublicSuspect[]; art?: StageArt }) {
  const [left, setLeft] = useState(suspects[0]?.id);
  const [right, setRight] = useState(suspects[1]?.id ?? suspects[0]?.id);
  const [emotion, setEmotion] = useState<Emotion>("angry");
  const [split, setSplit] = useState(true);
  const a = suspects.find((s) => s.id === left) ?? suspects[0];
  const b = suspects.find((s) => s.id === right) ?? suspects[0];
  if (!a || !b) return <p>No suspects.</p>;
  const pick = (value: string | undefined, set: (v: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)} className="rounded border-2 border-black bg-white px-2 text-black">
      {suspects.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
  return (
    <main className="flex h-dvh flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2 pe-12 text-sm">
        <strong>Stage preview (dev only)</strong>
        {pick(left, setLeft)}
        {pick(right, setRight)}
        <select value={emotion} onChange={(e) => setEmotion(e.target.value as Emotion)} className="rounded border-2 border-black bg-white px-2 text-black">
          {EmotionSchema.options.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> split-screen
        </label>
      </div>
      <InterrogationStage
        art={art}
        actors={split ? [{ suspect: a, emotion }, { suspect: b, emotion }] : [{ suspect: b, emotion }]}
        className="aspect-video max-h-full w-full max-w-[calc((100dvh-4rem)*16/9)] self-center rounded-2xl border-4 border-black"
      />
    </main>
  );
}
