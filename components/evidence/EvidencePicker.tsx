"use client";

import { motion } from "framer-motion";
import type { PublicEvidence } from "@/engine/public-view";
import type { PublicTestimony } from "@/engine/testimony";

/** The detective's notebook: clues found, plus testimony cards (what other suspects have admitted). */
export function EvidencePicker({
  evidence,
  testimonies = [],
  onPick,
  onPickTestimony,
  disabled,
}: {
  evidence: PublicEvidence[];
  testimonies?: PublicTestimony[];
  onPick: (e: PublicEvidence) => void;
  onPickTestimony?: (t: PublicTestimony) => void;
  disabled?: boolean;
}) {
  if (evidence.length === 0 && testimonies.length === 0) {
    return <p className="text-sm font-semibold italic text-yellow-100">No clues in your notebook yet. Go and 🔍 Investigate the house!</p>;
  }
  return (
    <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
      {evidence.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {evidence.map((e) => (
            <motion.button
              key={e.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(e)}
              data-evidence-id={e.id}
              title={e.description}
              whileHover={{ rotate: -2, scale: 1.05 }}
              className="cursor-pointer rounded-lg border-[3px] border-black bg-amber-200 px-3 py-1 text-sm font-bold text-black shadow-[3px_3px_0_#000] disabled:cursor-not-allowed disabled:opacity-50"
            >
              🔍 {e.name}
            </motion.button>
          ))}
        </div>
      )}
      {testimonies.length > 0 && onPickTestimony && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-black uppercase tracking-wide text-yellow-200">Testimony</p>
          <div className="flex flex-wrap gap-2">
            {testimonies.map((t) => (
              <motion.button
                key={t.id}
                type="button"
                disabled={disabled}
                onClick={() => onPickTestimony(t)}
                data-testimony-id={t.id}
                title={t.summary}
                whileHover={{ rotate: 2, scale: 1.03 }}
                className="max-w-full cursor-pointer rounded-lg border-[3px] border-black bg-sky-200 px-3 py-1 text-left text-sm font-bold text-black shadow-[3px_3px_0_#000] disabled:cursor-not-allowed disabled:opacity-50"
              >
                🗣️ {t.characterName}: <span className="font-semibold">{t.summary}</span>
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
