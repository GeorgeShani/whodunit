/**
 * Lies broken by testimony (harbor-light fixture): a revealed secret becomes a
 * testimony card; presenting it to another character breaks their matching
 * lies (breaksOnSecretIds / breaksOnFactIds) with the evidence stress bump.
 * Deterministic: the engine decides, the model only performs.
 */
import { createHash, createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { handleInvestigate } from "@/engine/investigate-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { planTurn, STRESS_RULES } from "@/engine/interrogation";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { brokenLieIds, isLieBroken, publicTestimonies, revealedSecretIds, testimonyFallback } from "@/engine/testimony";
import { IntendedLieSchema, type GameState } from "@/engine/types";
import { FIXTURES_DIR } from "../helpers/fixture";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let hl: LoadedCase;
beforeAll(async () => {
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});

const quill = () => hl.characters.find((c) => c.id === "keeper-quill")!;
/** A game where the cook has confessed both secrets (so both are testimony). */
function cookTalked(): GameState {
  const g = createInitialGameState(hl);
  g.characters["cook-marlow"].revealedSecretIds = ["marlow-secret", "marlow-saw-quill"];
  g.revealedSecretIds = ["marlow-secret", "marlow-saw-quill"];
  return g;
}

describe("isLieBroken", () => {
  const lie = (over: Record<string, unknown>) => IntendedLieSchema.parse({ id: "l", topic: "t", claim: "c", ...over });
  const c = { characters: [] as LoadedCase["characters"] };

  it("breaks on any listed condition by default", () => {
    const l = lie({ brokenByEvidenceIds: ["ev"], breaksOnSecretIds: ["s"] });
    expect(l.breakMode).toBe("any");
    expect(isLieBroken(c, l, { evidenceShownIds: [], testimonyShownIds: [] })).toBe(false);
    expect(isLieBroken(c, l, { evidenceShownIds: ["ev"], testimonyShownIds: [] })).toBe(true);
    expect(isLieBroken(c, l, { evidenceShownIds: [], testimonyShownIds: ["s"] })).toBe(true);
  });

  it('mode "all" needs every evidence, testimony and fact condition', () => {
    const l = lie({ brokenByEvidenceIds: ["ev"], breaksOnSecretIds: ["s"], breakMode: "all" });
    expect(isLieBroken(c, l, { evidenceShownIds: ["ev"], testimonyShownIds: [] })).toBe(false);
    expect(isLieBroken(c, l, { evidenceShownIds: ["ev"], testimonyShownIds: ["s"] })).toBe(true);
  });

  it("a lie with no conditions never breaks; legacy state without testimony still works", () => {
    expect(isLieBroken(c, lie({}), { evidenceShownIds: ["ev"] })).toBe(false);
    expect(isLieBroken(c, lie({ brokenByEvidenceIds: ["ev"] }), { evidenceShownIds: ["ev"] })).toBe(true);
  });

  it("breaksOnFactIds holds once a presented testimony's relatedFactIds carry the fact", () => {
    const dry = quill().intendedLies.find((l) => l.id === "quill-dry")!;
    expect(isLieBroken(hl, dry, { evidenceShownIds: [], testimonyShownIds: ["marlow-secret"] })).toBe(false);
    expect(isLieBroken(hl, dry, { evidenceShownIds: [], testimonyShownIds: ["marlow-saw-quill"] })).toBe(true);
  });
});

describe("planTurn with testimony", () => {
  it("revealing a secret alone breaks nothing: the owner of the lie must be confronted with it", () => {
    const g = cookTalked();
    expect(brokenLieIds(hl, quill(), g.characters["keeper-quill"])).toEqual([]);
  });

  it("presenting matching testimony breaks the lie(s) and bumps stress like evidence; repeats only nudge", () => {
    const g = cookTalked();
    const plan = planTurn(hl, g, "keeper-quill", { presentedTestimonyId: "marlow-saw-quill" });
    expect(plan.presentedTestimonyId).toBe("marlow-saw-quill");
    expect(plan.newlyExposedLieIds.sort()).toEqual(["quill-dry", "quill-lie"]);
    expect(plan.engineStressDelta).toBe(Math.min(2 * STRESS_RULES.lieBroken, STRESS_RULES.maxPerPresentation));
    expect(g.characters["keeper-quill"].testimonyShownIds).toEqual(["marlow-saw-quill"]);
    const again = planTurn(hl, g, "keeper-quill", { presentedTestimonyId: "marlow-saw-quill" });
    expect(again.engineStressDelta).toBe(STRESS_RULES.repeatEvidence);
    expect(again.newlyExposedLieIds).toEqual([]);
  });

  it("irrelevant testimony changes nothing but is remembered", () => {
    const g = cookTalked();
    const plan = planTurn(hl, g, "keeper-quill", { presentedTestimonyId: "marlow-secret" });
    expect(plan.exposedLieIds).toEqual([]);
    expect(plan.engineStressDelta).toBe(0);
  });

  it("refuses evidence and testimony together, and unknown testimony", () => {
    const g = cookTalked();
    expect(() => planTurn(hl, g, "keeper-quill", { presentedEvidenceId: "oil-can", presentedTestimonyId: "marlow-secret" })).toThrow();
    expect(() => planTurn(hl, g, "keeper-quill", { presentedTestimonyId: "nope" })).toThrow();
  });

  it("the broken lie shows as exposed in the owner's context, with the public summary only", () => {
    const g = cookTalked();
    planTurn(hl, g, "keeper-quill", { presentedTestimonyId: "marlow-saw-quill" });
    const ctx = buildCharacterContext({ caseData: hl, game: g }, "keeper-quill");
    expect(ctx.intendedLies.every((l) => l.status === "exposed")).toBe(true);
    expect(ctx.testimonyShown).toEqual([
      { id: "marlow-saw-quill", characterId: "cook-marlow", characterName: "Nell Marlow", summary: expect.stringContaining("soaked from the dock") },
    ]);
    expect(JSON.stringify(ctx)).not.toContain("HL_MARLOW_SAW"); // the secret's private description stays with its owner
    // Other characters were not confronted: nothing changes for them.
    expect(buildCharacterContext({ caseData: hl, game: g }, "finch").testimonyShown).toEqual([]);
  });
});

describe("testimony cards", () => {
  it("lists only revealed secrets, with the authored summary or a generic fallback", () => {
    const g = createInitialGameState(hl);
    expect(publicTestimonies(hl, g)).toEqual([]);
    g.characters.finch.revealedSecretIds = ["finch-secret"]; // legacy-style: only the per-character set
    expect(revealedSecretIds(g)).toEqual(["finch-secret"]);
    expect(publicTestimonies(hl, g)).toEqual([{ id: "finch-secret", characterId: "finch", characterName: "Pip Finch", summary: testimonyFallback("Pip Finch") }]);
    expect(JSON.stringify(publicTestimonies(hl, g))).not.toContain("HL_FINCH_SECRET");
  });
});

describe("signed state", () => {
  const resign = (token: string, mutate: (p: any) => void) => {
    const [v, body] = token.split(".");
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    mutate(p);
    const nb = Buffer.from(JSON.stringify(p)).toString("base64url");
    const key = createHash("sha256").update(TEST_ENV.GAME_STATE_SECRET).digest();
    return `${v}.${nb}.${createHmac("sha256", key).update(`${v}.${nb}`).digest("base64url")}`;
  };

  it("round-trips the case-wide revealed set and per-character testimony", () => {
    const g = cookTalked();
    planTurn(hl, g, "keeper-quill", { presentedTestimonyId: "marlow-saw-quill" });
    const r = decodeStateToken(encodeStateToken(g, TEST_ENV), hl, TEST_ENV);
    expect(r.ok && r.game.revealedSecretIds.sort()).toEqual(["marlow-saw-quill", "marlow-secret"]);
    expect(r.ok && r.game.characters["keeper-quill"].testimonyShownIds).toEqual(["marlow-saw-quill"]);
  });

  it("older tokens without the new fields decode (global set rebuilt from per-character reveals)", () => {
    const t = resign(encodeStateToken(cookTalked(), TEST_ENV), (p) => {
      delete p.revealedSecretIds;
      for (const c of Object.values<any>(p.characters)) delete c.testimonyShownIds;
    });
    const r = decodeStateToken(t, hl, TEST_ENV);
    expect(r.ok && r.game.revealedSecretIds.sort()).toEqual(["marlow-saw-quill", "marlow-secret"]);
  });

  it("rejects testimony that was never revealed, and unknown secret ids", () => {
    const base = encodeStateToken(createInitialGameState(hl), TEST_ENV);
    const t1 = resign(base, (p) => (p.characters["keeper-quill"].testimonyShownIds = ["marlow-saw-quill"]));
    expect(decodeStateToken(t1, hl, TEST_ENV)).toEqual({ ok: false, reason: "invalid_payload" });
    const t2 = resign(base, (p) => (p.revealedSecretIds = ["made-up"]));
    expect(decodeStateToken(t2, hl, TEST_ENV)).toEqual({ ok: false, reason: "invalid_payload" });
  });
});

describe("end to end through the handler (mocked model)", () => {
  const ask = (body: Record<string, unknown>, onPrompt?: (p: { system: string }) => void) =>
    handleInterrogate({ caseId: hl.id, question: "Well?", ...body }, { caseData: hl, env: TEST_ENV, onPrompt });

  it("cook confesses twice → testimony cards → presenting it to the keeper breaks his alibi", async () => {
    // Find the logbook, then show it twice: one engine reveal per exchange, in authored order.
    const found = handleInvestigate({ caseId: hl.id, locationId: "galley" }, { caseData: hl, env: TEST_ENV });
    mockGrok({ content: goodReply({ dialogue: "Alright, the rum is mine!" }) });
    const r1 = await ask({ characterId: "cook-marlow", presentedEvidenceId: "wet-logbook", stateToken: found.body.stateToken });
    expect(r1.body.testimonies?.map((t) => t.id)).toEqual(["marlow-secret"]);
    const early = await ask({ characterId: "keeper-quill", presentedTestimonyId: "marlow-saw-quill", stateToken: r1.body.stateToken });
    expect(early.status).toBe(400);
    expect(early.body.error).toBe("testimony_not_revealed");

    mockGrok({ content: goodReply({ dialogue: "And I saw the keeper come in soaking wet!" }) });
    const r2 = await ask({ characterId: "cook-marlow", presentedEvidenceId: "wet-logbook", stateToken: r1.body.stateToken });
    const cards = r2.body.testimonies ?? [];
    expect(cards.map((t) => t.id)).toEqual(["marlow-secret", "marlow-saw-quill"]);
    expect(JSON.stringify(cards)).not.toMatch(/HL_MARLOW_(SECRET|SAW)/);

    const both = await ask({ characterId: "keeper-quill", presentedEvidenceId: "oil-can", presentedTestimonyId: "marlow-saw-quill", stateToken: r2.body.stateToken });
    expect(both.body.error).toBe("present_one_item");

    let system = "";
    mockGrok({ content: goodReply({ dialogue: "She... saw that? Blast the woman.", emotion: "panicked" }) });
    const r3 = await ask({ characterId: "keeper-quill", presentedTestimonyId: "marlow-saw-quill", stateToken: r2.body.stateToken }, (p) => (system = p.system));
    expect(r3.status).toBe(200);
    expect(system).toContain("confronts you with what Nell Marlow has admitted");
    expect(system).toContain('EXPOSED (the dock): "HL_QUILL_LIE');
    expect(system).toContain('EXPOSED (his wet coat)');
    expect(system).not.toContain("MAINTAIN THIS STORY (his wet coat)");
    const d = decodeStateToken(r3.body.stateToken, hl, TEST_ENV);
    expect(d.ok && d.game.characters["keeper-quill"].stress).toBeGreaterThanOrEqual(STRESS_RULES.maxPerPresentation);
    expect(d.ok && d.game.characters["keeper-quill"].memory.at(-2)?.testimonyId).toBe("marlow-saw-quill");
  });
});
