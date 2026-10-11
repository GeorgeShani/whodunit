"use client";

import { useEffect, useId, useRef, useState } from "react";
import { getAudio } from "@/components/effects/audio";
import { CartoonButton } from "@/components/game/CartoonButton";
import { useModal } from "@/components/ui/use-modal";
import type { Manual } from "@/lib/how-to-play";
import { markFirstTimePromptSeen, shouldShowFirstTimePrompt } from "@/lib/first-visit";
import { ManualContent } from "./ManualContent";

/**
 * The How to Play manual as a modal (role="dialog", aria-modal): focus trap, Esc closes, focus returns to the button
 * that opened it (useModal). It sits on top of whatever screen is open, so the game underneath keeps its state.
 */
export function HowToPlayDialog({
  manual,
  tips,
  section,
  onClose,
}: {
  manual: Manual;
  tips?: readonly string[];
  /** Deep link: open with this section expanded, scrolled to and focused (e.g. GRADING_SECTION_ID). */
  section?: string;
  onClose: () => void;
}) {
  const target = section && manual.sections.some((s) => s.id === section) ? section : undefined;
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    getAudio().play("ui_paper");
    onClose();
  };
  useModal(ref, {
    onClose: close,
    initialFocus: () => {
      const summary = target ? ref.current?.querySelector<HTMLElement>(`[data-htp-section="${target}"] > summary`) : null;
      if (summary) {
        summary.scrollIntoView?.({ block: "start" });
        return summary;
      }
      return ref.current?.querySelector<HTMLElement>("[data-htp-close]");
    },
  });
  return (
    <div
      className="absolute inset-0 z-[58] flex items-stretch justify-center bg-black/70 p-2 sm:items-center sm:p-6"
      data-how-to-play-backdrop
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-how-to-play
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl border-4 border-black bg-[#fff8e7] text-black shadow-[8px_8px_0_#000]"
      >
        <header className="flex items-center justify-between gap-2 border-b-4 border-black bg-amber-200 px-4 py-2 pe-16 sm:pe-4">
          <h2 id={titleId} className="font-display text-3xl tracking-wider -rotate-1">
            <span aria-hidden>❓</span> HOW TO PLAY
          </h2>
          <button
            type="button"
            data-htp-close
            onClick={close}
            aria-label="Close How to Play"
            className="min-h-11 min-w-11 cursor-pointer rounded-xl border-[3px] border-black bg-white px-3 py-1.5 font-bold shadow-[3px_3px_0_#000]"
          >
            <span aria-hidden>✕</span>
            <span className="max-sm:hidden"> Close</span>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
          <ManualContent manual={manual} tips={tips} level={3} collapsible openIds={target ? [target] : [manual.sections[0]!.id]} />
        </div>
        <footer className="flex justify-end border-t-4 border-black bg-amber-100 px-4 py-2">
          <CartoonButton tone="red" sound={false} onClick={close} className="min-h-12 px-6 text-lg">
            Got it!
          </CartoonButton>
        </footer>
      </div>
    </div>
  );
}

/** The "?" in the HUD, next to the mute toggle (in-case screens). */
export function HelpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label="How to Play"
      title="How to Play"
      data-help-button
      onClick={() => {
        getAudio().play("ui_paper");
        onOpen();
      }}
      className="absolute right-[calc(max(0.5rem,env(safe-area-inset-right))+3.25rem)] top-[max(0.5rem,env(safe-area-inset-top))] z-[57] flex size-11 cursor-pointer items-center justify-center rounded-full border-[3px] border-black bg-yellow-300 font-display text-2xl text-black shadow-[3px_3px_0_#000] hover:bg-yellow-200"
    >
      <span aria-hidden>?</span>
    </button>
  );
}

/**
 * Light first-visit nudge under the title screen's HOW TO PLAY button: a small inline speech bubble pointing at it.
 * Not modal, never takes focus, never covers START or the button (it sits in the normal flow). Shown once (the flag is
 * set the moment it appears), dismissible, and not at all when storage is unavailable.
 */
export function FirstTimePrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!shouldShowFirstTimePrompt()) return;
    markFirstTimePromptSeen();
    // Shown after hydration only (localStorage is client-side); the server markup never has it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(true);
  }, []);
  if (!show) return null;
  return (
    <aside
      aria-label="New here?"
      data-first-time-prompt
      className="relative mt-3 flex items-center gap-2 rounded-full border-[3px] border-black bg-[#fff8e7] py-0.5 pe-0.5 ps-4 text-left text-sm font-bold text-black shadow-[3px_3px_0_#000] max-sm:mt-2 short:mt-2"
    >
      <span aria-hidden className="absolute -top-[9px] left-1/2 size-3.5 short:hidden -translate-x-1/2 rotate-45 border-l-[3px] border-t-[3px] border-black bg-[#fff8e7]" />
      <p className="relative">New here? Start with How to Play!</p>
      <button
        type="button"
        aria-label="Dismiss"
        data-first-time-dismiss
        onClick={() => {
          getAudio().play("ui_tap");
          setShow(false);
        }}
        className="relative min-h-11 min-w-11 shrink-0 cursor-pointer rounded-full font-black hover:bg-yellow-100"
      >
        <span aria-hidden>✕</span>
      </button>
    </aside>
  );
}
