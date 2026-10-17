/**
 * Phase 6 (case-two plan 4.1-4.3, 3.3, 3.4): the feature-module framework (loader contract, registry hooks, public
 * slices) and its two modules, `time-misdirection` and `ship-list`, on in-memory Blackwood variants. Offline.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply } from "@/ai/guard";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences } from "@/engine/case-validation";
import { checkFeatureConfig, clueFeatures, featureCanonCheck, featureWarnings, publicFeatures } from "@/engine/features/registry";
import { createInitialGameState } from "@/engine/game-state";
import { getPublicCaseView } from "@/engine/public-view";

let bw: LoadedCase;
beforeAll(async () => {
  bw = await loadCase("blackwood");
});
const paths = (issues: { path?: string }[]) => issues.map((i) => i.path ?? "");
/** time-misdirection's proof (the key clue proving the true time) lives in the SOLUTION, never in case.json. */
const PROOF = () => ({ "time-misdirection": { provedBy: [bw.solution.keyEvidenceIds[0]] } });
const withFeatures = (features: string[], featureConfig: Record<string, unknown>, featureProof?: Record<string, unknown>): LoadedCase => {
  const c: LoadedCase = { ...structuredClone(bw), features, featureConfig };
  const proof = featureProof ?? (features.includes("time-misdirection") ? PROOF() : undefined);
  if (proof) c.solution = { ...c.solution, featureProof: proof };
  return c;
};

const TM = () => ({
  stagedClaims: [{ time: "22:41", kind: "death", factIds: [bw.timeline[0].id], evidenceIds: [bw.evidence[0].id] }],
  appearanceWords: ["watch", "clock", "read", "showed", "stopped"],
});
const SL = () => ({
  history: [
    { from: "20:00", list: "starboard", degrees: 6 },
    { from: "21:40", list: "port", degrees: 4 },
  ],
  flipShownBy: "library-key",
  diagrams: [
    {
      evidenceId: "burned-letter",
      frames: [
        { label: "Before", image: "/assets/evidence/x_before.webp" },
        { label: "After", image: "/assets/evidence/x_after.webp" },
      ],
    },
  ],
  locationTilt: { library: { asFound: "port" } },
});

describe("feature framework: loader contract (4.1)", () => {
  it("a case without features is untouched: no issues, no public slices, no clue extras", () => {
    expect(checkFeatureConfig(bw)).toEqual([]);
    expect(publicFeatures(bw)).toBeUndefined();
    const view = getPublicCaseView(bw, { discoveredEvidenceIds: bw.evidence.map((e) => e.id) });
    expect(view.features).toBeUndefined();
    expect(view.evidence.every((e) => e.features === undefined)).toBe(true);
  });
  it("unknown, undeclared, config-less and malformed features are errors", () => {
    expect(paths(checkFeatureConfig(withFeatures(["no-such-thing"], {})))).toEqual(["features.0"]);
    expect(paths(checkFeatureConfig(withFeatures(["ship-list"], {})))).toEqual(["featureConfig.ship-list"]);
    expect(paths(checkFeatureConfig(withFeatures([], { "ship-list": SL() })))).toEqual(["featureConfig.ship-list"]);
    expect(paths(checkFeatureConfig(withFeatures(["ship-list"], { "ship-list": { ...SL(), history: [] } })))).toContain("featureConfig.ship-list.history");
    expect(paths(checkFeatureConfig(withFeatures(["ship-list", "ship-list"], { "ship-list": SL() })))).toContain("features.1");
    // The errors reach the loader's reference check.
    expect(paths(checkCaseReferences(withFeatures(["no-such-thing"], {})))).toContain("features.0");
  });
});

