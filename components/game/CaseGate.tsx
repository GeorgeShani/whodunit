"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isUnlocked, readSolved } from "@/lib/solved-store";
import { LockedScreen } from "./LockedScreen";
import type { UnlockLink } from "./unlock";

/**
 * Phase 10 (3.8): mounts the game only once this browser has solved every case in `unlockedBy`. The page is static,
 * so storage is read after hydration: a neutral splash until then (no flash of the game), then the game or the
 * locked teaser. No `unlockedBy`: the game renders at once (the first case is never gated). An in-progress saved game
 * is untouched; the gate only decides whether to mount it.
 */
export function CaseGate({
  unlockedBy,
  requires,
  title,
  tagline,
  backdrop,
  children,
}: {
  unlockedBy: readonly string[];
  requires: UnlockLink[];
  title: string;
  tagline: string;
  backdrop?: string;
  children: ReactNode;
}) {
  const gated = unlockedBy.length > 0;
  const [state, setState] = useState<"checking" | "open" | "locked">(gated ? "checking" : "open");
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot read of an external store after hydration */
  useEffect(() => {
    if (gated) setState(isUnlocked(unlockedBy, readSolved()) ? "open" : "locked");
  }, [gated, unlockedBy]);
  /* eslint-enable react-hooks/set-state-in-effect */
  if (state === "open") return <>{children}</>;
  return (
    <div className="stage">
      <div className="absolute inset-0 flex flex-col" data-screen={state === "locked" ? "locked" : "checking"}>
        {state === "locked" ? (
          <LockedScreen title={title} tagline={tagline} requires={requires} {...(backdrop ? { backdrop } : {})} />
        ) : (
          <main data-case-gate-checking aria-busy="true" className="flex min-h-0 flex-1 bg-backdrop" />
        )}
      </div>
    </div>
  );
}
