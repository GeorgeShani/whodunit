/** Blackwood's E10 system lines and E8 pronouns: the case's own wording, fitted to the flood canon. */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { pronounOf } from "@/engine/core-guilt";
import { SYSTEM_LINES, systemLine } from "@/engine/session";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

describe("E10: Blackwood system lines", () => {
  it("overrides every engine default with its own line of at most 300 characters", () => {
    for (const k of Object.keys(SYSTEM_LINES) as (keyof typeof SYSTEM_LINES)[]) {
      const line = systemLine(c, k);
      expect(line, k).not.toBe(SYSTEM_LINES[k]);
      expect(line.length, k).toBeLessThanOrEqual(300);
    }
  });

  it("fits the flood canon: no constable or telephone tonight, the police only come morning, no candles after 21:38", () => {
    const all = Object.values(c.systemLines ?? {}).join(" ");
    expect(all).not.toMatch(/constable|inspector|yard|telephone|phone|sealed|candle|lights? (?:are|is) out|dark/i);
    expect(systemLine(c, "caseClosed")).toMatch(/flood/i);
    expect(systemLine(c, "caseClosed")).toMatch(/morning/i);
    expect(systemLine(c, "recordDown")).toMatch(/again/i);
  });
});

describe("E8: Blackwood pronouns are data, not guessed from titles", () => {
  it("Victoria is she; Archibald, Reginald and Gregory are he", () => {
    const want: Record<string, string> = { victoria: "she", archibald: "he", reginald: "he", gregory: "he" };
    for (const ch of c.characters) {
      expect((ch as { pronoun?: string }).pronoun, ch.id).toBe(want[ch.id]);
      expect(pronounOf(ch), ch.id).toBe(want[ch.id]);
    }
  });
});
