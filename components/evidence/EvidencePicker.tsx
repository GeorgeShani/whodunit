"use client";

import { motion } from "framer-motion";
import type { PublicEvidence } from "@/engine/public-view";

export function EvidencePicker({
  evidence,
  onPick,
  disabled,
}: {
  evidence: PublicEvidence[];
  onPick: (e: PublicEvidence) => void;
  disabled?: boolean;
}) {
  if (evidence.length === 0) {
    return <p className="text-sm font-semibold italic text-yellow-100">No evidence discovered yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {evidence.map((e) => (
        <motion.button
          key={e.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(e)}
          title={e.description}
          whileHover={{ rotate: -2, scale: 1.05 }}
          className="cursor-pointer rounded-lg border-[3px] border-black bg-amber-200 px-3 py-1 text-sm font-bold text-black shadow-[3px_3px_0_#000] disabled:cursor-not-allowed disabled:opacity-50"
        >
          🔍 {e.name}
        </motion.button>
      ))}
    </div>
  );
}
