/**
 * SERVER-ONLY. Preview-only "pretend the database is down" switch, so QA can exercise the outage paths (#94: offline
 * tokens, the same-tab fallback, the outage replay floor, accusations failing closed) without touching env vars or
 * the database.
 *
 * It exists ONLY when all of these hold, otherwise it is ignored exactly as if it did not exist:
 *   - VERCEL_ENV === "preview" (production, development and tests never honour it);
 *   - VERCEL_AUTOMATION_BYPASS_SECRET is set server-side;
 *   - the request carries `x-whodunit-test-outage: db-down`;
 *   - and `x-vercel-protection-bypass` (or `x-whodunit-bypass`, if the platform strips the first) equals that secret,
 *     compared in constant time. The secret is never logged or echoed.
 *
 * When on, saved_games and closed_games calls for THAT request reject as if the connection failed.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const TEST_OUTAGE_HEADER = "x-whodunit-test-outage";
export const TEST_OUTAGE_VALUE = "db-down";
const BYPASS_HEADERS = ["x-vercel-protection-bypass", "x-whodunit-bypass"] as const;

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

export function simulatedDbOutage(headers: Headers | undefined | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!headers) return false;
  if (env.VERCEL_ENV !== "preview") return false;
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return false;
  if (headers.get(TEST_OUTAGE_HEADER)?.trim().toLowerCase() !== TEST_OUTAGE_VALUE) return false;
  const want = digest(secret);
  return BYPASS_HEADERS.some((h) => {
    const got = headers.get(h);
    return typeof got === "string" && got.length > 0 && timingSafeEqual(digest(got), want);
  });
}

/** The error every repo call rejects with while the switch is on (classified like a refused connection). */
export class SimulatedOutageError extends Error {
  readonly code = "ECONNREFUSED";
  constructor() {
    super("simulated database outage (preview test switch)");
    this.name = "SimulatedOutageError";
  }
}
