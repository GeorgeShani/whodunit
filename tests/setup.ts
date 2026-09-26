/**
 * Global test guard: NO live model calls, ever. The real key (if present in the
 * shell) is removed, and any fetch that a test has not mocked fails loudly.
 */
import { afterEach, beforeEach, vi } from "vitest";

delete process.env.XAI_API_KEY;
delete process.env.GAME_STATE_SECRET;
delete process.env.XAI_MODEL;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Live network is disabled in tests; mock fetch explicitly.");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
