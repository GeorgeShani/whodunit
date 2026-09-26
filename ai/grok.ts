/**
 * SERVER-ONLY. Minimal xAI (Grok) chat-completions client: plain fetch,
 * structured JSON output, hard timeout, Zod validation, one retry on schema
 * failure only. Never logs or returns the API key, the prompt, or raw output.
 */
import { CharacterResponseSchema, type CharacterResponse } from "./schemas";
import { CHARACTER_RESPONSE_JSON_SCHEMA } from "./prompts/interrogation";

type Env = Record<string, string | undefined>;

export const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
/** Fast non-reasoning Grok; override with XAI_MODEL. */
export const DEFAULT_XAI_MODEL = "grok-4.20-0309-non-reasoning";
export const GROK_TIMEOUT_MS = 12_000;
export const GROK_MAX_TOKENS = 400;
/** Total attempts: the first call plus at most one retry, and only after a schema failure. */
export const GROK_MAX_ATTEMPTS = 2;

export type GrokFailure = "missing_key" | "timeout" | "http_error" | "network_error" | "schema_invalid";

export type GrokResult =
  | { ok: true; response: CharacterResponse; model: string; attempts: number; latencyMs: number }
  | { ok: false; reason: GrokFailure; model: string; attempts: number; latencyMs: number; status?: number };

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
  }
  const parsed = CharacterResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function callGrok(opts: {
  system: string;
  user: string;
  env?: Env;
  timeoutMs?: number;
}): Promise<GrokResult> {
  const env = opts.env ?? process.env;
  const model = env.XAI_MODEL?.trim() || DEFAULT_XAI_MODEL;
  const started = Date.now();
  const key = env.XAI_API_KEY;
  if (!key) return { ok: false, reason: "missing_key", model, attempts: 0, latencyMs: 0 };

  let attempts = 0;
  let last: GrokResult = { ok: false, reason: "schema_invalid", model, attempts, latencyMs: 0 };
  while (attempts < GROK_MAX_ATTEMPTS) {
    attempts += 1;
    const messages = [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ];
    if (attempts > 1) {
      messages.push({
        role: "system",
        content: "Your previous reply was not valid. Reply again with ONLY a JSON object that matches the schema exactly.",
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
      clearTimeout(timer);
      return { ok: false, reason: "http_error", status: res.status, model, attempts, latencyMs: Date.now() - started };
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
    if (response) return { ok: true, response, model, attempts, latencyMs: Date.now() - started };
    last = { ok: false, reason: "schema_invalid", model, attempts, latencyMs: Date.now() - started };
  }
  return last;
}
