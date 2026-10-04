"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useId, useState } from "react";
import { MAX_QUESTION_CHARS } from "@/ai/interrogate-schema";
import { EmotionBadge } from "@/components/characters/EmotionBadge";
import { usePreloadPoses } from "@/components/characters/Portrait";
import { CartoonButton } from "@/components/game/CartoonButton";
import type { AskInput } from "@/components/game/Game";
import { InterrogationStage } from "@/components/stage/InterrogationStage";
import { StressMeter } from "@/components/stress/StressMeter";
import type { PublicEvidence, PublicSuspect, StageArt } from "@/engine/public-view";
import type { PublicTestimony } from "@/engine/testimony";
import type { Emotion } from "@/engine/types";
import { DialogueLog, type DialogueMessage } from "./DialogueLog";
import { ThinkingIndicator } from "./ThinkingIndicator";

type Menu = null | "suspects" | "confront";

export function InterrogationScreen({
  suspect,
  emotion,
  otherSuspects,
  evidence,
  testimonies = [],
  messages,
  pending,
  stage,
  busyWith = null,
  speaking = false,
  stress = 0,
  onAsk,
  onOpenNotebook,
  onConfront,
  onBack,
}: {
  suspect: PublicSuspect;
  emotion: Emotion;
  otherSuspects: PublicSuspect[];
  evidence: PublicEvidence[];
  /** Testimony cards (what other suspects have admitted), presentable like evidence. */
  testimonies?: PublicTestimony[];
  messages: DialogueMessage[];
  pending: boolean;
  /** Stage art (room backdrop, lightning frame, window mask); falls back to the night gradient. */
  stage?: StageArt;
  /** Someone else is mid-reply (or a search is running): controls lock, typed text is kept (#8). */
  busyWith?: string | null;
  speaking?: boolean;
  /** Engine stress 0..100 (Phase 7 meter). */
  stress?: number;
  /** Returns false if the question was not accepted (e.g. another reply is pending). */
  onAsk: (input: AskInput) => boolean;
  /** Open the notebook in "present to <name>" mode. */
  onOpenNotebook: () => void;
  /** Put this suspect face to face with another (MASTER_PLAN §32). */
  onConfront?: (otherId: string) => void;
  onBack: () => void;
}) {
  const [menu, setMenu] = useState<Menu>(null);
  const [text, setText] = useState("");
  const firstName = suspect.name.split(" ")[0];
  const locked = pending || Boolean(busyWith);
  const hintId = useId();
  // #12: no silent truncation; show a counter and block over-long questions instead.
  const over = text.trim().length - MAX_QUESTION_CHARS;
  // Warm every pose of this suspect so the first emotion swap doesn't flicker.
  usePreloadPoses(suspect);

  const ask = (question: string, presentedEvidenceId?: string, presentedTestimonyId?: string): boolean => {
    if (locked) return false;
    const accepted = onAsk({
      question,
      ...(presentedEvidenceId ? { presentedEvidenceId } : {}),
      ...(presentedTestimonyId ? { presentedTestimonyId } : {}),
    });
    if (accepted) setMenu(null);
    return accepted;
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#3b1d6e_0%,#1b1035_60%,#120a24_100%)] p-3 sm:p-4">
      {/* pe-12 leaves room for the fixed mute toggle; the name truncates instead of wrapping (#12). */}
      <header className="mb-2 flex min-w-0 items-center gap-2 pe-12 sm:mb-3 sm:gap-3">
        <CartoonButton tone="white" onClick={onBack} aria-label="Back to suspects" className="shrink-0 px-3 sm:px-4">
          ← <span className="max-sm:hidden">Back to suspects</span>
          <span className="sm:hidden">Back</span>
        </CartoonButton>
        <h1
          className="min-w-0 truncate font-display text-2xl tracking-wide text-yellow-300 [-webkit-text-stroke:1px_#000] drop-shadow-[2px_2px_0_#000] sm:text-4xl sm:[-webkit-text-stroke:1.5px_#000] sm:drop-shadow-[3px_3px_0_#000]"
          title={suspect.name}
        >
          <span className="max-sm:hidden">{suspect.name}</span>
          <span className="sm:hidden">{firstName}</span>
        </h1>
        <EmotionBadge emotion={emotion} className="max-sm:text-xs" />
      </header>

      {/* DOM order: conversation first. Phones: stage on top; md+: conversation left, stage right (the sprite faces left, toward it). */}
      <div className="flex min-h-0 flex-1 flex-col-reverse gap-3 md:flex-row md:gap-4">
        <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label={`Questioning ${suspect.name}`}>
          <DialogueLog
            messages={messages}
            characterName={suspect.name}
            footer={pending ? <ThinkingIndicator name={firstName} seed={messages.length} /> : null}
          />

          <div className="flex flex-wrap gap-2">
            <CartoonButton disabled={locked} onClick={() => ask("Where were you this evening, and what did you see?")}>
              📍 Whereabouts
            </CartoonButton>
            <CartoonButton disabled={locked} onClick={() => ask("Tell me about the victim. What were they like?")}>
              💀 The victim
            </CartoonButton>
            <CartoonButton
              tone={menu === "suspects" ? "violet" : "yellow"}
              disabled={locked || otherSuspects.length === 0}
              onClick={() => setMenu(menu === "suspects" ? null : "suspects")}
            >
              🕵️ Ask about…
            </CartoonButton>
            {onConfront && (
              <CartoonButton
                tone={menu === "confront" ? "violet" : "yellow"}
                disabled={locked || otherSuspects.length === 0}
                onClick={() => setMenu(menu === "confront" ? null : "confront")}
              >
                ⚔️ Confront…
              </CartoonButton>
            )}
            <CartoonButton disabled={locked} onClick={onOpenNotebook} aria-haspopup="dialog">
              🔍 Present evidence
              {evidence.length + testimonies.length > 0 ? ` (${evidence.length + testimonies.length})` : ""}
            </CartoonButton>
          </div>

          <AnimatePresence>
            {menu && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-xl border-[3px] border-black bg-violet-900/80 p-3">
                  {menu === "confront" && <p className="mb-2 text-sm font-bold text-yellow-100">Bring {firstName} face to face with…</p>}
                  <div className="flex flex-wrap gap-2">
                    {otherSuspects.map((o) => (
                      <CartoonButton
                        key={o.id}
                        tone="white"
                        disabled={locked}
                        {...(menu === "confront" ? { "data-confront-with": o.id } : {})}
                        onClick={() => (menu === "confront" ? onConfront?.(o.id) : ask(`What can you tell me about ${o.name}?`))}
                      >
                        {o.name}
                      </CartoonButton>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {busyWith && (
            <p role="status" className="rounded-lg border-2 border-black bg-yellow-100 px-3 py-1 text-sm font-bold text-black">
              ⏳ {busyWith}. Your question will keep.
            </p>
          )}

          <form
            className="flex flex-col gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const q = text.trim();
              if (!q || locked || over > 0) return;
              // Only clear the box once the question has actually been accepted (#8).
              if (ask(q)) setText("");
            }}
          >
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Ask ${firstName} anything…`}
                aria-label={`Ask ${suspect.name} a question`}
                aria-describedby={hintId}
                aria-invalid={over > 0 || undefined}
                data-autofocus
                className="min-w-0 flex-1 rounded-xl border-[3px] border-black bg-white px-4 py-2 font-medium text-black shadow-[4px_4px_0_#000] focus:bg-yellow-50 aria-invalid:bg-red-50"
              />
              <CartoonButton type="submit" tone="red" disabled={locked || !text.trim() || over > 0}>
                ASK!
              </CartoonButton>
            </div>
            <p
              id={hintId}
              aria-live="polite"
              className={`px-1 text-right text-xs font-bold ${over > 0 ? "text-red-300" : "text-yellow-100/70"}`}
            >
              {over > 0
                ? `Question too long: trim ${over} character${over === 1 ? "" : "s"} (max ${MAX_QUESTION_CHARS}).`
                : text.length >= MAX_QUESTION_CHARS * 0.8
                  ? `${text.trim().length}/${MAX_QUESTION_CHARS}`
                  : ""}
            </p>
          </form>
        </section>

        <div className="kb-hide relative flex h-[calc(var(--app-h)*0.34)] shrink-0 md:h-auto md:flex-[1.15]">
          <InterrogationStage
            art={stage}
            actors={[{ suspect, emotion, speaking, pending }]}
            className="h-full w-full rounded-2xl border-4 border-black shadow-[6px_6px_0_#000]"
          />
          <StressMeter value={stress} name={suspect.name} className="absolute left-2 top-2 w-32 sm:w-44" />
        </div>
      </div>
    </main>
  );
}
