"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

export interface DialogueMessage {
  id: string;
  speaker: "player" | "character" | "narrator";
  text: string;
  /** Cartoon stage direction, shown in italics. */
  action?: string;
}

export function DialogueLog({
  messages,
  characterName,
  footer,
}: {
  messages: DialogueMessage[];
  characterName: string;
  footer?: React.ReactNode;
}) {
  const end = useRef<HTMLDivElement>(null);
  const hasFooter = Boolean(footer);
  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scrollIntoView, which must not become the effect cleanup.
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, hasFooter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl border-4 border-black bg-[#fff8e7]/95 p-4 shadow-[6px_6px_0_#000]">
      {messages.length === 0 && (
        <p className="m-auto max-w-xs text-center font-semibold italic text-neutral-600">
          {characterName} eyes you warily. Ask a question, detective.
        </p>
      )}
      {messages.map((m) =>
        m.speaker === "narrator" ? (
          <motion.p
            key={m.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="self-center rounded-xl border-[3px] border-dashed border-black bg-yellow-100 px-4 py-2 text-center text-sm font-bold italic text-black"
          >
            {m.text}
          </motion.p>
        ) : (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className={`max-w-[85%] rounded-2xl border-[3px] border-black px-4 py-2 text-black shadow-[3px_3px_0_#000] ${
            m.speaker === "player" ? "self-end bg-sky-200" : "self-start bg-white"
          }`}
        >
          <p className="text-xs font-black uppercase tracking-wide text-neutral-600">
            {m.speaker === "player" ? "You" : characterName}
          </p>
          {m.action && <p className="text-sm italic text-neutral-600">*{m.action}*</p>}
          <p className="font-medium">{m.text}</p>
        </motion.div>
        ),
      )}
      {footer}
      <div ref={end} />
    </div>
  );
}
