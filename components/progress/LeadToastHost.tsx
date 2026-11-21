"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NewLeadToast } from "@/components/progress/NewLeadToast";
import type { PublicProgress } from "@/engine/progress";

export type LeadToastLead = PublicProgress["leads"][number];

/** Leads that opened or closed in this progress payload (the same filter Game used when it owned the queue). */
export function leadsToAnnounce(p: PublicProgress): LeadToastLead[] {
  return p.leads.filter((l) => p.newLeadIds.includes(l.id));
}

type LeadToastApi = {
  pushLeads: (leads: LeadToastLead[]) => void;
  clearLeads: () => void;
  setSuppressed: (suppressed: boolean) => void;
};

const LeadToastContext = createContext<LeadToastApi | null>(null);

export function useLeadToasts(): LeadToastApi {
  const ctx = useContext(LeadToastContext);
  if (!ctx) throw new Error("useLeadToasts must be used within LeadToastHost");
  return ctx;
}

/**
 * Global host for the NEW LEAD sting. Mount once at the game root; existing triggers
 * (`applyProgress`) push into this context. The toast is portaled to `document.body` so it
 * is never a child of `.stage` (that box uses `transform` and would pin `fixed`/`absolute`
 * positioning to itself) or of a Framer Motion screen layer, whose scale animation was
 * dragging the toast sideways before it settled.
 */
export function LeadToastHost({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<LeadToastLead[]>([]);
  const [suppressed, setSuppressed] = useState(false);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  useEffect(() => setMount(document.body), []);

  const pushLeads = useCallback((leads: LeadToastLead[]) => {
    if (!leads.length) return;
    setQueue((q) => [...q, ...leads]);
  }, []);
  const clearLeads = useCallback(() => setQueue([]), []);
  const value = useMemo(() => ({ pushLeads, clearLeads, setSuppressed }), [pushLeads, clearLeads]);

  const toast = <NewLeadToast lead={suppressed ? null : (queue[0] ?? null)} onDone={() => setQueue((q) => q.slice(1))} />;

  return (
    <LeadToastContext.Provider value={value}>
      {children}
      {mount ? createPortal(toast, mount) : null}
    </LeadToastContext.Provider>
  );
}
