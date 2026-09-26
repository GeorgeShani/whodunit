import { describe, expect, it } from "vitest";
import { secretsToReveal, shouldRevealSecret } from "@/engine/secrets";
import { SecretSchema, type Secret } from "@/engine/types";

const secret = (revealConditions?: object, id = "s1"): Secret =>
  SecretSchema.parse({ id, description: "d", severity: "serious", ...(revealConditions ? { revealConditions } : {}) });
const state = (over: Partial<{ stress: number; evidenceShownIds: string[]; revealedSecretIds: string[] }> = {}) => ({
  stress: 0,
  evidenceShownIds: [],
  revealedSecretIds: [],
  ...over,
});

describe("shouldRevealSecret", () => {
  it("never auto-reveals a secret without conditions", () => {
    expect(shouldRevealSecret(secret(), state({ stress: 100, evidenceShownIds: ["x"] }))).toBe(false);
  });

  it("stays revealed once revealed", () => {
    expect(shouldRevealSecret(secret(), state({ revealedSecretIds: ["s1"] }))).toBe(true);
  });

  it("reveals at or above the stress threshold", () => {
    const s = secret({ stressThreshold: 70 });
    expect(shouldRevealSecret(s, state({ stress: 69 }))).toBe(false);
    expect(shouldRevealSecret(s, state({ stress: 70 }))).toBe(true);
  });

  it('mode "any": stress OR any listed evidence', () => {
    const s = secret({ stressThreshold: 80, evidenceIds: ["boots", "letter"], mode: "any" });
    expect(shouldRevealSecret(s, state({ stress: 10 }))).toBe(false);
    expect(shouldRevealSecret(s, state({ evidenceShownIds: ["letter"] }))).toBe(true);
    expect(shouldRevealSecret(s, state({ stress: 85 }))).toBe(true);
  });

  it('mode "all": stress AND every listed evidence', () => {
    const s = secret({ stressThreshold: 50, evidenceIds: ["boots", "letter"], mode: "all" });
    expect(shouldRevealSecret(s, state({ stress: 90, evidenceShownIds: ["boots"] }))).toBe(false);
    expect(shouldRevealSecret(s, state({ stress: 40, evidenceShownIds: ["boots", "letter"] }))).toBe(false);
    expect(shouldRevealSecret(s, state({ stress: 50, evidenceShownIds: ["letter", "boots"] }))).toBe(true);
  });

  it("respects afterSecretIds ordering prerequisites", () => {
    const s = secret({ evidenceIds: ["boots"], afterSecretIds: ["footprint"] });
    expect(shouldRevealSecret(s, state({ evidenceShownIds: ["boots"] }))).toBe(false);
    expect(shouldRevealSecret(s, state({ evidenceShownIds: ["boots"], revealedSecretIds: ["footprint"] }))).toBe(true);
  });

  it("secretsToReveal lists only newly revealable secrets", () => {
    const secrets = [secret({ stressThreshold: 30 }, "a"), secret({ stressThreshold: 90 }, "b"), secret(undefined, "c"), secret({ stressThreshold: 10 }, "d")];
    expect(secretsToReveal(secrets, state({ stress: 40, revealedSecretIds: ["d"] }))).toEqual(["a"]);
  });
});
