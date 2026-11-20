"use client";

import { useEffect } from "react";
import type { PublicCaseView } from "@/engine/public-view";
import {
  casePrefetchList,
  isConstrainedConnection,
  preferredAudioExt,
  readConnection,
  startCasePrefetch,
} from "@/lib/case-prefetch";

/**
 * When a case is open (the intro and later screens), prefetch that case's
 * public assets in the background. Aborts on unmount or when the case changes.
 * Does not run on the title screen, and never blocks rendering.
 */
export function useCasePrefetch(view: PublicCaseView, enabled: boolean): void {
  const caseId = view.meta.id;
  useEffect(() => {
    if (!enabled) return;
    const light = isConstrainedConnection(readConnection());
    const items = casePrefetchList(view, { light, audioExt: preferredAudioExt() });
    return startCasePrefetch(items);
  }, [enabled, caseId, view]);
}
