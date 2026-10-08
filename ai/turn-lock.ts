/**
 * SERVER-ONLY. One paid model turn per pre-turn state (#40).
 *
 * The game state is a stateless signed token, so the same token could be sent many times (in parallel, or replayed
 * later) and each copy would run a fresh, billed model turn, also stepping past the confrontation caps. This lock
 * claims "game G at turn N" (gameId + the token's turn counter, so two different tokens of the same game and turn,
 * e.g. one that also searched a room, share it) before the model is called:
 *  - in flight: a second request for the same state gets 409 ("still answering") with no model call;
 *  - answered: the claim is kept for ANSWERED_TTL_SECONDS together with the token that answer produced and the
 *    minimal public reply the player saw (#49), so a duplicate gets 409 ("already answered") plus that newest token
 *    and that reply, again with no model call;
 *  - not answered (the model was unavailable, the gate refused, anything threw): the claim is released at once, so
 *    the player's AGAIN retry with the same token works.
 * Best effort, like everything on the Runtime Cache (lib/runtime-kv.ts): concurrent requests on one instance are
 * caught by a synchronous in-process set; across instances a write-then-read-back owner check narrows the race but
 * cannot close it, and a region change, eviction or TTL expiry forgets a claim. A cache error fails open (logged).
 * The per-IP limit and the daily cap (ai/model-gate.ts) still bound whatever slips through.
 */
import { randomBytes } from "node:crypto";
import type { KvStore } from "@/lib/runtime-kv";

/** How long an in-flight claim lives if the function dies without releasing it (longer than maxDuration 60 s). */
export const IN_FLIGHT_TTL_SECONDS = 90;
/** How long an answered state stays claimed (duplicates within this window cost nothing). */
export const ANSWERED_TTL_SECONDS = 24 * 3600;
/** Tokens above this size are not stored with the claim (the duplicate then gets the 409 without a newer token). */
const MAX_STORED_TOKEN = 32_000;

/** Stored public replies above this JSON size are dropped (the duplicate then gets the 409 without the answer). */
const MAX_STORED_REPLY = 4_000;

type Claim = { s: "pending"; o: string } | { s: "done"; t?: string; r?: unknown };

export interface HeldTurn {
  ok: true;
  /**
   * The turn was answered and committed: keep the claim, remembering the token it produced and (#49) the minimal
   * PUBLIC reply the player was shown (dialogue, action, emotion; never secrets or engine state), so a duplicate can
   * show it again instead of re-asking.
   */
  answered(newToken: string, publicReply?: unknown): Promise<void>;
  /** Nothing was committed (unavailable, refused, error): free the state for a retry. Idempotent. */
  release(): Promise<void>;
}
export type TurnClaim = HeldTurn | { ok: false; state: "in_flight" | "answered"; latestToken?: string; latestReply?: unknown };

const local = new Set<string>();
const isClaim = (v: unknown): v is Claim => !!v && typeof v === "object" && ((v as Claim).s === "pending" || (v as Claim).s === "done");

export async function claimTurn(kv: KvStore, gameId: string, turn: number, log: (m: string) => void = (m) => console.warn(m)): Promise<TurnClaim> {
  const key = `turn:${gameId}:${turn}`;
  // Same instance: a synchronous check-and-set (no await in between), so a parallel burst on one instance yields one winner.
  if (local.has(key)) return { ok: false, state: "in_flight" };
  local.add(key);
  const owner = randomBytes(9).toString("base64url");
  let done = false;
  const finish = async (fn: () => Promise<void>) => {
    if (done) return;
    done = true;
    try {
      await fn();
    } catch (e) {
      log(`[turn-lock] write failed (${(e as Error)?.name ?? "error"})`);
    } finally {
      local.delete(key);
    }
  };
  const held: HeldTurn = {
    ok: true,
    answered: (t, r) =>
      finish(() =>
        kv.set(
          key,
          { s: "done", ...(t.length <= MAX_STORED_TOKEN ? { t } : {}), ...(r !== undefined && JSON.stringify(r).length <= MAX_STORED_REPLY ? { r } : {}) } satisfies Claim,
          ANSWERED_TTL_SECONDS,
        ),
      ),
    release: () => finish(() => kv.delete(key)),
  };

  try {
    const existing = await kv.get(key);
    if (isClaim(existing)) {
      local.delete(key);
      done = true;
      return existing.s === "done" ? { ok: false, state: "answered", ...(existing.t ? { latestToken: existing.t } : {}), ...(existing.r !== undefined ? { latestReply: existing.r } : {}) } : { ok: false, state: "in_flight" };
    }
    await kv.set(key, { s: "pending", o: owner } satisfies Claim, IN_FLIGHT_TTL_SECONDS);
    // Another instance may have claimed it in the same instant: the last writer wins, the other backs off.
    const back = await kv.get(key);
    if (isClaim(back) && !(back.s === "pending" && back.o === owner)) {
      local.delete(key);
      done = true;
      return back.s === "done" ? { ok: false, state: "answered", ...(back.t ? { latestToken: back.t } : {}), ...(back.r !== undefined ? { latestReply: back.r } : {}) } : { ok: false, state: "in_flight" };
    }
  } catch (e) {
    log(`[turn-lock] claim unreadable (${(e as Error)?.name ?? "error"}); fail open`);
  }
  return held;
}
