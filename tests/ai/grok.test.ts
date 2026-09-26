import { describe, expect, it } from "vitest";
import { callGrok, DEFAULT_XAI_MODEL, GROK_MAX_TOKENS, parseModelReply, XAI_CHAT_URL } from "@/ai/grok";
import { goodReply, mockGrok, mockHangingGrok, TEST_ENV } from "../helpers/grok-mock";

const prompt = { system: "SYS", user: "USER" };

describe("callGrok", () => {
  it("returns missing_key without any network call when XAI_API_KEY is absent", async () => {
    const { fn } = mockGrok({});
    const r = await callGrok({ ...prompt, env: {} });
    expect(r).toMatchObject({ ok: false, reason: "missing_key", attempts: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("sends a structured-output request to xAI with low max_tokens and returns a validated reply", async () => {
    const { calls } = mockGrok({ content: goodReply() });
    const r = await callGrok({ ...prompt, env: TEST_ENV });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(XAI_CHAT_URL);
    expect(calls[0].body.model).toBe(DEFAULT_XAI_MODEL);
    expect(calls[0].body.max_tokens).toBe(GROK_MAX_TOKENS);
    expect(calls[0].body.response_format.type).toBe("json_schema");
    // The key only travels in the Authorization header, never in the body.
    expect(JSON.stringify(calls[0].body)).not.toContain(TEST_ENV.XAI_API_KEY);
  });

  it("honours XAI_MODEL", async () => {
    const { calls } = mockGrok({});
    await callGrok({ ...prompt, env: { ...TEST_ENV, XAI_MODEL: "grok-test" } });
    expect(calls[0].body.model).toBe("grok-test");
  });

  it("retries ONCE on a malformed reply, then succeeds", async () => {
    const { calls } = mockGrok({ content: "not json {" }, { content: goodReply() });
    const r = await callGrok({ ...prompt, env: TEST_ENV });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["non-JSON text", "Sure! Here is my answer."],
    ["unknown emotion", JSON.stringify(goodReply({ emotion: "hangry" }))],
    ["extra decision field", JSON.stringify(goodReply({ murdererId: "victoria" }))],
    ["empty dialogue", JSON.stringify(goodReply({ dialogue: "  " }))],
    ["array", "[]"],
  ])("rejects %s and gives up after exactly 2 attempts", async (_l, content) => {
    const { calls } = mockGrok({ content });
    const r = await callGrok({ ...prompt, env: TEST_ENV });
    expect(r).toMatchObject({ ok: false, reason: "schema_invalid", attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it("does not retry HTTP errors", async () => {
    const { calls } = mockGrok({ status: 500, content: "oops" });
    const r = await callGrok({ ...prompt, env: TEST_ENV });
    expect(r).toMatchObject({ ok: false, reason: "http_error", status: 500, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it("times out via AbortController", async () => {
    mockHangingGrok();
    const r = await callGrok({ ...prompt, env: TEST_ENV, timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, reason: "timeout", attempts: 1 });
  });

  it("reports network errors", async () => {
    // default test fetch throws
    const r = await callGrok({ ...prompt, env: TEST_ENV });
    expect(r).toMatchObject({ ok: false, reason: "network_error" });
  });
});

describe("parseModelReply", () => {
  it("accepts fenced JSON and drops an empty action", () => {
    const r = parseModelReply("```json\n" + JSON.stringify(goodReply({ action: "" })) + "\n```");
    expect(r?.action).toBeUndefined();
  });
  it("rejects non-strings", () => {
    expect(parseModelReply(undefined)).toBeNull();
    expect(parseModelReply({})).toBeNull();
  });
});
