/**
 * SERVER-ONLY. Best-effort "this game has already been accused" record (#22),
 * kept in the Vercel Runtime Cache (per region, TTL-bound; not a database).
 *
 * Tradeoff: tokens stay stateless, so there is no DB to run. The guard is only
 * as strong as the cache: a request that lands in another region, or after the
 * TTL, or after an eviction, or in the instant before the first write lands, is
 * not caught (#39, a documented known limitation). The state-token max age
 * (7 days) bounds how long a saved pre-accusation token can be replayed at all. Outside
 * Vercel (dev, tests) it falls back to a bounded in-process map.
 * It fails OPEN: a cache error never blocks a legitimate accusation.
 */
import { getCache } from "@vercel/functions";
import type { AccusedStore } from "@/engine/accuse-handler";
import { AccusationSchema, type Accusation } from "@/engine/types";

/**
 * 30 days: well past the 7-day state-token max age (engine/state-token.ts), so while a pre-accusation token can still
 * be played the record should still be there. Vercel documents the Runtime Cache as persisting across deployments,
 * but it is a cache (per region, LRU eviction), so this is best effort, not a guarantee (#39).
 */
export const ACCUSED_TTL_SECONDS = 30 * 24 * 3600;
const MEMORY_MAX = 500;
const memory = new Map<string, Accusation>();

const key = (gameId: string) => `whodunit:accused:${gameId}`;

export const accusedStore: AccusedStore = {
  async get(gameId) {
    const local = memory.get(gameId);
    if (local) return local;
    try {
      const parsed = AccusationSchema.safeParse(await getCache().get(key(gameId)));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
  async put(gameId, accusation) {
    if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value as string);
    memory.set(gameId, accusation);
    try {
      await getCache().set(key(gameId), accusation, { ttl: ACCUSED_TTL_SECONDS, name: "accused-game" });
    } catch {
      /* fail open: the in-process copy still covers this instance */
    }
  },
};
