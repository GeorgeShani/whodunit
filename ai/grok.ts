/**
 * SERVER-ONLY. Minimal xAI (Grok) chat-completions client: plain fetch,
 * structured JSON output, hard timeout, Zod validation, one retry on schema
 * failure or on a failed caller `validate` check (e.g. the canon time check). Never logs or returns the API key, the prompt, or raw output.
 */
import { CharacterResponseSchema, type CharacterResponse } from "./schemas";
import { CHARACTER_RESPONSE_JSON_SCHEMA } from "./prompts/interrogation";

type Env = Record<string, string | undefined>;

export const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
/** Fast non-reasoning Grok; override with XAI_MODEL. */
export const DEFAULT_XAI_MODEL = "grok-4.20-0309-non-reasoning";
export const GROK_TIMEOUT_MS = 12_000;
export const GROK_MAX_TOKENS = 400;
/** Total attempts: the first call plus at most one retry, only after a schema or validate failure. */
export const GROK_MAX_ATTEMPTS = 2;

export type GrokFailure =
  | "missing_key"
  | "timeout"
  | "http_error"
  | "network_error"
  | "schema_invalid"
  | "canon_check_failed"
  /** Out of credits / billing / spending limit / bad or forbidden key (HTTP 401, 402, 403, or a 429 whose body says so). Retrying cannot help. */
  | "quota"
  /** HTTP 429 without a billing message: slow down. */
  | "rate_limited";

export type GrokResult =
  | { ok: true; response: CharacterResponse; model: string; attempts: number; latencyMs: number }
  /** `skipped`: the circuit breaker answered without calling xAI. */
  | { ok: false; reason: GrokFailure; model: string; attempts: number; latencyMs: number; status?: number; skipped?: boolean };

/** Billing-style wording in an xAI error body (matched on a short, lowercased slice; the body is never logged or returned). */
const QUOTA_BODY = /credit|billing|quota|spending limit|insufficient|exhausted|out of funds|payment|balance|purchase/i;

/** Classify a non-2xx xAI reply. Exported for tests. */
export function classifyHttpFailure(status: number, body: string): GrokFailure {
  if (status === 402 || status === 403 || status === 401) return "quota";
  if (status === 429) return QUOTA_BODY.test(body.slice(0, 2000)) ? "quota" : "rate_limited";
  if (status >= 400 && status < 500 && QUOTA_BODY.test(body.slice(0, 2000))) return "quota";
  return "http_error";
}

/** Failures that mean "the model is out of reach", as opposed to "the model answered badly" (canon_check_failed). */
export function isModelDown(reason: GrokFailure): boolean {
  return reason !== "canon_check_failed";
}

/** Billing/auth problems vs everything else (player-facing tone and no-retry policy differ). */
export const isQuotaFailure = (reason: GrokFailure): boolean => reason === "quota" || reason === "missing_key";

// ---------------------------------------------------------------------------
// Circuit breaker (per server process): a failing model is not asked again for a short while, so a burst of requests
// does not each wait out the 12 s timeout, and an exhausted account is not hammered.
// ---------------------------------------------------------------------------
export const QUOTA_BREAKER_MS = 60_000;
export const RATE_LIMIT_BREAKER_MS = 15_000;
export const TRANSIENT_BREAKER_MS = 15_000;
/** Consecutive timeouts / network / 5xx / unusable replies before the breaker opens (one blip should still be retryable at once). */
export const TRANSIENT_FAILURES_TO_OPEN = 2;

interface Breaker {
  until: number;
  reason: GrokFailure;
  status?: number;
}
let breaker: Breaker | null = null;
let transientStreak = 0;

export function resetGrokBreaker(): void {
  breaker = null;
  transientStreak = 0;
}

function recordFailure(f: Extract<GrokResult, { ok: false }>, retryAfterMs?: number): void {
  const now = Date.now();
  if (f.reason === "quota") breaker = { until: now + QUOTA_BREAKER_MS, reason: f.reason, ...(f.status ? { status: f.status } : {}) };
  else if (f.reason === "rate_limited") breaker = { until: now + Math.min(60_000, Math.max(RATE_LIMIT_BREAKER_MS, retryAfterMs ?? 0)), reason: f.reason, ...(f.status ? { status: f.status } : {}) };
  else if (f.reason === "timeout" || f.reason === "network_error" || f.reason === "http_error" || f.reason === "schema_invalid") {
    transientStreak += 1;
    if (transientStreak >= TRANSIENT_FAILURES_TO_OPEN) breaker = { until: now + TRANSIENT_BREAKER_MS, reason: f.reason, ...(f.status ? { status: f.status } : {}) };
  }
}

