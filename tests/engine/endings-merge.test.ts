import { describe, expect, it } from "vitest";
import { mergeEndings, type PublicEndings, type SecretEndings } from "@/engine/endings";

const line = (speaker: string, text: string) => ({ speaker, text });

describe("mergeEndings", () => {
  it("overlays secret correct and wrong entries onto the public file", () => {
    const file: PublicEndings = {
      wrong: { bravo: [line("bravo", "Not me.")] },
      escapedLine: "ESCAPED!",
    };
    const secret: SecretEndings = {
      correct: { confession: [line("alpha", "Fine.")], recap: [line("narrator", "Done.")] },
      wrong: { alpha: [line("alpha", "You haven't proved it.")] },
    };
    const merged = mergeEndings(file, secret);
    expect(merged?.correct?.confession[0].text).toBe("Fine.");
    expect(Object.keys(merged?.wrong ?? {}).sort()).toEqual(["alpha", "bravo"]);
    expect(merged?.escapedLine).toBe("ESCAPED!");
  });

  it("lets the solution win when both supply the same wrong key", () => {
    const file: PublicEndings = { wrong: { alpha: [line("alpha", "from file")] } };
    const secret: SecretEndings = {
      correct: { confession: [line("alpha", "x")], recap: [line("narrator", "y")] },
      wrong: { alpha: [line("alpha", "from solution")] },
    };
    expect(mergeEndings(file, secret)?.wrong?.alpha[0].text).toBe("from solution");
  });

  it("is undefined when both sides are empty", () => {
    expect(mergeEndings(undefined, undefined)).toBeUndefined();
  });
});
