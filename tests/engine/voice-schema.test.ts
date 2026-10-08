/** #52 optional per-character `voice` (openers, actions, deflections): schema defaults, limits and validator warnings. */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences, checkCaseWarnings } from "@/engine/case-validation";
import { CharacterSchema, VoiceSchema } from "@/engine/types";
import { FIXTURES_DIR } from "../helpers/fixture";

let hl: LoadedCase;
let bw: LoadedCase;
beforeAll(async () => {
  hl = await loadCase("harbor-light", FIXTURES_DIR);
  bw = await loadCase("blackwood");
});

describe("voice schema", () => {
  it("is optional and defaults to three empty lists", () => {
    expect(VoiceSchema.parse({})).toEqual({ openers: [], actions: [], deflections: [] });
    expect(hl.characters.find((c) => c.id === "finch")!.voice).toEqual({ openers: [], actions: [], deflections: [] });
    for (const ch of bw.characters) expect(ch.voice).toBeDefined();
    expect(CharacterSchema.shape.voice).toBeDefined();
  });
  it("loads authored variants (fixture case)", () => {
    const q = hl.characters.find((c) => c.id === "keeper-quill")!;
    expect(q.voice.openers).toContain("Aye, Inspector,");
    expect(q.voice.actions.length).toBe(4);
    expect(q.voice.deflections.length).toBe(3);
  });
  it("rejects empty or over-long entries, more than 16 variants and unknown keys", () => {
    expect(VoiceSchema.safeParse({ openers: [""] }).success).toBe(false);
    expect(VoiceSchema.safeParse({ openers: ["   "] }).success).toBe(false);
    expect(VoiceSchema.safeParse({ actions: ["x".repeat(161)] }).success).toBe(false);
    expect(VoiceSchema.safeParse({ deflections: Array.from({ length: 17 }, (_, i) => `line ${i}`) }).success).toBe(false);
    expect(VoiceSchema.safeParse({ tics: ["W-well"] }).success).toBe(false);
    expect(VoiceSchema.safeParse({ openers: "My dear" }).success).toBe(false);
  });
  it("trims entries", () => {
    expect(VoiceSchema.parse({ openers: ["  Now then,  "] }).openers).toEqual(["Now then,"]);
  });
});

describe("voice validator warnings", () => {
  const warn = (c: LoadedCase) => checkCaseWarnings(c).filter((w) => (w.path ?? "").startsWith("voice"));
  it("the fixture and Blackwood are clean, and voice adds no reference errors", () => {
    expect(warn(hl)).toEqual([]);
    expect(warn(bw)).toEqual([]);
    expect(checkCaseReferences(hl).filter((i) => (i.path ?? "").startsWith("voice"))).toEqual([]);
  });
  it("warns on a duplicate (ignoring case and punctuation), a single variant, and a long opener", () => {
    const bad = structuredClone(hl);
    const q = bad.characters.find((c) => c.id === "keeper-quill")!;
    q.voice.openers.push("aye inspector");
    q.voice.openers.push("Well now, Inspector, if you really must ask me,");
    bad.characters.find((c) => c.id === "finch")!.voice.actions = ["scratches his head"];
    const w = warn(bad).map((x) => `${x.path}: ${x.message}`);
    expect(w.some((x) => /voice\.openers\.4: duplicates voice\.openers\.0/.test(x))).toBe(true);
    expect(w.some((x) => /voice\.actions: a single variant/.test(x))).toBe(true);
    expect(w.some((x) => /voice\.openers\.5: .*longer than 6 words/.test(x))).toBe(true);
  });
});