/** Parse model text into a CharacterResponse, or null. Exported for tests. */
export function parseModelReply(content: unknown): CharacterResponse | null {
  if (typeof content !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.action === "string" && o.action.trim() === "") delete o.action;
    // A percentage instead of 0..1 (seen live: "intensity": 80) is a performance hint, not worth a retry.
    if (typeof o.intensity === "number" && o.intensity > 1 && o.intensity <= 100) o.intensity = o.intensity / 100;
  }
  const parsed = CharacterResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function callGrokUncached(opts: {
  system: string;
  user: string;
  env?: Env;
  timeoutMs?: number;
  /**
   * Optional deterministic post-check. Return null if the reply is acceptable,
   * or a short correction for the model; the call is retried once with it, then
   * fails with "canon_check_failed".
   */
  validate?: (r: CharacterResponse) => string | null;
}): Promise<GrokResult & { retryAfterMs?: number }> {
  const env = opts.env ?? process.env;
  const model = env.XAI_MODEL?.trim() || DEFAULT_XAI_MODEL;
  const started = Date.now();
  const key = env.XAI_API_KEY;
  if (!key) return { ok: false, reason: "missing_key", model, attempts: 0, latencyMs: 0 };

  let attempts = 0;
  let last: GrokResult = { ok: false, reason: "schema_invalid", model, attempts, latencyMs: 0 };
  let retryNote = "Your previous reply was not valid. Reply again with ONLY a JSON object that matches the schema exactly.";
  while (attempts < GROK_MAX_ATTEMPTS) {
    attempts += 1;
    const messages = [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ];
    if (attempts > 1) {
      messages.push({
        role: "system",
        content: retryNote,
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? GROK_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(XAI_CHAT_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: GROK_MAX_TOKENS,
          temperature: 0.8,
          response_format: {
            type: "json_schema",
            json_schema: { name: "character_response", strict: true, schema: CHARACTER_RESPONSE_JSON_SCHEMA },
          },
        }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error)?.name === "AbortError" || controller.signal.aborted;
      return { ok: false, reason: aborted ? "timeout" : "network_error", model, attempts, latencyMs: Date.now() - started };
    }
    if (!res.ok) {
      let text = "";
      try {
        text = (await res.text()).slice(0, 2000);
      } catch {
        // an unreadable error body is classified by status alone
      }
      clearTimeout(timer);
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      return {
        ok: false,
        reason: classifyHttpFailure(res.status, text),
        status: res.status,
        model,
        attempts,
        latencyMs: Date.now() - started,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
      };
    }
    let content: unknown;
    try {
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      content = body?.choices?.[0]?.message?.content;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        return { ok: false, reason: "timeout", model, attempts, latencyMs: Date.now() - started };
      }
      content = undefined;
    } finally {
      clearTimeout(timer);
    }
    const response = parseModelReply(content);
    if (response) {
      const problem = opts.validate?.(response) ?? null;
      if (problem === null) return { ok: true, response, model, attempts, latencyMs: Date.now() - started };
      last = { ok: false, reason: "canon_check_failed", model, attempts, latencyMs: Date.now() - started };
      retryNote = `Your previous reply broke the rules: ${problem} Reply again in character with ONLY the JSON object.`;
      continue;
    }
    last = { ok: false, reason: "schema_invalid", model, attempts, latencyMs: Date.now() - started };
    retryNote = "Your previous reply was not valid. Reply again with ONLY a JSON object that matches the schema exactly.";
  }
  return last;
}

/**
 * One model call with the circuit breaker in front of it. Quota/billing failures are never retried (the single attempt
 * is all there is); an open breaker answers instantly with the failure that opened it.
 */
export async function callGrok(opts: Parameters<typeof callGrokUncached>[0]): Promise<GrokResult> {
  if (breaker && Date.now() < breaker.until) {
    const env = opts.env ?? process.env;
    return { ok: false, reason: breaker.reason, model: env.XAI_MODEL?.trim() || DEFAULT_XAI_MODEL, attempts: 0, latencyMs: 0, skipped: true, ...(breaker.status ? { status: breaker.status } : {}) };
  }
  if (breaker) breaker = null; // expired: the next call is the probe
  const r = await callGrokUncached(opts);
  if (r.ok) {
    transientStreak = 0;
    breaker = null;
    return r;
  }
  if (r.reason === "missing_key" || r.reason === "canon_check_failed") return r;
  recordFailure(r, r.retryAfterMs);
  const { retryAfterMs: _drop, ...clean } = r;
  void _drop;
  return clean;
}
