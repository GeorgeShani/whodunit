/**
 * SERVER-ONLY. A tiny best-effort key/value store on the Vercel Runtime Cache, for the model budget (ai/model-gate.ts).
 *
 * The Runtime Cache is per region, TTL-bound and may evict (it is a cache, not a database); it has no atomic
 * increment, so counters built on it are approximate under concurrency. Every value is also kept in a bounded
 * in-process map, so one warm instance stays consistent even when the cache is slow or unavailable. Outside Vercel
 * (dev, tests) getCache() itself falls back to memory.
 */
import { getCache } from "@vercel/functions";

export interface KvStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A plain in-memory store with TTLs (tests, and the in-process layer of the runtime store). */
export function memoryKv(max = 2000, now: () => number = Date.now): KvStore {
  const map = new Map<string, { v: unknown; exp: number }>();
  return {
    async get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (e.exp <= now()) {
        map.delete(key);
        return undefined;
      }
      return e.v;
    },
    async set(key, v, ttlSeconds) {
      map.delete(key);
      if (map.size >= max) map.delete(map.keys().next().value as string);
      map.set(key, { v, exp: now() + ttlSeconds * 1000 });
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

const local = memoryKv();
const cache = () => getCache({ namespace: "whodunit-budget" });

/**
 * Runtime Cache first, in-process copy as the fallback. A cache error is rethrown from get() only when there is no
 * local copy either, so the caller can decide whether that key fails open or closed.
 */
export const runtimeKv: KvStore = {
  async get(key) {
    try {
      const v = await cache().get(key);
      if (v !== undefined && v !== null) return v;
    } catch (e) {
      const v = await local.get(key);
      if (v !== undefined) return v;
      throw e;
    }
    return local.get(key);
  },
  async set(key, value, ttlSeconds) {
    await local.set(key, value, ttlSeconds);
    try {
      await cache().set(key, value, { ttl: Math.max(1, Math.ceil(ttlSeconds)), name: "model-budget" });
    } catch {
      /* best effort: the in-process copy still covers this instance */
    }
  },
  async delete(key) {
    await local.delete(key);
    try {
      await cache().delete(key);
    } catch {
      /* best effort */
    }
  },
};
