"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { InterrogateAction } from "@/ai/interrogate-schema";
import { EmotionBadge } from "@/components/characters/EmotionBadge";
import { Portrait } from "@/components/characters/Portrait";
import { EvidencePicker } from "@/components/evidence/EvidencePicker";
import { CartoonButton } from "@/components/game/CartoonButton";
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
  speaking?: boolean;
  onAsk: (action: InterrogateAction, playerLine: string) => void;
  onBack: () => void;
}) {
  const [menu, setMenu] = useState<Menu>(null);
  const [text, setText] = useState("");
  const firstName = suspect.name.split(" ")[0];

  const ask = (action: InterrogateAction, line: string) => {
    setMenu(null);
    onAsk(action, line);
  };

  return (
    <main className="flex h-dvh flex-col bg-[linear-gradient(180deg,#3b1d6e_0%,#1b1035_60%,#120a24_100%)] p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <CartoonButton tone="white" onClick={onBack}>
          ← Back to suspects
        </CartoonButton>
        <div className="flex items-center gap-3">
          <h2 className="font-display text-3xl tracking-wide text-yellow-300 [-webkit-text-stroke:1.5px_#000] drop-shadow-[3px_3px_0_#000] sm:text-4xl">
            {suspect.name}
          </h2>
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
            <CartoonButton disabled={pending} onClick={() => ask({ type: "whereabouts" }, "Where were you when it happened?")}>
              📍 Whereabouts
            </CartoonButton>
            <CartoonButton disabled={pending} onClick={() => ask({ type: "victim" }, "Tell me about the victim.")}>
              💀 The victim
            </CartoonButton>
            <CartoonButton
              tone={menu === "suspects" ? "violet" : "yellow"}
              disabled={pending || otherSuspects.length === 0}
              onClick={() => setMenu(menu === "suspects" ? null : "suspects")}
            >
              🕵️ Ask about…
            </CartoonButton>
            <CartoonButton
              tone={menu === "evidence" ? "violet" : "yellow"}
              disabled={pending}
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
                          disabled={pending}
                          onClick={() => ask({ type: "about_suspect", suspectId: o.id }, `What can you tell me about ${o.name}?`)}
                        >
                          {o.name}
                        </CartoonButton>
                      ))}
                    </div>
                  ) : (
                    <EvidencePicker
                      evidence={evidence}
                      disabled={pending}
                      onPick={(e) => ask({ type: "present_evidence", evidenceId: e.id }, `Care to explain this? (${e.name})`)}
                    />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const q = text.trim();
              if (!q || pending) return;
              setText("");
              ask({ type: "free_text", text: q }, q);
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
            <CartoonButton type="submit" tone="red" disabled={pending || !text.trim()}>
              ASK!
            </CartoonButton>
          </form>
        </section>

        <aside className="hidden w-[min(34vw,420px)] items-end justify-center md:flex">
          <motion.div
            animate={pending ? { rotate: [0, -1, 1, 0] } : { rotate: 0 }}
            transition={pending ? { duration: 1.2, repeat: Infinity } : {}}
            style={{ originY: 1 }}
            className="h-full max-h-[80vh] w-full"
          >
            <Portrait suspect={suspect} emotion={emotion} speaking={speaking} className="mx-auto h-full" priority />
          </motion.div>
        </aside>
      </div>
    </main>
  );
}
