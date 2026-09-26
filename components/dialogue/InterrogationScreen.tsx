"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { EmotionBadge } from "@/components/characters/EmotionBadge";
import { Portrait } from "@/components/characters/Portrait";
import { EvidencePicker } from "@/components/evidence/EvidencePicker";
import { CartoonButton } from "@/components/game/CartoonButton";
import { backdropStyle } from "@/components/game/backdrop";
import type { AskInput } from "@/components/game/Game";
import type { PublicEvidence, PublicSuspect } from "@/engine/public-view";
import type { Emotion } from "@/engine/types";
import { DialogueLog, type DialogueMessage } from "./DialogueLog";
import { ThinkingIndicator } from "./ThinkingIndicator";

type Menu = null | "suspects" | "evidence";

export function InterrogationScreen({
  suspect,
  emotion,
  otherSuspects,
  evidence,
  messages,
  pending,
  backdrop,
  busyWith = null,
  speaking = false,
  onAsk,
  onBack,
}: {
  suspect: PublicSuspect;
  emotion: Emotion;
  otherSuspects: PublicSuspect[];
  evidence: PublicEvidence[];
  messages: DialogueMessage[];
  pending: boolean;
  /** Case interrogation backdrop; falls back to the night gradient. */
  backdrop?: string;
  /** Someone else is mid-reply (or a search is running): controls lock, typed text is kept (#8). */
  busyWith?: string | null;
  speaking?: boolean;
  /** Returns false if the question was not accepted (e.g. another reply is pending). */
  onAsk: (input: AskInput) => boolean;
  onBack: () => void;
}) {
  const [menu, setMenu] = useState<Menu>(null);
  const [text, setText] = useState("");
  const firstName = suspect.name.split(" ")[0];
  const locked = pending || Boolean(busyWith);

  const ask = (question: string, presentedEvidenceId?: string): boolean => {
    if (locked) return false;
    const accepted = onAsk({ question, ...(presentedEvidenceId ? { presentedEvidenceId } : {}) });
    if (accepted) setMenu(null);
    return accepted;
  };

  return (
    <main
      className={`flex min-h-0 flex-1 flex-col overflow-hidden p-4 ${
        backdrop ? "bg-[#1b1035] bg-cover bg-center" : "bg-[linear-gradient(180deg,#3b1d6e_0%,#1b1035_60%,#120a24_100%)]"
      }`}
      style={backdropStyle(backdrop)}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <CartoonButton tone="white" onClick={onBack}>
          ← Back to suspects
        </CartoonButton>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl tracking-wide text-yellow-300 [-webkit-text-stroke:1.5px_#000] drop-shadow-[3px_3px_0_#000] sm:text-4xl">
            {suspect.name}
          </h1>
          <EmotionBadge emotion={emotion} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Dialogue + controls on the left; the portrait faces left, toward it. */}
        <section className="flex min-h-0 flex-1 flex-col gap-3">
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
            <CartoonButton
              tone={menu === "evidence" ? "violet" : "yellow"}
              disabled={locked}
              onClick={() => setMenu(menu === "evidence" ? null : "evidence")}
            >
              🔍 Present evidence
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
                  {menu === "suspects" ? (
                    <div className="flex flex-wrap gap-2">
                      {otherSuspects.map((o) => (
                        <CartoonButton
                          key={o.id}
                          tone="white"
                          disabled={locked}
                          onClick={() => ask(`What can you tell me about ${o.name}?`)}
                        >
                          {o.name}
                        </CartoonButton>
                      ))}
                    </div>
                  ) : (
                    <EvidencePicker
                      evidence={evidence}
                      disabled={locked}
                      onPick={(e) => ask(`Care to explain this? (${e.name})`, e.id)}
                    />
                  )}
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
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const q = text.trim();
              if (!q || locked) return;
              // Only clear the box once the question has actually been accepted (#8).
              if (ask(q)) setText("");
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              placeholder={`Ask ${firstName} anything…`}
              aria-label={`Ask ${suspect.name} a question`}
              className="min-w-0 flex-1 rounded-xl border-[3px] border-black bg-white px-4 py-2 font-medium text-black shadow-[4px_4px_0_#000] outline-none focus:bg-yellow-50"
            />
            <CartoonButton type="submit" tone="red" disabled={locked || !text.trim()}>
              ASK!
            </CartoonButton>
          </form>
        </section>

        <aside className="hidden w-[min(34vw,420px)] items-end justify-center md:flex">
          <motion.div
            animate={pending ? { rotate: [0, -1, 1, 0] } : { rotate: 0 }}
            transition={pending ? { duration: 1.2, repeat: Infinity } : {}}
            style={{ originY: 1 }}
            className="h-full max-h-full w-full"
          >
            <Portrait suspect={suspect} emotion={emotion} speaking={speaking} className="mx-auto h-full" priority />
          </motion.div>
        </aside>
      </div>
    </main>
  );
}
