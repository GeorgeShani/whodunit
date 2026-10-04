"use client";

import { motion } from "framer-motion";
import { useId, useRef, useState } from "react";
import { LeadsPanel } from "@/components/progress/LeadsPanel";
import type { PublicProgress } from "@/engine/progress";
import { useModal } from "@/components/ui/use-modal";
import type { PublicEvidence, PublicSuspect } from "@/engine/public-view";
import type { PublicTestimony } from "@/engine/testimony";
import type { Location } from "@/engine/types";
import { ClueArt } from "./ClueArt";
import { contradictionLines, whereFound, type ContradictionNotes, type NotebookItem } from "./notebook-model";

/**
 * The detective's notebook (Phase 5): evidence cards (image, name, description,
 * where found) and testimony cards, each with the engine's contradiction notes.
 *
 * - From an interrogation: every card has "Present to <name>".
 * - From the suspect screen: every card has "Present to" buttons per suspect,
 *   which open that suspect's interrogation and hold the item up.
 */
export function Notebook({
  evidence,
  testimonies,
  locations,
  notes,
  suspects,
  presentTo,
  disabled = false,
  hint = null,
  hintBusy = false,
  onHint,
  onPresent,
  onClose,
  leads = [],
  newLeadIds = [],
}: {
  evidence: PublicEvidence[];
  testimonies: PublicTestimony[];
  locations: Pick<Location, "id" | "name">[];
  notes: ContradictionNotes;
  /** Everyone you could present to (suspect-screen mode). */
  suspects: PublicSuspect[];
  /** The suspect being questioned (interrogation mode). */
  presentTo?: PublicSuspect;
  disabled?: boolean;
  /** Phase 12 contradiction assistance: last answer from the engine, and the ask button. */
  hint?: { line: string; found: boolean } | null;
  hintBusy?: boolean;
  onHint?: () => void;
  onPresent: (item: NotebookItem, suspectId: string) => void;
  onClose: () => void;
  /** Progression leads (engine/progress.ts). The Leads tab only exists when the case has any. */
  leads?: PublicProgress["leads"];
  newLeadIds?: string[];
}) {
  const [tab, setTab] = useState<"evidence" | "leads">("evidence");
  const showLeads = leads.length > 0 && tab === "leads";
  const openLeads = leads.filter((l) => l.state === "open").length;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus trap, Escape, and focus back to the opener (#25).
  useModal(dialogRef, { onClose, initialFocus: () => closeRef.current });

  const targets = (ownerId?: string) => {
    const list = presentTo ? [presentTo] : suspects;
    return list.filter((s) => s.id !== ownerId);
  };

  const presentButtons = (item: NotebookItem, label: string, ownerId?: string) => {
    const list = targets(ownerId);
    if (list.length === 0) return null;
    return (
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        {!presentTo && <span className="text-sm font-black uppercase text-neutral-600">Present to</span>}
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onPresent(item, s.id)}
            aria-label={`Present ${label} to ${s.name}`}
            {...(item.kind === "evidence" ? { "data-evidence-id": item.id } : { "data-testimony-id": item.id })}
            className="cursor-pointer rounded-lg border-[3px] border-black bg-red-500 min-h-11 px-3 py-1.5 text-base font-bold text-white shadow-[2px_2px_0_#000] hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {presentTo ? `Present to ${s.name.split(" ")[0]}` : s.name.split(" ")[0]}
          </button>
        ))}
      </div>
    );
  };

  const notesFor = (item: NotebookItem) => {
    const lines = contradictionLines(notes, item);
    return lines.length ? (
      <ul className="mt-1 flex flex-col gap-1">
        {lines.map((l) => (
          <li key={l} className="w-fit rounded-md border-2 border-black bg-red-200 px-2 py-1 text-sm font-black uppercase text-red-800" data-contradiction>
            ⚡ {l}
          </li>
        ))}
      </ul>
    ) : null;
  };

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-notebook
      className="absolute inset-0 z-40 flex items-stretch justify-center bg-black/70 p-3 short:p-2 sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl border-4 border-black bg-[#fff8e7] text-black shadow-[8px_8px_0_#000]">
        <header className="flex items-center justify-between gap-2 border-b-4 border-black bg-amber-200 px-4 py-2 pe-16 sm:pe-4">
          <h2 id={titleId} className="font-display text-3xl tracking-wider">
            📓 Notebook{presentTo ? `: present to ${presentTo.name.split(" ")[0]}` : ""}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="cursor-pointer min-h-11 rounded-xl border-[3px] border-black bg-white px-4 py-1.5 font-bold shadow-[3px_3px_0_#000]"
          >
            ✕ Close
          </button>
        </header>
        {leads.length > 0 && (
          <div role="tablist" aria-label="Notebook sections" className="flex gap-2 border-b-4 border-black bg-amber-100 px-4 py-2">
            {(["evidence", "leads"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`${titleId}-tab-${t}`}
                aria-selected={tab === t}
                data-notebook-tab={t}
                onClick={() => setTab(t)}
                className={`min-h-11 flex-1 cursor-pointer rounded-xl border-[3px] border-black px-3 py-1.5 text-base font-black shadow-[2px_2px_0_#000] sm:flex-none ${tab === t ? "bg-yellow-300" : "bg-white"}`}
              >
                {t === "evidence" ? "🔎 Evidence" : "🧭 Leads"}
                {t === "leads" && openLeads > 0 && (
                  <span className="ms-2 rounded-full border-2 border-black bg-red-500 px-2 py-0.5 text-sm text-white" aria-label={`${openLeads} open`}>
                    {openLeads}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {showLeads && (
          <div className="scroll-area flex-1 p-4" role="tabpanel" aria-labelledby={`${titleId}-tab-leads`}>
            <LeadsPanel leads={leads} newLeadIds={newLeadIds} />
          </div>
        )}
        <div className={`scroll-area flex-1 space-y-4 p-4 ${showLeads ? "hidden" : ""}`}>
          {onHint && (
            <section aria-label="Contradiction check" className="flex flex-wrap items-center gap-2 rounded-2xl border-[3px] border-black bg-white p-2 shadow-[3px_3px_0_#000]">
              <button
                type="button"
                data-hint-ask
                disabled={hintBusy}
                onClick={onHint}
                className="min-h-11 shrink-0 cursor-pointer rounded-lg border-[3px] border-black bg-yellow-300 px-3 py-1.5 text-base font-black shadow-[2px_2px_0_#000] hover:bg-yellow-200 disabled:cursor-wait disabled:opacity-60"
              >
                {hintBusy ? "Checking…" : "⚠ Check for contradictions"}
              </button>
              <p role="status" aria-live="polite" data-hint-line className={`min-w-[12rem] flex-1 text-base font-bold ${hint?.found ? "text-red-700" : "text-neutral-700"}`}>
                {hint ? hint.line : "Stuck? Ask whether anything you hold clashes with what you've been told."}
              </p>
            </section>
          )}
          <section aria-label="Clues">
            <h3 className="mb-2 text-sm font-black uppercase tracking-wide text-neutral-700">Clues ({evidence.length})</h3>
            {evidence.length === 0 ? (
              <p className="font-semibold italic text-neutral-600">No clues yet. Go and 🔍 Investigate the house!</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {evidence.map((e) => {
                  const item: NotebookItem = { kind: "evidence", id: e.id };
                  return (
                    <li key={e.id} className="flex flex-col rounded-2xl border-[3px] border-black bg-white p-3 shadow-[4px_4px_0_#000]" data-card-evidence={e.id}>
                      <div className="flex gap-3">
                        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-[3px] border-black bg-amber-200 text-3xl">
                          <ClueArt evidence={e} fill />
                        </div>
                        <div className="min-w-0">
                          <p className="font-display text-xl tracking-wide">{e.name}</p>
                          <p className="text-sm font-bold uppercase text-neutral-600">{whereFound(e, locations)}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-base">{e.description}</p>
                      {notesFor(item)}
                      {presentButtons(item, e.name)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section aria-label="Testimony">
            <h3 className="mb-2 text-sm font-black uppercase tracking-wide text-neutral-700">Testimony ({testimonies.length})</h3>
            {testimonies.length === 0 ? (
              <p className="font-semibold italic text-neutral-600">Nobody has admitted anything yet. Keep asking, and show them what you find.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {testimonies.map((t) => {
                  const item: NotebookItem = { kind: "testimony", id: t.id };
                  return (
                    <li key={t.id} className="flex flex-col rounded-2xl border-[3px] border-black bg-sky-100 p-3 shadow-[4px_4px_0_#000]" data-card-testimony={t.id}>
                      <p className="font-display text-xl tracking-wide">🗣️ {t.characterName}</p>
                      <p className="text-base font-semibold">&ldquo;{t.summary}&rdquo;</p>
                      {notesFor(item)}
                      {presentButtons(item, `${t.characterName}'s testimony`, t.characterId)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </motion.div>
  );
}
