/**
 * SERVER-ONLY. Cost protection for the paid model (docs/OPERATIONS.md "Cost protection and limits").
 *
 * Every model turn (one interrogation answer; a confrontation exchange is TWO) passes this gate BEFORE the model is
 * called, in this order:
 *   1. MODEL_DISABLED kill switch            -> refused, no counters touched (in-character "quiet" line, 503).
 *   2. per-IP limit (MODEL_RATE_LIMIT turns per MODEL_RATE_WINDOW_SECONDS, default 20 per 600 s, fixed window)
 *                                            -> 429 + Retry-After, in-character "breather" line.
 *   3. global daily cap (MODEL_DAILY_CAP turns per UTC day, default 300)
 *                                            -> 503, the in-character "quiet" line until UTC midnight.
 * A refused request spends nothing and the client keeps its state token. A passed request reserves its cost up
 * front (so a parallel burst is counted) and gives it back if the model was never actually called (circuit breaker
 * open, missing key).
 *
 * Storage is the Vercel Runtime Cache (lib/runtime-kv.ts): per region, best effort, no atomic increment, so a
 * burst of exactly simultaneous requests can slip a few turns past either limit. Both limits FAIL OPEN when the
 * counter cannot be read (logged as "[model-gate] ... fail open"): the cache is best effort, and failing closed
 * would silence every suspect for every player whenever the cache hiccups. The hard backstop for money is the
 * spending limit on the xAI account itself; the in-app limits keep normal abuse well below it.
 */
import { createHash } from "node:crypto";
import type { KvStore } from "@/lib/runtime-kv";

type Env = Record<string, string | undefined>;

export const BUDGET_DEFAULTS = { ratePerWindow: 20, windowSeconds: 600, dailyCap: 300 } as const;

export interface BudgetConfig {
  disabled: boolean;
  ratePerWindow: number;
  windowSeconds: number;
  dailyCap: number;
}

const int = (raw: string | undefined, fallback: number, min: number) => {
  const n = Number((raw ?? "").trim());
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= min ? n : fallback;
};

/** Read the limits from the environment (invalid values fall back to the defaults; 0 means "no model turns"). */
export function budgetConfig(env: Env = process.env): BudgetConfig {
  return {
    disabled: /^(1|true|yes|on)$/i.test((env.MODEL_DISABLED ?? "").trim()),
    ratePerWindow: int(env.MODEL_RATE_LIMIT, BUDGET_DEFAULTS.ratePerWindow, 0),
    windowSeconds: int(env.MODEL_RATE_WINDOW_SECONDS, BUDGET_DEFAULTS.windowSeconds, 1),
    dailyCap: int(env.MODEL_DAILY_CAP, BUDGET_DEFAULTS.dailyCap, 0),
  };
}

const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * The caller's IP as Vercel reports it. On Vercel, x-real-ip and x-forwarded-for are set by the edge and a
 * client-sent value is overwritten, so the first hop is the client. Off Vercel (dev) the headers are whatever the
 * client sent, which is fine for a local limit. Anything that does not look like an IP shares one "unknown" bucket.
 */
export function clientIp(headers: Headers): string {
  const candidates = [headers.get("x-real-ip"), headers.get("x-forwarded-for")?.split(",")[0]];
  for (const c of candidates) {
    const v = c?.trim();
    if (v && IP_RE.test(v)) return v;
  }
  return "unknown";
}

export type GateRefusal =
  | { ok: false; reason: "model_disabled" }
  | { ok: false; reason: "rate_limited"; retryAfterSec: number }
  | { ok: false; reason: "daily_cap"; retryAfterSec: number };

export interface GatePass {
  ok: true;
  /**
   * Call once the turn is over. `called: false` (the model was never reached) refunds the reserved turns.
   * `extra`: model calls beyond the reserved ones (a rejected reply's single retry, e.g. the guilt-leak or canon
   * check) are charged to both counters too, after the fact (never refused: the call already happened).
   */
  settle(o: { called: boolean; extra?: number }): Promise<void>;
}

export interface ModelGate {
  /** Reserve `cost` model turns (1 per interrogation, 2 per confrontation exchange) or refuse. */
  open(cost: number): Promise<GatePass | GateRefusal>;
}

export interface GateDeps {
  kv: KvStore;
  ip: string;
  env?: Env;
  now?: () => number;
  log?: (msg: string) => void;
}

const DAY_MS = 24 * 3600 * 1000;
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ipKey = (ip: string) => createHash("sha256").update(`whodunit-ip:${ip}`).digest("base64url").slice(0, 22);
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function createModelGate({ kv, ip, env = process.env, now = Date.now, log = (m) => console.warn(m) }: GateDeps): ModelGate {
  const read = async (key: string, what: string): Promise<number> => {
    try {
      return count(await kv.get(key));
    } catch (e) {
      log(`[model-gate] ${what} counter unreadable (${(e as Error)?.name ?? "error"}); fail open`);
      return 0;
    }
  };
  const write = async (key: string, value: number, ttl: number) => {
    try {
      await kv.set(key, Math.max(0, value), ttl);
    } catch (e) {
      log(`[model-gate] counter write failed (${(e as Error)?.name ?? "error"})`);
    }
  };

  return {
    async open(cost) {
      const cfg = budgetConfig(env);
      if (cfg.disabled) return { ok: false, reason: "model_disabled" };
      const t = now();

      // Per-IP, fixed window.
      const winMs = cfg.windowSeconds * 1000;
      const win = Math.floor(t / winMs);
      const rk = `ip:${ipKey(ip)}:${win}`;
      const used = await read(rk, "per-IP");
      if (used + cost > cfg.ratePerWindow) {
        return { ok: false, reason: "rate_limited", retryAfterSec: Math.max(1, Math.ceil(((win + 1) * winMs - t) / 1000)) };
      }
      await write(rk, used + cost, cfg.windowSeconds);

      // Global, per UTC day.
      const dk = `day:${utcDay(t)}`;
      const today = await read(dk, "daily");
      const untilMidnight = Math.max(1, Math.ceil((DAY_MS - (t % DAY_MS)) / 1000));
      if (today + cost > cfg.dailyCap) {
        await write(rk, used, cfg.windowSeconds); // give the per-IP reservation back: nothing was spent
        log(`[model-gate] daily cap ${cfg.dailyCap} reached`);
        return { ok: false, reason: "daily_cap", retryAfterSec: untilMidnight };
      }
      await write(dk, today + cost, 2 * 24 * 3600);

      let settled = false;
      return {
        ok: true,
        async settle({ called, extra = 0 }) {
          if (settled) return;
          settled = true;
          if (called) {
            const more = Math.max(0, Math.floor(extra));
            if (more > 0) {
              await write(rk, (await read(rk, "per-IP")) + more, cfg.windowSeconds);
              await write(dk, (await read(dk, "daily")) + more, 2 * 24 * 3600);
            }
            return;
          }
          await write(rk, (await read(rk, "per-IP")) - cost, cfg.windowSeconds);
          await write(dk, (await read(dk, "daily")) - cost, 2 * 24 * 3600);
        },
      };
    },
  };
}
