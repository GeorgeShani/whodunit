"use client";

import { backdropStyle } from "@/components/game/backdrop";
import type { UnlockLink } from "./unlock";

/**
 * Phase 10 (3.8): a case that is still sealed. A real, indexable teaser (title and tagline), the case it waits on,
 * and a way to go and play that one. No skip link (Q17 is open).
 */
export function LockedScreen({ title, tagline, requires, backdrop }: { title: string; tagline: string; requires: UnlockLink[]; backdrop?: string }) {
  const names = requires.map((r) => r.title);
  const list = names.length <= 1 ? (names[0] ?? "the first case") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <main
      data-case-locked
      className="screen-scroll flex min-h-0 flex-1 flex-col items-center justify-center gap-6 bg-backdrop bg-cover bg-center px-5 py-10 text-center short:justify-start short:gap-3 short:pb-4 short:pt-16"
      style={backdropStyle(backdrop)}
    >
      <p className="rotate-[-4deg] rounded-md border-4 border-black bg-red-500 px-4 py-1 font-display text-2xl tracking-widest text-white shadow-[4px_4px_0_#000] sm:text-3xl">
        🔒 CASE SEALED
      </p>
      <h1
        data-autofocus
        tabIndex={-1}
        className="max-w-3xl text-balance font-display text-[clamp(2rem,8vw,3.75rem)] leading-none tracking-wide text-accent [-webkit-text-stroke:2px_#000] drop-shadow-[4px_4px_0_#000]"
      >
        {title}
      </h1>
      <p className="max-w-xl rounded-2xl border-4 border-black bg-white px-5 py-3 text-lg font-bold text-ink shadow-[6px_6px_0_#000] max-sm:text-base">
        {tagline}
      </p>
      <p className="max-w-xl rounded-2xl border-[3px] border-black bg-amber-100 px-5 py-3 text-lg font-semibold italic text-ink shadow-[4px_4px_0_#000] max-sm:text-base">
        &ldquo;Not so fast, detective. This file stays sealed until you&apos;ve cracked {list}. Close that one first, and it&apos;s yours.&rdquo;
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {requires.map((r) => (
          <a
            key={r.id}
            href={r.href}
            data-locked-play={r.id}
            className="inline-flex min-h-14 items-center rounded-xl border-[3px] border-black bg-red-500 px-6 py-2 font-display text-2xl tracking-widest text-white shadow-[4px_4px_0_#000] hover:bg-red-400"
          >
            PLAY {r.title.toUpperCase()}
          </a>
        ))}
      </div>
    </main>
  );
}
