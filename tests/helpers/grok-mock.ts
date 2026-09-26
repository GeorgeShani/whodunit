/** Helpers to mock the xAI chat-completions endpoint (no live calls in tests). */
import { vi } from "vitest";

export const TEST_ENV = { XAI_API_KEY: "test-key-not-real-0123456789", GAME_STATE_SECRET: "test-state-secret-0123456789" };

export const goodReply = (over: Record<string, unknown> = {}) => ({
  dialogue: "I was in the pantry, sir, polishing the spoons.",
  emotion: "nervous",
  intensity: 0.6,
  action: "polishes a clean spoon",
  evidenceReactions: [],
  wantsToLeave: false,
  stressDelta: 3,
  trustDelta: -1,
  ...over,
});

export const chatBody = (content: unknown) => ({
  choices: [{ message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }],
});

/** Mock fetch returning each queued reply in turn (last one repeats). Records request bodies. */
export function mockGrok(...replies: Array<{ status?: number; content?: unknown }>) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(chatBody(r.content ?? goodReply())), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

/** Fetch that never resolves until aborted. */
export function mockHangingGrok() {
  const fn = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
