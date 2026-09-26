/**
 * In-world clock helpers. A case takes place over one "game day" that starts at
 * `meta.dayStartsAt` (default "12:00"). Times earlier than dayStartsAt are
 * treated as the NEXT calendar day, so an evening that runs past midnight
 * ("23:30" -> "00:15") stays ordered correctly.
 */
import type { GameTime } from "./types";

export const DEFAULT_DAY_STARTS_AT: GameTime = "12:00";

/** Minutes since midnight for a raw "HH:MM" string. */
export function clockMinutes(time: GameTime): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes since the start of the game day (monotonic across midnight). */
export function gameMinutes(time: GameTime, dayStartsAt: GameTime = DEFAULT_DAY_STARTS_AT): number {
  const t = clockMinutes(time);
  const start = clockMinutes(dayStartsAt);
  return t >= start ? t - start : t + 24 * 60 - start;
}
