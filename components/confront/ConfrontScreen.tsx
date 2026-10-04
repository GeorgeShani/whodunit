"use client";

import { useId, useState } from "react";
import { DialogueLog, type DialogueMessage } from "@/components/dialogue/DialogueLog";
import { ThinkingIndicator } from "@/components/dialogue/ThinkingIndicator";
import { CartoonButton } from "@/components/game/CartoonButton";
import { InterrogationStage } from "@/components/stage/InterrogationStage";
import { RetryBar } from "@/components/dialogue/RetryBar";
import { StressMeter } from "@/components/stress/StressMeter";
import { MAX_QUESTION_CHARS } from "@/ai/interrogate-schema";
import type { PublicSuspect, StageArt } from "@/engine/public-view";
import type { Emotion } from "@/engine/types";

/**
 * Confrontation (MASTER_PLAN §32 / Scene 6): two suspects split-screen, the
 * detective questions one in front of the other, the other reacts. The engine
 * caps it at `max` exchanges; the counter shows how many are left.
 */
export function ConfrontScreen({
  pair,
  emotions,
  stress,
  stage,
  messages,
  pending,
  speakingId,
  turnsUsed,
  max,
  over,
  onAsk,
  target,
  onTarget,
  onOpenNotebook,
  onBack,
  onRetry,
}: {
  pair: [PublicSuspect, PublicSuspect];
  emotions: Record<string, Emotion>;
  stress: Record<string, number>;
  stage?: StageArt;
  messages: DialogueMessage[];
  pending: boolean;
  speakingId: string | null;
  turnsUsed: number;
  max: number;
  over: boolean;
  /** Returns false if not accepted. */
  onAsk: (addressedId: string, question: string) => boolean;
  /** Who is being questioned (controlled: the notebook presents to them). */
  target: string;
  onTarget: (id: string) => void;
  /** Open the notebook to hold up a clue or testimony to `target` (counts as the exchange). */
  onOpenNotebook?: () => void;
  onBack: () => void;
  /** The model could not answer the last exchange (nothing was spent): put it again. */
  onRetry?: () => void;
}) {
  const [a, b] = pair;
  const setTarget = onTarget;
  const [text, setText] = useState("");
  const hintId = useId();
  const first = (s: PublicSuspect) => s.name.split(" ")[0];
  const addressed = target === b.id ? b : a;
  const other = target === b.id ? a : b;
  const locked = pending || over;
  const left = Math.max(0, max - turnsUsed);
  const tooLong = text.trim().length > MAX_QUESTION_CHARS;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#5b1d1d_0%,#1b1035_60%,#120a24_100%)] p-3 sm:p-4 short:p-2">
      <header className="mb-2 short:mb-1 flex min-w-0 items-center gap-2 pe-12 sm:mb-3 sm:gap-3">
        <CartoonButton tone="white" onClick={onBack} aria-label="Back to suspects" className="min-h-12 short:min-h-11 shrink-0 px-3 sm:px-4">
          ← <span className="max-sm:hidden">Back to suspects</span>
          <span className="sm:hidden">Back</span>
        </CartoonButton>
        <h1 data-autofocus tabIndex={-1} className="min-w-0 text-balance font-display text-xl leading-[0.95] tracking-wide text-yellow-300 [-webkit-text-stroke:1px_#000] drop-shadow-[2px_2px_0_#000] sm:text-4xl sm:leading-tight">
          {first(a)} <span className="text-red-500">VS</span> {first(b)}
        </h1>
        <span
          className={`ms-auto shrink-0 rounded-lg border-2 border-black px-2.5 py-1 text-sm font-black text-black ${over ? "bg-neutral-300" : "bg-yellow-300"}`}
          data-confront-left={left}
          aria-live="polite"
        >
          {over ? "Over" : `${left} left`}
          <span className="sr-only"> of {max} exchanges</span>
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col-reverse gap-3 md:flex-row md:gap-4 short:flex-row short:gap-2">
        <section className="flex min-h-0 flex-1 flex-col gap-2 short:[&_button]:text-sm" aria-label={`Confrontation between ${a.name} and ${b.name}`}>
          <DialogueLog
            messages={messages}
            characterName={`${first(a)} and ${first(b)}`}
            emptyLine={`${first(a)} and ${first(b)} eye you warily. Ask a question, detective.`}
            footer={pending ? <ThinkingIndicator name={first(addressed)} seed={messages.length} /> : null}
          />
          {over ? (
            <p role="status" className="rounded-xl border-[3px] border-black bg-yellow-100 px-3 py-2 text-center font-bold text-black">
              The confrontation is over. They&apos;ve said all they&apos;ll say to each other tonight.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Who are you questioning?">
                <span className="text-base font-bold text-yellow-100">Question:</span>
                {[a, b].map((s) => (
                  <CartoonButton
                    key={s.id}
                    role="radio"
                    aria-checked={target === s.id}
                    tone={target === s.id ? "yellow" : "white"}
                    disabled={locked}
                    data-confront-target={s.id}
                    onClick={() => setTarget(s.id)}
                    className="min-h-12 short:min-h-11 px-4 text-base"
                  >
                    {first(s)}
                  </CartoonButton>
                ))}
              </div>
              {onRetry && !pending && <RetryBar onRetry={onRetry} disabled={over} />}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = text.trim();
                  if (!q || locked || tooLong) return;
                  if (onAsk(target, q)) setText("");
                }}
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={`Ask ${first(addressed)}…`}
                  aria-label={`Question ${addressed.name} in front of ${other.name}`}
                  aria-describedby={hintId}
                  aria-invalid={tooLong || undefined}
                  className="min-h-12 short:min-h-11 min-w-0 flex-1 rounded-xl border-[3px] border-black bg-white px-4 py-2 text-base font-medium text-black shadow-[4px_4px_0_#000] focus:bg-yellow-50"
                />
                <CartoonButton type="submit" tone="red" className="min-h-12 short:min-h-11 px-5 text-base" disabled={locked || !text.trim() || tooLong}>
                  ASK!
                </CartoonButton>
              </form>
              <div className="flex flex-wrap items-center gap-2">
                <p id={hintId} className="min-w-0 flex-1 basis-40 px-1 text-sm font-bold text-yellow-100/70">
                  {first(other)} will react to {first(addressed)}&apos;s answer.
                </p>
                {onOpenNotebook && (
                  <CartoonButton tone="yellow" disabled={locked} data-confront-present onClick={onOpenNotebook} className="min-h-12 short:min-h-11 shrink-0 px-3 text-base">
                    📓 Present to {first(addressed)}
                  </CartoonButton>
                )}
              </div>
            </>
          )}
        </section>

        <div className="kb-hide relative flex h-[calc(var(--app-h)*0.34)] shrink-0 md:h-auto md:flex-[1.15] short:h-auto short:flex-[0.55]">
          <InterrogationStage
            art={stage}
            actors={[
              { suspect: a, emotion: emotions[a.id] ?? a.emotion.emotion, speaking: speakingId === a.id, pending: pending && target === a.id },
              { suspect: b, emotion: emotions[b.id] ?? b.emotion.emotion, speaking: speakingId === b.id },
            ]}
            className="h-full w-full rounded-2xl border-4 border-black shadow-[6px_6px_0_#000]"
          />
          <StressMeter value={stress[a.id] ?? 0} name={a.name} compact className="absolute left-2 top-2 w-36 sm:w-40" />
          <StressMeter value={stress[b.id] ?? 0} name={b.name} compact className="absolute right-2 top-2 w-36 sm:w-40" />
          <p aria-hidden className="pointer-events-none absolute inset-x-0 bottom-2 text-center font-display text-3xl tracking-widest text-red-500 [-webkit-text-stroke:1.5px_#000] drop-shadow-[3px_3px_0_#000] sm:text-5xl">
            VS
          </p>
        </div>
      </div>
    </main>
  );
}
