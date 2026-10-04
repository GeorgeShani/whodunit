"use client";

import type { PublicProgress } from "@/engine/progress";

/** The notebook's Leads tab: open questions with their hints; closed ones struck through with a stamp. */
export function LeadsPanel({
  leads,
  newLeadIds = [],
}: {
  leads: PublicProgress["leads"];
  newLeadIds?: string[];
}) {
  if (leads.length === 0) {
    return (
      <p className="font-semibold italic text-neutral-600">
        No leads yet. Talk to the household and search the house: something will
        turn up.
      </p>
    );
  }
  const open = leads.filter((l) => l.state === "open");
  const closed = leads.filter((l) => l.state === "closed");
  return (
    <div className="flex flex-col gap-4" data-leads-panel>
      <ul className="flex flex-col gap-3" aria-label="Open leads">
        {open.map((l) => (
          <li
            key={l.id}
            data-lead-id={l.id}
            data-lead-state="open"
            className="rounded-2xl border-[3px] border-black bg-white p-3 shadow-[4px_4px_0_#000]"
          >
            <p className="flex flex-wrap items-center gap-2 font-display text-xl tracking-wide">
              <span aria-hidden>❓</span> {l.title}
              {newLeadIds.includes(l.id) && (
                <span className="rounded-full border-2 border-black bg-yellow-300 px-2 py-0.5 text-sm font-black uppercase">
                  New
                </span>
              )}
            </p>
            <p className="mt-1 text-base">{l.hint}</p>
          </li>
        ))}
        {open.length === 0 && (
          <li className="font-semibold italic text-neutral-600">
            Every lead you have is solved. Time to put it all together?
          </li>
        )}
      </ul>
      {closed.length > 0 && (
        <section aria-label="Solved leads">
          <h3 className="mb-2 text-sm font-black uppercase tracking-wide text-neutral-700">
            Solved ({closed.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {closed.map((l) => (
              <li
                key={l.id}
                data-lead-id={l.id}
                data-lead-state="closed"
                className="flex flex-wrap items-center gap-2 rounded-2xl border-[3px] border-black bg-lime-100 p-3"
              >
                <span className="rounded-md border-2 border-black bg-lime-300 px-2 py-0.5 text-sm font-black uppercase -rotate-3">
                  Solved
                </span>
                <span className="font-display text-lg tracking-wide line-through decoration-2">
                  {l.title}
                </span>
                {l.closedLine && (
                  <span className="basis-full text-base font-semibold text-neutral-800">
                    {l.closedLine}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
