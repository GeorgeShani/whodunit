/**
 * Request-scoped context for saved-game minting (#94).
 *
 * Fallback play (DB unconfigured or unreachable) is same-tab only: the client
 * may keep using the leftover token in this tab, but those tokens are minted
 * with a signed `offline` flag and are never written to saved_games.
 *
 * The in-memory high-water mark is best-effort and per-instance: it can reject
 * an older token during an outage on this process, but it is not shared across
 * instances and is not a substitute for the cabinet row.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<{ mintOffline: boolean }>();

/** Run a handler so every token it mints is marked offline when the cabinet is shut. */
export function runWithSaveContext<T>(mintOffline: boolean, fn: () => T): T {
  return context.run({ mintOffline }, fn);
}

export function mintOfflineThisRequest(): boolean {
  return context.getStore()?.mintOffline === true;
}

const highWater = new Map<string, number>();

/** Best-effort per-instance floor for a game id (outage anti-replay). */
export function noteIssuedVersion(gameId: string, version: number): void {
  const prev = highWater.get(gameId) ?? 0;
  if (version > prev) highWater.set(gameId, version);
}

export function issuedHighWater(gameId: string): number | undefined {
  return highWater.get(gameId);
}

/** Test hook: drop the in-memory floor. */
export function resetIssuedHighWater(): void {
  highWater.clear();
}
