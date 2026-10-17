import { Fragment, type ReactNode } from "react";
import type { Block, Inline, Manual, ManualSection } from "@/lib/how-to-play";

type Level = 1 | 2 | 3 | 4 | 5;
const H = ({ level, className, id, children }: { level: Level; className?: string; id?: string; children: ReactNode }) => {
  const Tag = `h${Math.min(level, 6)}` as "h2";
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
};

export function InlineText({ text }: { text: readonly Inline[] }) {
  return (
    <>
      {text.map((x, i) =>
        x.t === "strong" ? (
          <strong key={i} className="font-black">
            {x.v}
          </strong>
        ) : x.t === "em" ? (
          <em key={i}>{x.v}</em>
        ) : x.t === "code" ? (
          <code key={i} className="rounded bg-black/10 px-1">
            {x.v}
          </code>
        ) : (
          <Fragment key={i}>{x.v}</Fragment>
        ),
      )}
    </>
  );
}

function Blocks({ blocks, level }: { blocks: readonly Block[]; level: Level }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "p")
          return (
            <p key={i}>
              <InlineText text={b.text} />
            </p>
          );
        if (b.type === "h")
          return (
            <H key={i} level={level} className="pt-1 font-display text-xl tracking-wide text-violet-700">
              <InlineText text={b.text} />
            </H>
          );
        if (b.type === "table")
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse border-[3px] border-black bg-white text-left text-sm sm:text-base">
                <thead className="bg-amber-200">
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j} scope="col" className="border-2 border-black px-2 py-1 font-black">
                        <InlineText text={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} className="border-2 border-black px-2 py-1 align-top">
                          <InlineText text={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        const List = b.type === "ol" ? "ol" : "ul";
        return (
          <List key={i} className={`space-y-1 ps-6 ${b.type === "ol" ? "list-decimal" : "list-disc"}`}>
            {b.items.map((it, j) => (
              <li key={j}>
                <InlineText text={it} />
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}

const SECTION_BOX = "rounded-2xl border-[3px] border-black bg-white/70 shadow-[3px_3px_0_#000]";
const SECTION_TITLE = "font-display text-2xl tracking-wider text-red-600";

/** A "Tips for this case" pseudo-section, from case.json howToPlayTips (absent or empty: nothing). */
export function tipsSection(tips: readonly string[] | undefined): ManualSection | null {
  const list = (tips ?? []).filter((t) => t.trim());
  return list.length ? { id: "tips-for-this-case", title: "Tips for this case", blocks: [{ type: "ul", items: list.map((t) => [{ t: "text", v: t }]) }] } : null;
}

/**
 * The manual's body. `level` is the heading level of each section title (sub-headings go one deeper).
 * collapsible: one <details> per section (native keyboard support), the first `openIds` expanded.
 */
export function ManualContent({
  manual,
  tips,
  level,
  collapsible = false,
  openIds = [],
}: {
  manual: Manual;
  tips?: readonly string[];
  level: Level;
  collapsible?: boolean;
  openIds?: readonly string[];
}) {
  const extra = tipsSection(tips);
  const sections = extra ? [manual.sections[0]!, extra, ...manual.sections.slice(1)] : manual.sections;
  const sub = Math.min(level + 1, 5) as Level;
  return (
    <div className="space-y-3 text-base leading-relaxed text-ink">
      {manual.intro.length > 0 && (
        <div className="space-y-2 font-semibold">
          <Blocks blocks={manual.intro} level={sub} />
        </div>
      )}
      {sections.map((s) =>
        collapsible ? (
          <details key={s.id} id={`htp-${s.id}`} data-htp-section={s.id} open={openIds.includes(s.id) || s.id === extra?.id} className={`group ${SECTION_BOX}`}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden">
              <H level={level} className={SECTION_TITLE}>
                {s.title}
              </H>
              <span aria-hidden className="text-xl transition-transform group-open:rotate-90">
                ▶
              </span>
            </summary>
            <div className="space-y-2 px-4 pb-4">
              <Blocks blocks={s.blocks} level={sub} />
            </div>
          </details>
        ) : (
          <section key={s.id} id={`htp-${s.id}`} data-htp-section={s.id} aria-labelledby={`htp-${s.id}-h`} className={`space-y-2 p-4 ${SECTION_BOX}`}>
            <H level={level} id={`htp-${s.id}-h`} className={SECTION_TITLE}>
              {s.title}
            </H>
            <Blocks blocks={s.blocks} level={sub} />
          </section>
        ),
      )}
    </div>
  );
}
