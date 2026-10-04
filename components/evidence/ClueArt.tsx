"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { clueIcon, resolveClueArt, type ClueArtEvidence } from "@/lib/clue-art";

const CaseContext = createContext("");

/** Tells every <ClueArt> below which case's art folder to look in. */
export function ClueArtProvider({ caseId, children }: { caseId: string; children: ReactNode }) {
  return <CaseContext.Provider value={caseId}>{children}</CaseContext.Provider>;
}

/**
 * A clue's picture: its illustration when one exists (assets/evidence/<id>.webp), else its emoji icon, else a neutral
 * magnifying glass. Decorative (aria-hidden); the clue's name is always shown next to it. `fill` makes an illustration
 * cover its box (cards); otherwise it is scaled to fit.
 */
export function ClueArt({ evidence, className = "", fill = false }: { evidence: ClueArtEvidence; className?: string; fill?: boolean }) {
  const caseId = useContext(CaseContext);
  const art = resolveClueArt(caseId, evidence);
  const [failed, setFailed] = useState<string | null>(null);
  if (art.kind === "image" && failed !== art.src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small authored card art, already sized
      <img src={art.src} alt="" aria-hidden data-clue-art="image" onError={() => setFailed(art.src)} className={`${fill ? "h-full w-full object-cover" : "max-h-full max-w-full object-contain"} ${className}`} />
    );
  }
  return (
    <span aria-hidden data-clue-art="icon" className={className}>
      {art.kind === "icon" ? art.icon : clueIcon(evidence)}
    </span>
  );
}
