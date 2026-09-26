/**
 * Lightning timing, docs/ART_BIBLE.md §7.1 "Lightning swap": show the
 * _lightning background for 2 frames (~33 ms), base for ~90 ms, then 1 more
 * frame; thunder 300-600 ms later.
 *
 * Photosensitivity (WCAG 2.3.1): never more than 3 flashes in any 1 s window,
 * in any mode. Each storm is 2 flashes and storms are >= 9 s apart; the
 * FlashGuard enforces the cap regardless of how flashes are requested.
 */

/** One storm: [delay from storm start in ms, lightning frame on?]. */
export const STORM_FRAMES: ReadonlyArray<readonly [number, boolean]> = [
  [0, true],
  [33, false],
  [123, true],
  [140, false],
];

export const MAX_FLASHES_PER_WINDOW = 3;
export const FLASH_WINDOW_MS = 1000;
export const MIN_STORM_GAP_MS = 9000;
export const FIRST_STORM_MS = 2500;

export function nextStormDelay(random: () => number = Math.random): number {
  return MIN_STORM_GAP_MS + Math.floor(random() * 12000);
}

export function thunderDelay(random: () => number = Math.random): number {
  return 300 + Math.floor(random() * 300);
}

/** Refuses a flash onset if 3 already happened in the last second. */
export class FlashGuard {
  private onsets: number[] = [];
  constructor(
    private readonly max = MAX_FLASHES_PER_WINDOW,
    private readonly windowMs = FLASH_WINDOW_MS,
  ) {}

  allow(now: number): boolean {
    this.onsets = this.onsets.filter((t) => now - t < this.windowMs);
    if (this.onsets.length >= this.max) return false;
    this.onsets.push(now);
    return true;
  }
}

/** Largest number of onsets inside any window of `windowMs` (for tests). */
export function maxFlashesInWindow(onsets: readonly number[], windowMs = FLASH_WINDOW_MS): number {
  const sorted = [...onsets].sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (sorted[i] - sorted[j] >= windowMs) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}
