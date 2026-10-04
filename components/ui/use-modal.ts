"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modals currently open, innermost last: only the top one handles Escape and Tab. */
const stack: symbol[] = [];

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
}

/**
 * Modal behaviour for a role="dialog" aria-modal="true" element (#25):
 * - focus moves inside on open (`initialFocus` or the first control);
 * - Tab / Shift+Tab wrap inside it, so focus never reaches the page behind;
 * - Escape calls `onClose` (only the topmost open modal reacts);
 * - on close, focus returns to whatever opened it (`restoreFocus: false` when the
 *   owner puts focus somewhere better, e.g. a queue of dialogs).
 */
export function useModal(
  ref: RefObject<HTMLElement | null>,
  { onClose, initialFocus, restoreFocus = true }: { onClose: () => void; initialFocus?: () => HTMLElement | null | undefined; restoreFocus?: boolean },
) {
  const close = useRef(onClose);
  const initial = useRef(initialFocus);
  useEffect(() => {
    close.current = onClose;
    initial.current = initialFocus;
  });
  // Read while rendering, i.e. BEFORE an autoFocus child steals focus on commit: this is the control that opened the modal.
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));

  useEffect(() => {
    const id = Symbol("modal");
    stack.push(id);
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) (initial.current?.() ?? focusablesIn(root)[0] ?? root)?.focus?.({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = focusablesIn(ref.current);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active ? ref.current.contains(active) : false;
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      if (restoreFocus && opener && document.contains(opener)) opener.focus?.({ preventScroll: true });
    };
  }, [ref, restoreFocus, opener]);
}
