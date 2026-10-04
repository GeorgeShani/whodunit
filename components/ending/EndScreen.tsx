"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { CartoonButton } from "@/components/game/CartoonButton";
import type { AccuseResponseBody } from "@/engine/accuse-schema";
import type { MotiveOption } from "@/engine/case-schema";
import type { PublicEvidence, PublicSuspect } from "@/engine/public-view";
import type { PublicTestimony } from "@/engine/testimony";
import { citedConfessions, summaryRows } from "./summary";

/**
 * Final screen: outcome headline, then on a WIN the per-field verdict and the
 * full solution. A LOSS shows only what the player named and that the case went
 * unsolved (the server never sends the answer on a loss: one guess per game).
 */
export function EndScreen({
  result,
  suspects,
  evidence,
  motives,
  testimonies = [],
  onReplay,
  onPlayAgain,
}: {
  result: AccuseResponseBody;
  suspects: PublicSuspect[];
  evidence: PublicEvidence[];
  motives: MotiveOption[];
  /** Testimony cards the player holds (already public to them); the cited ones are listed. */
  testimonies?: PublicTestimony[];
  /** Watch the ending again (if there is one). */
  onReplay?: () => void;
  onPlayAgain: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const heading = useRef<HTMLHeadingElement>(null);
  // Keyboard/screen-reader users land on the verdict when the cut-scene hands over.
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  if (!result.accusation || !result.ending) return null;
  const won = result.outcome === "won";
  // A loss carries no verdict or solution (#22): the player only sees what they named.
  const rows = result.verdict
    ? summaryRows({ accusation: result.accusation, verdict: result.verdict, solution: result.solution, evidence: result.evidence }, { suspects, evidence, motives }, true)
    : [];
  const named = {
    murderer: suspects.find((x) => x.id === result.accusation!.murdererId)?.name ?? result.accusation.murdererId,
    weapon: [...(result.evidence ?? []), ...evidence].find((e) => e.id === result.accusation!.weaponId)?.name ?? result.accusation.weaponId,
    motive: motives.find((m) => m.id === result.accusation!.motiveId)?.label ?? result.accusation.motiveId,
  };
  const s = result.solution;
  const confessions = citedConfessions(result.accusation, testimonies);
  return (
    <main
      className={`screen-scroll relative flex min-h-0 flex-1 flex-col items-center gap-5 px-4 py-8 short:py-4 ${
        won ? "bg-[radial-gradient(circle_at_top,#a16207_0%,#1b1035_70%)]" : "bg-[radial-gradient(circle_at_top,#3f3f46_0%,#111827_75%)]"
      }`}
      data-end-screen={result.outcome}
    >
      <motion.h1
        ref={heading}
        data-autofocus
        tabIndex={-1}
        className={`pe-12 text-center font-display text-[clamp(2.75rem,10vw,5.5rem)] leading-none tracking-wider [-webkit-text-stroke:3px_#000] drop-shadow-[6px_6px_0_#000] ${
          won ? "text-yellow-300" : "text-red-500"
        }`}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -40, scale: 0.8 }}
        animate={reduced ? { opacity: 1 } : won ? { opacity: 1, y: [0, -30, 0, -10, 0], scale: 1 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7 }}
      >
        {result.ending.headline}
      </motion.h1>
      <p className="max-w-xl text-center text-lg font-bold text-yellow-100">
        {won ? "Justice is served, detective. The whole house is talking about you." : "Your case didn't hold up. The case went unsolved."}
      </p>

      <section aria-label="Your accusation" className="w-full max-w-3xl rounded-3xl border-4 border-black bg-[#fff8e7] p-4 text-black shadow-[6px_6px_0_#000]">
        <h2 className="mb-2 font-display text-3xl tracking-wide">Your accusation</h2>
        {!result.verdict && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base" data-named>
            <dt className="font-black uppercase text-neutral-600">Murderer</dt>
            <dd className="font-bold">{named.murderer}</dd>
            <dt className="font-black uppercase text-neutral-600">Weapon</dt>
            <dd className="font-bold">{named.weapon}</dd>
            <dt className="font-black uppercase text-neutral-600">Motive</dt>
            <dd className="font-bold">{named.motive}</dd>
          </dl>
        )}
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.field} className="flex flex-col rounded-xl border-[3px] border-black bg-white px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3" data-summary={r.field} data-correct={r.correct}>
              <span className="w-24 shrink-0 text-sm font-black uppercase text-neutral-600">{r.label}</span>
              <span className="flex-1 font-bold">
                <span aria-hidden>{r.correct ? "✅" : "❌"}</span> {r.yours}
                <span className="sr-only">{r.correct ? " (right)" : " (wrong)"}</span>
              </span>
              {!r.correct && r.truth && <span className="text-base font-semibold text-red-700">Truth: {r.truth}</span>}
            </li>
          ))}
        </ul>
      </section>

      {confessions.length > 0 && (
        <section aria-label="Confessions you cited" className="w-full max-w-3xl rounded-3xl border-4 border-black bg-sky-100 p-4 text-black shadow-[6px_6px_0_#000]" data-cited-confessions>
          <h2 className="mb-2 font-display text-3xl tracking-wide">Confessions you cited</h2>
          <ul className="flex flex-col gap-2">
            {confessions.map((t) => (
              <li key={t.id} data-confession={t.id} className="rounded-xl border-[3px] border-black bg-white px-3 py-2">
                <p className="font-display text-xl tracking-wide">🗣️ {t.characterName}</p>
                <p className="text-base font-semibold">&ldquo;{t.summary}&rdquo;</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s && (
        <section aria-label="The solution" className="w-full max-w-3xl rounded-3xl border-4 border-black bg-amber-100 p-4 text-black shadow-[6px_6px_0_#000]" data-solution>
          <h2 className="mb-1 font-display text-3xl tracking-wide">The solution</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
            <dt className="font-black uppercase text-neutral-600">Murderer</dt>
            <dd className="font-bold">{s.murderer.name}</dd>
            <dt className="font-black uppercase text-neutral-600">Weapon</dt>
            <dd className="font-bold">{s.weapon.name}</dd>
            <dt className="font-black uppercase text-neutral-600">Motive</dt>
            <dd className="font-bold">{s.motive.label}</dd>
            <dt className="font-black uppercase text-neutral-600">Where, when</dt>
            <dd className="font-bold">
              {s.location.name}, {s.time}
            </dd>
            <dt className="font-black uppercase text-neutral-600">Key evidence</dt>
            <dd className="font-bold">{s.keyEvidence.map((k) => k.name).join(", ")}</dd>
          </dl>
          {s.explanation && <p className="mt-2 text-base">{s.explanation}</p>}
        </section>
      )}

      <div className="flex flex-wrap justify-center gap-3 pb-4">
        {onReplay && (
          <CartoonButton tone="white" className="min-h-12 text-base" onClick={onReplay}>
            ↺ Watch the ending again
          </CartoonButton>
        )}
        <CartoonButton tone="red" className="min-h-14 font-display text-3xl tracking-widest" onClick={onPlayAgain}>
          PLAY AGAIN
        </CartoonButton>
      </div>
    </main>
  );
}
