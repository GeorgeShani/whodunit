"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState } from "react";
import { Portrait } from "@/components/characters/Portrait";
import { KIND_ICON } from "@/components/evidence/notebook-model";
import { CartoonButton } from "@/components/game/CartoonButton";
import { useModal } from "@/components/ui/use-modal";
import { MAX_ACCUSE_EVIDENCE, validateAccusationDraft, type AccusationDraft } from "@/engine/accuse-schema";
import type { MotiveOption } from "@/engine/case-schema";
import type { PublicEvidence, PublicSuspect } from "@/engine/public-view";
import type { Accusation } from "@/engine/types";

const pick = (on: boolean) =>
  `cursor-pointer rounded-2xl border-[3px] border-black text-left text-black shadow-[4px_4px_0_#000] disabled:cursor-not-allowed disabled:opacity-50 ${
    on ? "bg-yellow-300 ring-4 ring-red-500" : "bg-[#fff8e7] hover:bg-yellow-50"
  }`;

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="w-full max-w-5xl rounded-3xl border-4 border-black bg-violet-950/80 p-4 shadow-[6px_6px_0_#000]" aria-labelledby={`accuse-${n}`}>
      <h2 id={`accuse-${n}`} className="font-display text-3xl tracking-wide text-yellow-300 [-webkit-text-stroke:1px_#000]">
        {n}. {title}
      </h2>
      {hint && <p className="mb-2 text-sm font-semibold text-yellow-100">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * The accusation form (Phase 8): murderer (suspect cards), weapon (a discovered
 * clue), motive (the case's public options) and 1-5 clues as proof. Validated
 * here and again on the server; submitting asks "Are you sure? This ends the case."
 */
export function AccuseScreen({
  suspects,
  evidence,
  motives,
  busy,
  error,
  onSubmit,
  onBack,
}: {
  suspects: PublicSuspect[];
  evidence: PublicEvidence[];
  motives: MotiveOption[];
  busy: boolean;
  /** In-character rejection line from the server, if any. */
  error?: string | null;
  onSubmit: (a: Accusation) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<AccusationDraft>({ keyEvidenceIds: [] });
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const set = (d: Partial<AccusationDraft>) => {
    setDraft((x) => ({ ...x, ...d }));
    setErrors([]);
  };
  const toggleProof = (id: string) =>
    set({ keyEvidenceIds: draft.keyEvidenceIds.includes(id) ? draft.keyEvidenceIds.filter((x) => x !== id) : [...draft.keyEvidenceIds, id] });
  const check = () =>
    validateAccusationDraft(draft, { suspectIds: suspects.map((s) => s.id), evidenceIds: evidence.map((e) => e.id), motiveIds: motives.map((m) => m.id) });

  return (
    <main className="screen-scroll relative flex min-h-0 flex-1 flex-col items-center gap-5 bg-[radial-gradient(circle_at_top,#7f1d1d_0%,#1b1035_70%)] px-4 py-6">
      <div className="flex w-full max-w-5xl items-center justify-between gap-2 max-xl:pe-12">
        <CartoonButton tone="white" onClick={onBack} aria-label="Back to suspects" className="shrink-0" disabled={busy}>
          ← <span className="max-sm:hidden">Back to suspects</span>
          <span className="sm:hidden">Back</span>
        </CartoonButton>
        <h1 data-autofocus tabIndex={-1} className="font-display text-5xl tracking-wider text-red-500 [-webkit-text-stroke:2px_#000] drop-shadow-[4px_4px_0_#000] sm:text-6xl">
          ACCUSE!
        </h1>
        <span className="hidden w-40 sm:block" />
      </div>

      <Section n={1} title="Who did it?">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-labelledby="accuse-1">
          {suspects.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={draft.murdererId === s.id}
              data-accuse-suspect={s.id}
              disabled={busy}
              onClick={() => set({ murdererId: s.id })}
              className={`${pick(draft.murdererId === s.id)} flex flex-col items-center p-2`}
            >
              <span className="flex h-36 w-full items-end justify-center overflow-hidden rounded-xl border-2 border-black bg-gradient-to-b from-sky-200 to-yellow-100">
                <Portrait suspect={s} emotion={s.emotion.emotion} className="h-32" effects={false} decorative />
              </span>
              <span className="mt-1 text-center font-display text-xl leading-tight tracking-wide">{s.name}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section n={2} title="With what?" hint="The murder weapon, from the clues in your notebook.">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="accuse-2">
          {evidence.map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={draft.weaponId === e.id}
              data-accuse-weapon={e.id}
              disabled={busy}
              onClick={() => set({ weaponId: e.id })}
              className={`${pick(draft.weaponId === e.id)} px-3 py-2 font-bold`}
            >
              <span aria-hidden>{KIND_ICON[e.kind] ?? "🔍"}</span> {e.name}
            </button>
          ))}
        </div>
      </Section>

      <Section n={3} title="Why?">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="accuse-3">
          {motives.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={draft.motiveId === m.id}
              data-accuse-motive={m.id}
              disabled={busy}
              onClick={() => set({ motiveId: m.id })}
              className={`${pick(draft.motiveId === m.id)} px-3 py-2`}
            >
              <span className="block font-display text-xl tracking-wide">{m.label}</span>
              {m.description && <span className="block text-sm">{m.description}</span>}
            </button>
          ))}
        </div>
      </Section>

      <Section n={4} title="Your proof" hint={`Cite 1 to ${MAX_ACCUSE_EVIDENCE} clues that prove it (${draft.keyEvidenceIds.length} chosen).`}>
        <div className="flex flex-wrap gap-2">
          {evidence.map((e) => {
            const on = draft.keyEvidenceIds.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                data-accuse-proof={e.id}
                disabled={busy || (!on && draft.keyEvidenceIds.length >= MAX_ACCUSE_EVIDENCE)}
                onClick={() => toggleProof(e.id)}
                className={`${pick(on)} px-3 py-2 font-bold`}
              >
                {on ? "☑" : "☐"} {e.name}
              </button>
            );
          })}
        </div>
      </Section>

      {(errors.length > 0 || error) && (
        <div role="alert" className="w-full max-w-5xl rounded-2xl border-4 border-black bg-red-100 p-3 font-bold text-red-800">
          {error && <p>{error}</p>}
          {errors.map((e) => (
            <p key={e}>• {e}</p>
          ))}
        </div>
      )}

      <CartoonButton
        tone="red"
        className="font-display text-3xl tracking-widest"
        disabled={busy}
        onClick={() => {
          const r = check();
          if (!r.ok) setErrors(r.errors);
          else setConfirming(true);
        }}
      >
        {busy ? "THE DETECTIVE CLEARS THEIR THROAT…" : "SUBMIT ACCUSATION"}
      </CartoonButton>

      <AnimatePresence>
        {confirming && (
          <ConfirmDialog
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              const r = check();
              setConfirming(false);
              if (r.ok) onSubmit(r.accusation);
            }}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

/** "Are you sure?" — a real modal (#25): focus trapped, Escape = "Not yet", focus returns to the button that opened it. */
function ConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, { onClose: onCancel });
  return (
    <motion.div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-accuse"
        className="w-full max-w-md rounded-3xl border-4 border-black bg-[#fff8e7] p-6 text-center text-black shadow-[8px_8px_0_#000]"
      >
        <p id="confirm-accuse" className="font-display text-4xl tracking-wide text-red-600">
          Are you sure?
        </p>
        <p className="mt-2 font-bold">This ends the case. There&apos;s no taking it back.</p>
        <div className="mt-4 flex justify-center gap-3">
          <CartoonButton tone="white" onClick={onCancel}>
            Not yet
          </CartoonButton>
          <CartoonButton tone="red" autoFocus onClick={onConfirm}>
            Yes, accuse!
          </CartoonButton>
        </div>
      </div>
    </motion.div>
  );
}
