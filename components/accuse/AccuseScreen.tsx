"use client";

import { SCREEN_HEADER, SCREEN_HEADER_SPACER, SCREEN_TITLE } from "@/components/game/screen-header";
import { weaponChoices } from "./weapon-choices";
import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState } from "react";
import { Portrait } from "@/components/characters/Portrait";
import { getAudio } from "@/components/effects/audio";
import { ClueArt } from "@/components/evidence/ClueArt";
import { CartoonButton } from "@/components/game/CartoonButton";
import { useModal } from "@/components/ui/use-modal";
import { MAX_ACCUSE_EVIDENCE, MAX_ACCUSE_TESTIMONY, validateAccusationDraft, type AccusationDraft } from "@/engine/accuse-schema";
import type { MotiveOption } from "@/engine/case-schema";
import type { PublicEvidence, PublicSuspect } from "@/engine/public-view";
import type { PublicTestimony } from "@/engine/testimony";
import type { Accusation } from "@/engine/types";
import { GRADING_HREF } from "@/lib/how-to-play";
import { CTA_BAR } from "@/components/game/cta-bar";

const pick = (on: boolean) =>
  `cursor-pointer rounded-2xl border-[3px] border-black text-left text-ink shadow-[4px_4px_0_#000] disabled:cursor-not-allowed disabled:opacity-50 ${
    on ? "bg-accent ring-4 ring-red-500" : "bg-paper hover:bg-yellow-50"
  }`;

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="w-full max-w-5xl rounded-3xl border-4 border-black bg-violet-950/80 p-4 shadow-[6px_6px_0_#000] short:p-3" aria-labelledby={`accuse-${n}`}>
      <h2 id={`accuse-${n}`} className="font-display text-3xl tracking-wide text-accent [-webkit-text-stroke:1px_#000]">
        {n}. {title}
      </h2>
      {hint && <p className="mb-2 text-base font-semibold text-yellow-100">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * The accusation form (Phase 8): murderer (suspect cards), weapon (a discovered
 * clue), motive (the case's public options) and 1-5 clues as proof. Validated
 * here and again on the server; submitting asks "Are you sure? This ends the case."
 *
 * Phase 5 (case-two plan 3.2, D3): a case with `accuse.askHelper` gets role wording, "Who struck the fatal blow?",
 * then "Did anyone help?" with an explicit "No one helped". Nothing is preselected, Submit stays disabled until it is
 * answered, and the confirm dialog says the roles in words. The flag is public case data, the same in every game, so
 * it says nothing about the answer. Without it the form is the single-culprit one, unchanged.
 */
export function AccuseScreen({
  suspects,
  evidence,
  motives,
  busy,
  error,
  testimonies = [],
  citeTestimony = false,
  weaponsMarked = false,
  citeCap,
  askHelper = false,
  onSubmit,
  onBack,
  onHowGraded,
}: {
  suspects: PublicSuspect[];
  evidence: PublicEvidence[];
  motives: MotiveOption[];
  busy: boolean;
  /** In-character rejection line from the server, if any. */
  error?: string | null;
  /** Confessions in the notebook; the picker shows only when the case asks for one (citeTestimony). */
  testimonies?: PublicTestimony[];
  citeTestimony?: boolean;
  /** E3: the case marks weapon candidates; the weapon picker lists only those (see weaponChoices). */
  weaponsMarked?: boolean;
  /** E2: "Cite up to N" clues / confessions (progress.accuse.citeCap); absent = the absolute maxima. */
  citeCap?: { evidence: number; testimony: number };
  /** Phase 5: ask "Did anyone help?" (public case flag, view.askHelper). */
  askHelper?: boolean;
  onSubmit: (a: Accusation) => void;
  onBack: () => void;
  /** Opens How to Play at "How accusations are graded" (absent: no link). */
  onHowGraded?: () => void;
}) {
  const [draft, setDraft] = useState<AccusationDraft>({ keyEvidenceIds: [] });
  const maxProof = Math.min(MAX_ACCUSE_EVIDENCE, citeCap?.evidence ?? MAX_ACCUSE_EVIDENCE);
  const maxTestimony = Math.min(MAX_ACCUSE_TESTIMONY, citeCap?.testimony ?? MAX_ACCUSE_TESTIMONY);
  const weapons = weaponChoices(evidence, weaponsMarked);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  /** Sections after the helper question shift down by one when it is shown. */
  const n = (k: number) => (askHelper && k >= 2 ? k + 1 : k);
  const helperMissing = askHelper && draft.accompliceId === undefined;
  const nameOf = (id: string | null | undefined) => suspects.find((s) => s.id === id)?.name ?? "";
  const set = (d: Partial<AccusationDraft>) => {
    setDraft((x) => ({ ...x, ...d }));
    setErrors([]);
  };
  const toggleProof = (id: string) =>
    set({ keyEvidenceIds: draft.keyEvidenceIds.includes(id) ? draft.keyEvidenceIds.filter((x) => x !== id) : [...draft.keyEvidenceIds, id] });
  const toggleTestimony = (id: string) => {
    const cur = draft.keyTestimonyIds ?? [];
    set({ keyTestimonyIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const check = () =>
    validateAccusationDraft(draft, {
      suspectIds: suspects.map((s) => s.id),
      evidenceIds: evidence.map((e) => e.id),
      motiveIds: motives.map((m) => m.id),
      testimonyIds: testimonies.map((t) => t.id),
      requireTestimony: citeTestimony,
      ...(citeCap ? { caps: citeCap } : {}),
      askHelper,
    });
  /** Picking the helper as the one who struck the blow clears the helper answer (Submit disables again). */
  const pickMurderer = (id: string) => set({ murdererId: id, ...(draft.accompliceId === id ? { accompliceId: undefined } : {}) });

  return (
    <main className="relative flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,#7f1d1d_0%,var(--backdrop)_70%)]">
      <div className="screen-scroll flex min-h-0 flex-1 flex-col items-center gap-5 px-4 pb-6 pt-3 sm:px-6 sm:pt-6">
      <div className={`${SCREEN_HEADER} max-w-5xl`}>
        <CartoonButton tone="white" onClick={onBack} aria-label="Back to suspects" className="order-1 min-h-12 shrink-0" disabled={busy}>
          ← <span className="max-sm:hidden">Back to suspects</span>
          <span className="sm:hidden">Back</span>
        </CartoonButton>
        <h1 data-autofocus tabIndex={-1} className={`${SCREEN_TITLE} font-display text-5xl leading-none tracking-wider text-red-500 [-webkit-text-stroke:2px_#000] drop-shadow-[4px_4px_0_#000] sm:text-6xl`}>
          ACCUSE!
        </h1>
        <span className={SCREEN_HEADER_SPACER} />
      </div>
      {onHowGraded && (
        <p className="-mt-2 text-center">
          {/* A real link (works without JS and in a new tab); a plain click opens the manual over the form instead. */}
          <a
            href={GRADING_HREF}
            data-how-graded
            aria-haspopup="dialog"
            onClick={(e) => {
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              getAudio().play("ui_paper");
              onHowGraded();
            }}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border-[3px] border-black bg-white px-4 py-1 font-bold text-ink underline decoration-2 underline-offset-2 shadow-[3px_3px_0_#000] hover:bg-yellow-100"
          >
            <span aria-hidden>❓</span> How am I graded?
          </a>
        </p>
      )}

      <Section n={1} title={askHelper ? "Who struck the fatal blow?" : "Who did it?"}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-labelledby="accuse-1">
          {suspects.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={draft.murdererId === s.id}
              data-accuse-suspect={s.id}
              disabled={busy}
              onClick={() => pickMurderer(s.id)}
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

      {askHelper && (
        <Section n={2} title="Did anyone help?" hint="Name one helper, or tell us no one did.">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="accuse-2" data-accuse-helpers>
            <button
              type="button"
              role="radio"
              aria-checked={draft.accompliceId === null}
              data-accuse-helper="none"
              disabled={busy}
              onClick={() => set({ accompliceId: null })}
              className={`${pick(draft.accompliceId === null)} min-h-12 px-4 py-2 font-display text-xl tracking-wide`}
            >
              No one helped
            </button>
            {suspects.map((s) => {
              const struck = draft.murdererId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.accompliceId === s.id}
                  data-accuse-helper={s.id}
                  disabled={busy || struck}
                  onClick={() => set({ accompliceId: s.id })}
                  className={`${pick(draft.accompliceId === s.id)} min-h-12 px-4 py-2 font-display text-xl tracking-wide`}
                >
                  {s.name}
                  {struck && <span className="block font-sans text-sm font-bold">struck the blow</span>}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <Section n={n(2)} title="With what?" hint={weaponsMarked ? "The murder weapon, from the possible weapons you have found." : "The murder weapon, from the clues in your notebook."}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`accuse-${n(2)}`}>
          {weapons.length === 0 && <p className="text-base font-semibold text-yellow-100">No possible weapon in your notebook yet. Keep searching.</p>}
          {weapons.map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={draft.weaponId === e.id}
              data-accuse-weapon={e.id}
              disabled={busy}
              onClick={() => set({ weaponId: e.id })}
              className={`${pick(draft.weaponId === e.id)} min-h-12 px-4 py-2 text-base font-bold`}
            >
              <ClueArt evidence={e} className="inline-block size-6 align-middle leading-6" /> {e.name}
            </button>
          ))}
        </div>
      </Section>

      <Section n={n(3)} title="Why?">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby={`accuse-${n(3)}`}>
          {motives.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={draft.motiveId === m.id}
              data-accuse-motive={m.id}
              disabled={busy}
              onClick={() => set({ motiveId: m.id })}
              className={`${pick(draft.motiveId === m.id)} min-h-12 px-4 py-2.5`}
            >
              <span className="block font-display text-xl tracking-wide">{m.label}</span>
              {m.description && <span className="block text-base">{m.description}</span>}
            </button>
          ))}
        </div>
      </Section>

      <Section n={n(4)} title="Your proof" hint={`Cite up to ${maxProof} clues that prove it (${draft.keyEvidenceIds.length} chosen). Only cite what supports your case.`}>
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
                disabled={busy || (!on && draft.keyEvidenceIds.length >= maxProof)}
                onClick={() => toggleProof(e.id)}
                className={`${pick(on)} min-h-12 px-4 py-2 text-base font-bold`}
              >
                {on ? "☑" : "☐"} <ClueArt evidence={e} className="inline-block size-6 align-middle leading-6" /> {e.name}
              </button>
            );
          })}
        </div>
      </Section>

      {citeTestimony && (
        <Section
          n={n(5)}
          title="A confession"
          hint={`Clues alone won't do. Cite up to ${maxTestimony} confessions someone gave you (${(draft.keyTestimonyIds ?? []).length} chosen).`}
        >
          {testimonies.length === 0 ? (
            <p
              data-accuse-no-testimony
              className="text-base font-semibold italic text-yellow-100"
            >
              Nobody has admitted anything yet. Press the suspects, show them
              what you found, then come back.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {testimonies.map((t) => {
                const on = (draft.keyTestimonyIds ?? []).includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    data-accuse-testimony={t.id}
                    disabled={
                      busy ||
                      (!on &&
                        (draft.keyTestimonyIds ?? []).length >= maxTestimony)
                    }
                    onClick={() => toggleTestimony(t.id)}
                    className={`${pick(on)} min-h-12 px-4 py-2 text-base`}
                  >
                    <span className="block font-display text-xl tracking-wide">
                      {on ? "☑" : "☐"} 🗣️ {t.characterName}
                    </span>
                    <span className="block font-semibold">
                      &ldquo;{t.summary}&rdquo;
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {(errors.length > 0 || error) && (
        <div role="alert" data-accuse-errors className="w-full max-w-5xl rounded-2xl border-4 border-black bg-red-100 p-3 text-base font-bold text-red-800">
          {error && <p>{error}</p>}
          {errors.map((e) => (
            <p key={e}>• {e}</p>
          ))}
        </div>
      )}

      </div>

      {/* The submit button stays in reach however far the form is scrolled, in a bar BELOW the scroll area (CTA_BAR):
          nothing scrolls under it, so it never covers the form. */}
      <div data-cta-bar className={CTA_BAR}>
        {helperMissing && (
          <p id="accuse-helper-needed" data-accuse-helper-needed className="w-full text-center text-base font-bold text-yellow-100 sm:w-auto">
            Say whether anyone helped
          </p>
        )}
        <CartoonButton
          tone="red"
          className="min-h-14 w-full max-w-md font-display text-3xl tracking-widest short:min-h-12 short:text-2xl sm:w-auto"
          disabled={busy || helperMissing}
          {...(helperMissing ? { "aria-describedby": "accuse-helper-needed" } : {})}
          onClick={() => {
            const r = check();
            if (!r.ok) {
              setErrors(r.errors);
              // Bring the list of problems into view.
              requestAnimationFrame(() => document.querySelector("[data-accuse-errors]")?.scrollIntoView({ block: "center", behavior: "smooth" }));
            } else setConfirming(true);
          }}
        >
          {busy ? "THE DETECTIVE CLEARS THEIR THROAT…" : "SUBMIT ACCUSATION"}
        </CartoonButton>
      </div>

      <AnimatePresence>
        {confirming && (
          <ConfirmDialog
            {...(askHelper && draft.murdererId ? { roles: rolesLine(nameOf(draft.murdererId), draft.accompliceId ? nameOf(draft.accompliceId) : null) } : {})}
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
/** Phase 5: the roles in words for the confirm dialog ("Amadeo struck the blow. Horatio helped."). */
export function rolesLine(murderer: string, helper: string | null): string {
  return `${murderer} struck the blow. ${helper ? `${helper} helped.` : "No one helped."}`;
}

function ConfirmDialog({ roles, onCancel, onConfirm }: { roles?: string; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, { onClose: onCancel });
  return (
    <motion.div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-accuse"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-3xl border-4 border-black bg-paper p-6 text-center text-ink shadow-[8px_8px_0_#000]"
      >
        <p id="confirm-accuse" className="font-display text-4xl tracking-wide text-red-600">
          Are you sure?
        </p>
        {roles && (
          <p data-confirm-roles className="mt-2 font-display text-2xl tracking-wide">
            {roles}
          </p>
        )}
        <p className="mt-2 font-bold">This ends the case. There&apos;s no taking it back.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <CartoonButton tone="white" className="min-h-12 px-5 text-base" onClick={onCancel}>
            Not yet
          </CartoonButton>
          <CartoonButton tone="red" className="min-h-12 px-5 text-base" autoFocus onClick={onConfirm}>
            Yes, accuse!
          </CartoonButton>
        </div>
      </div>
    </motion.div>
  );
}