describe("time-misdirection (3.3)", () => {
  it("a well-formed config validates", () => {
    const c = withFeatures(["time-misdirection"], { "time-misdirection": TM() });
    // proof-of-when: the key clue points at a fact holding the murder minute
    const ok = checkFeatureConfig(c).filter((i) => i.path !== "featureProof.time-misdirection.provedBy");
    expect(ok).toEqual([]);
  });
  it("rejects a staged time inside the opportunity window, unknown ids, non-key proofs and an unproved true time", () => {
    const cfg = {
      ...TM(),
      stagedClaims: [{ time: bw.solution.time, kind: "death", factIds: ["f-nope"], evidenceIds: ["e-nope"] }],
    };
    const c = withFeatures(["time-misdirection"], { "time-misdirection": cfg }, { "time-misdirection": { provedBy: ["muddy-footprint"] } });
    c.evidence.find((e) => e.id === "muddy-footprint")!.relatedFactIds = [];
    expect(paths(checkFeatureConfig(c))).toEqual(
      expect.arrayContaining([
        "featureConfig.time-misdirection.stagedClaims.0.time",
        "featureConfig.time-misdirection.stagedClaims.0.factIds.0",
        "featureConfig.time-misdirection.stagedClaims.0.evidenceIds.0",
        "featureProof.time-misdirection.provedBy.0",
        "featureProof.time-misdirection.provedBy",
      ]),
    );
  });
  it("provedBy is solution data: an error in case.json, required in solution.json featureProof, never public (V18)", () => {
    const key = bw.solution.keyEvidenceIds[0];
    // (Blackwood's first key clue does not prove the time, so its proof-of-when error is filtered here.)
    const inCase = checkFeatureConfig(withFeatures(["time-misdirection"], { "time-misdirection": { ...TM(), provedBy: [key] } })).filter(
      (i) => i.path !== "featureProof.time-misdirection.provedBy",
    );
    expect(inCase.map((i) => [i.file, i.path])).toEqual([["case.json", "featureConfig.time-misdirection.provedBy"]]);
    expect(inCase[0].message).toMatch(/solution\.json featureProof\.time-misdirection\.provedBy/);
    expect(paths(checkCaseReferences(withFeatures(["time-misdirection"], { "time-misdirection": { ...TM(), provedBy: [key] } })))).toContain(
      "featureConfig.time-misdirection.provedBy",
    );
    const missing = checkFeatureConfig(withFeatures(["time-misdirection"], { "time-misdirection": TM() }, {}));
    expect(missing.map((i) => [i.file, i.path])).toEqual([["solution.json", "featureProof.time-misdirection"]]);
    expect(paths(checkFeatureConfig(withFeatures(["time-misdirection"], { "time-misdirection": TM() }, { "time-misdirection": { provedBy: [] } })))).toEqual([
      "featureProof.time-misdirection.provedBy",
    ]);
    // A proof for an undeclared feature, or for a module that takes none, is an error.
    expect(paths(checkFeatureConfig(withFeatures([], {}, { "time-misdirection": { provedBy: [key] } })))).toEqual(["featureProof.time-misdirection"]);
    expect(paths(checkFeatureConfig(withFeatures(["ship-list"], { "ship-list": SL() }, { "ship-list": { provedBy: [key] } })))).toEqual([
      "featureProof.ship-list",
    ]);
    // The client never sees the proof: no featureProof in the case view or the public slices.
    const c = withFeatures(["time-misdirection", "ship-list"], { "time-misdirection": TM(), "ship-list": SL() });
    const view = JSON.stringify(getPublicCaseView(c, { discoveredEvidenceIds: c.evidence.map((e) => e.id) }));
    expect(view).not.toContain("featureProof");
    expect(view).not.toContain("provedBy");
    expect(JSON.stringify(publicFeatures(c) ?? {})).not.toContain(key);
  });
  it("warns about the alibi shape (data-driven, from located timeline entries)", () => {
    const w = featureWarnings(withFeatures(["time-misdirection"], { "time-misdirection": TM() }));
    expect(w.every((i) => (i.path ?? "").startsWith("featureConfig.time-misdirection"))).toBe(true);
  });
  it("canon check: a staged time stated as fact is rejected; framed as what something showed, or asked, it passes", () => {
    const c = withFeatures(["time-misdirection"], { "time-misdirection": TM() });
    const line = (said: string, maintainedStories: string[] = []) => featureCanonCheck(c, { said, characterId: "gregory", maintainedStories });
    expect(line("He died at 22:41, I'm certain of it.")?.detail).toMatch(/^staged:22:41/);
    expect(line("He was killed at twenty-two forty-one.")).not.toBeNull();
    expect(line("The watch read 22:41 when we found him.")).toBeNull();
    expect(line("Did he die at 22:41?")).toBeNull();
    expect(line("He died at 22:41.", ["I saw him alive until he died at 22:41."])).toBeNull(); // the speaker's own maintained story
    expect(line("I went to bed at 22:41.")).toBeNull(); // no death assertion
  });
  it("the guard rejects it as staged_time (a canon failure, retried then the engine's fallback)", () => {
    const c = withFeatures(["time-misdirection"], { "time-misdirection": TM() });
    const ch = c.characters.find((x) => x.id !== c.solution.murdererId)!;
    c.timeline.push({
      ...structuredClone(c.timeline[0]),
      id: "ev-test-watch",
      time: "22:41",
      from: undefined,
      to: undefined,
      statement: "At 22:41 the hall clock stops.",
      involvesCharacterIds: [ch.id],
    } as never);
    ch.knownFactIds.push("ev-test-watch");
    const guard = prepareTurn({ caseData: c, game: createInitialGameState(c), characterId: ch.id, question: "When did he die?" }).guard;
    expect(checkReply({ dialogue: "He died at 22:41, that much is certain.", admits: [] }, guard)?.reason).toBe("staged_time");
    expect(checkReply({ dialogue: "The clock stopped at 22:41, I believe.", admits: [] }, guard)?.reason).not.toBe("staged_time");
  });
});

