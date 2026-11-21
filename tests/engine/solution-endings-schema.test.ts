/**
 * CaseSolutionSchema accepts an optional `endings` field (same shape as #119)
 * so the old env payload and the new Blackwood payload both parse. Failures
 * from parseSolutionEnv never include the value or parser details.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CaseSolutionSchema, parseSolutionEnv } from "@/engine/solution";

const OLD = {
  murdererId: "alpha",
  weaponId: "heavy-wrench",
  locationId: "workshop",
  time: "21:00",
  motiveId: "partnership-dispute",
  keyEvidenceIds: ["note"],
};

const NEW = {
  ...OLD,
  endings: {
    correct: {
      confession: [{ speaker: "alpha", text: "Fine." }],
      recap: [{ speaker: "narrator", text: "Done." }],
    },
    wrong: { alpha: [{ speaker: "alpha", text: "You have not proved it." }] },
  },
};

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64");

describe("CaseSolutionSchema: optional endings", () => {
  it("parses the old shape (no endings field)", () => {
    expect(CaseSolutionSchema.safeParse(OLD).success).toBe(true);
    const env = parseSolutionEnv(b64(OLD));
    expect(env.ok).toBe(true);
    if (env.ok) expect(env.solution.endings).toBeUndefined();
  });

  it("parses the new shape (optional endings, same as #119)", () => {
    expect(CaseSolutionSchema.safeParse(NEW).success).toBe(true);
    const env = parseSolutionEnv(b64(NEW));
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.solution.endings?.correct.confession[0].speaker).toBe("alpha");
      expect(env.solution.endings?.wrong?.alpha[0].speaker).toBe("alpha");
    }
  });

  it.skipIf(!existsSync("cases/blackwood/solution.json"))(
    "parses the 5643-byte Blackwood payload (sha prefix 0f4eea49a923b598)",
    () => {
      const raw = readFileSync("cases/blackwood/solution.json");
      expect(raw.length).toBe(5643);
      expect(createHash("sha256").update(raw).digest("hex").startsWith("0f4eea49a923b598")).toBe(true);
      expect(CaseSolutionSchema.safeParse(JSON.parse(raw.toString("utf8"))).success).toBe(true);
      expect(parseSolutionEnv(raw.toString("base64")).ok).toBe(true);
      // The same payload without `endings` (old shape) still parses.
      const stripped = { ...(JSON.parse(raw.toString("utf8")) as Record<string, unknown>) };
      delete stripped.endings;
      expect(CaseSolutionSchema.safeParse(stripped).success).toBe(true);
    },
  );

  it("parse failures are only { ok: false, reason } and say nothing technical", () => {
    const garbage = "not-base64-and-SECRET_PAYLOAD_ZX7-%%";
    const r = parseSolutionEnv(garbage);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(Object.keys(r).sort()).toEqual(["ok", "reason"]);
    const text = JSON.stringify(r);
    expect(text).not.toContain(garbage);
    expect(text).not.toMatch(/Zod|invalid_type|expected|required|JSON\.parse|Unexpected|base64|stack|at /i);

    const incomplete = b64({ murdererId: "alpha" });
    const r2 = parseSolutionEnv(incomplete);
    expect(r2).toEqual({ ok: false, reason: "invalid" });
    const text2 = JSON.stringify(r2);
    expect(text2).not.toMatch(/Zod|invalid_type|expected|required|weaponId|murdererId|path/i);
  });
});
