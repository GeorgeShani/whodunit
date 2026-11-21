/**
 * Client helpers for the in-character "your notes were replaced by the cabinet's" moments (#95, #96, #94):
 *
 *   cabinetAhead():    a refused move (409 stale_token): another tab saved first; load the winner's snapshot.
 *   swappedSnapshot(): a move that ran on the stored save instead of the tab's token (stale, diverged, or an offline
 *                      tab reconnecting after its moves were rolled back): rebuild from the snapshot, show the notice.
 *   resumeNotice():    the notice /api/resume returned for the title-screen Continue.
 *
 * Pure functions (no React) so they are unit-tested directly (tests/components/cabinet-notice.test.ts).
 */
import type { ResumeSnapshot } from "@/engine/resume-schema";

export interface CabinetAhead {
  snapshot: ResumeSnapshot;
  stateToken: string;
  gameId?: string;
  saveVersion?: number;
  notice: string;
}

type Loose = {
  error?: unknown;
  snapshot?: { searchedLocationIds?: unknown; evidence?: unknown; testimonies?: unknown };
  stateToken?: unknown;
  gameId?: unknown;
  saveVersion?: unknown;
  notice?: unknown;
} | null | undefined;

const isSnapshot = (s: unknown): s is ResumeSnapshot => {
  const o = s as { searchedLocationIds?: unknown; evidence?: unknown; testimonies?: unknown } | null | undefined;
  return !!o && Array.isArray(o.searchedLocationIds) && Array.isArray(o.evidence) && Array.isArray(o.testimonies);
};

export function cabinetAhead(j: unknown): CabinetAhead | undefined {
  const o = j as Loose;
  if (!o || o.error !== "stale_token" || typeof o.stateToken !== "string" || typeof o.notice !== "string") return undefined;
  if (!isSnapshot(o.snapshot)) return undefined;
  return {
    snapshot: o.snapshot,
    stateToken: o.stateToken,
    notice: o.notice,
    ...(typeof o.gameId === "string" ? { gameId: o.gameId } : {}),
    ...(typeof o.saveVersion === "number" ? { saveVersion: o.saveVersion } : {}),
  };
}

/** A successful move that ran on the stored save: the snapshot to rebuild from and the notice to show. */
export function swappedSnapshot(j: unknown): { snapshot: ResumeSnapshot; notice: string } | undefined {
  const o = j as Loose;
  if (!o || o.error === "stale_token" || typeof o.notice !== "string" || !o.notice || !isSnapshot(o.snapshot)) return undefined;
  return { snapshot: o.snapshot, notice: o.notice };
}

/** The notice to show on the title screen next to Continue (any in-character resume notice). */
export function resumeNotice(j: unknown): string | undefined {
  const n = (j as Loose)?.notice;
  return typeof n === "string" && n.trim() ? n : undefined;
}

/** Hint view: the notice first, then the hint line. */
export function withNotice(notice: string | undefined, line: string): string {
  return notice ? `${notice} ${line}`.trim() : line;
}