describe("ship-list (3.4)", () => {
  it("validates order, the flip after the murder, and that a diagram clue requires the flip clue", () => {
    expect(checkFeatureConfig(withFeatures(["ship-list"], { "ship-list": SL() }))).toEqual([]);
    const bad = {
      ...SL(),
      history: [
        { from: "21:40", list: "port", degrees: 4 },
        { from: "20:00", list: "starboard", degrees: 6 },
      ],
      diagrams: [{ ...SL().diagrams[0], evidenceId: "muddy-footprint" }],
    };
    expect(paths(checkFeatureConfig(withFeatures(["ship-list"], { "ship-list": bad })))).toEqual(
      expect.arrayContaining(["featureConfig.ship-list.history.1.from", "featureConfig.ship-list.history", "featureConfig.ship-list.diagrams.0.evidenceId"]),
    );
    // With time-misdirection declared, the flip must also come before the staged death time.
    const both = withFeatures(["ship-list", "time-misdirection"], {
      "ship-list": {
        ...SL(),
        history: [
          { from: "20:00", list: "starboard", degrees: 6 },
          { from: "23:00", list: "port", degrees: 4 },
        ],
      },
      "time-misdirection": TM(),
    });
    expect(checkFeatureConfig(both).some((i) => i.path === "featureConfig.ship-list.history" && /22:41/.test(i.message))).toBe(true);
    expect(
      paths(
        checkFeatureConfig(
          withFeatures(["ship-list"], {
            "ship-list": {
              ...SL(),
              diagrams: [
                {
                  ...SL().diagrams[0],
                  frames: [
                    { label: "a", image: "javascript:x" },
                    { label: "b", image: "/assets/b.webp" },
                  ],
                },
              ],
            },
          }),
        ),
      ),
    ).toContain("featureConfig.ship-list.diagrams.0.frames.0.image");
  });
  it("public slices: room tilts in the case view; frames only with the found diagram clue", () => {
    const c = withFeatures(["ship-list"], { "ship-list": SL() });
    expect(publicFeatures(c)).toEqual({ "ship-list": { locationTilt: { library: -4 } } });
    expect(clueFeatures(c, "burned-letter")).toEqual({ "ship-list": { frames: SL().diagrams[0].frames } });
    expect(clueFeatures(c, "library-key")).toBeUndefined();
    const before = getPublicCaseView(c, { discoveredEvidenceIds: [] });
    expect(JSON.stringify(before)).not.toContain("x_before");
    const after = getPublicCaseView(c, { discoveredEvidenceIds: ["burned-letter"] });
    expect(after.evidence.find((e) => e.id === "burned-letter")?.features).toEqual({ "ship-list": { frames: SL().diagrams[0].frames } });
    expect(JSON.stringify(after)).not.toContain('"history"');
  });
});
