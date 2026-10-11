/** E2: citation grading. "Supports" is data (key + supporting ids); a sloppy citation keeps the win but rates it. */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { AccuseScreen } from "@/components/accuse/AccuseScreen";
import { validateAccusationDraft } from "@/engine/accuse-schema";
import { handleAccuse } from "@/engine/accuse-handler";
import { citeCaps, gradeAccusation } from "@/engine/accusation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences } from "@/engine/case-validation";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { DEFAULT_SLOPPY_REMARK } from "@/engine/ending-payload";
import { createInitialGameState } from "@/engine/game-state";
import { getPublicCaseView } from "@/engine/public-view";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { memoryClosedGames } from "@/lib/closed-games";
import { TEST_ENV } from "../helpers/grok-mock";

const PLACEHOLDER = "Case closed, detective, though a few of those exhibits had no business in the evidence bag.";
let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

/** Gate-open token, built generically: every clue, every secret, everyone questioned. */
function readyToken(cs: LoadedCase = c): string {
  const g = createInitialGameState(cs);
  g.discoveredEvidenceIds.push(...cs.evidence.map((e) => e.id));
  for (const ch of cs.characters) {
    g.characters[ch.id].interrogationCount = 5;
    for (const s of ch.secrets) {
      g.characters[ch.id].revealedSecretIds.push(s.id);
      g.revealedSecretIds.push(s.id);
    }
  }
  return encodeStateToken(g, TEST_ENV);
}
const sol = () => c.solution;
/** The minimal clean winning accusation, from data. */
const cleanWin = () => ({
  murdererId: sol().murdererId,
  weaponId: sol().weaponId,
  motiveId: sol().motiveId,
  keyEvidenceIds: sol().keyEvidenceIds.slice(0, sol().minKeyEvidence ?? 1),
  ...((sol().minKeyTestimony ?? 0) > 0 ? { keyTestimonyIds: sol().keyTestimonyIds!.slice(0, sol().minKeyTestimony) } : {}),
});
/** A found clue that supports nothing (a red herring): not key, not supporting, not the weapon-only pick. */
const redHerring = () => c.evidence.map((e) => e.id).find((id) => !sol().keyEvidenceIds.includes(id) && !(sol().supportingEvidenceIds ?? []).includes(id))!;
/** A revealed secret that supports nothing (not key, not supporting, not core guilt). */
const strayTestimony = () => {
  const core = coreGuiltSecretIds(c);
  return c.characters.flatMap((ch) => ch.secrets.map((s) => s.id)).find((id) => !core.has(id) && !(sol().keyTestimonyIds ?? []).includes(id) && !(sol().supportingTestimonyIds ?? []).includes(id))!;
};
const accuse = (accusation: Record<string, unknown>, cs: LoadedCase = c, repo = memoryClosedGames()) =>
  handleAccuse({ accusation, stateToken: readyToken(cs) }, { caseData: cs, env: TEST_ENV, closed: repo }).then((r) => ({ ...r, repo }));
const texts = (b: { ending?: { beats: { text: string; section: string }[] } }) => b.ending!.beats.map((x) => `${x.section}:${x.text}`);

describe("E2 grading", () => {
  it("clean win: rating clean, no remark, the full win ending and the solution reveal", async () => {
    const r = await accuse(cleanWin());
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("won");
    expect(r.body.rating).toBe("clean");
    expect(r.body.solution).toBeDefined();
    expect(r.body.ending!.beats.some((b) => b.section === "remark")).toBe(false);
  });

  it("sloppy win from a red-herring clue: still won, same ending + reveal, rating sloppy, Blackwood's remark last", async () => {
    const clean = await accuse(cleanWin());
    const r = await accuse({ ...cleanWin(), keyEvidenceIds: [...cleanWin().keyEvidenceIds, redHerring()] });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("won");
    expect(r.body.rating).toBe("sloppy");
    expect(r.body.solution).toEqual(clean.body.solution);
    expect(texts(r.body)).toEqual([...texts(clean.body), `remark:${PLACEHOLDER}`]);
    expect([...r.repo.rows.values()][0]).toMatchObject({ outcome: "won" }); // the DB keeps won/lost only
  });

  it("sloppy win from testimony that supports nothing", async () => {
    const w = cleanWin();
    const r = await accuse({ ...w, keyTestimonyIds: [...(w.keyTestimonyIds ?? []), strayTestimony()] });
    expect(r.body.outcome).toBe("won");
    expect(r.body.rating).toBe("sloppy");
    expect(r.body.ending!.beats.at(-1)).toMatchObject({ section: "remark", text: PLACEHOLDER });
  });

  it("supportingEvidenceIds / supportingTestimonyIds make those citations clean", async () => {
    const cs: LoadedCase = { ...c, solution: { ...c.solution, supportingEvidenceIds: [redHerring()], supportingTestimonyIds: [strayTestimony()] } };
    const w = cleanWin();
    const r = await accuse({ ...w, keyEvidenceIds: [...w.keyEvidenceIds, redHerring()], keyTestimonyIds: [...(w.keyTestimonyIds ?? []), strayTestimony()] }, cs);
    expect(r.body.rating).toBe("clean");
  });

  it("a red herring counts as sloppy even when the key minimum is met (pure grader)", () => {
    const g = gradeAccusation(sol(), { ...cleanWin(), keyEvidenceIds: [...cleanWin().keyEvidenceIds, redHerring()] });
    expect(g.won).toBe(true);
    expect(g.rating).toBe("sloppy");
    expect(g.unsupportedCited).toEqual([redHerring()]);
  });

  it("right person, wrong story: the authored wrong ending is unchanged; only the rating and the remark are added", async () => {
    const wrongMotive = c.motives.find((m) => m.id !== sol().motiveId)!.id;
    const base = { ...cleanWin(), motiveId: wrongMotive };
    const clean = await accuse(base);
    const sloppy = await accuse({ ...base, keyEvidenceIds: [...base.keyEvidenceIds, redHerring()] });
    expect(clean.body.outcome).toBe("lost");
    expect(clean.body.rating).toBe("clean");
    expect(sloppy.body.outcome).toBe("lost");
    expect(sloppy.body.rating).toBe("sloppy");
    expect(sloppy.body.solution).toBeUndefined();
    const authored = c.endings!.wrong[sol().murdererId]!.map((l) => `wrong:${l.text}`);
    expect(texts(clean.body).slice(0, authored.length)).toEqual(authored);
    const t = texts(sloppy.body);
    expect(t.slice(0, authored.length)).toEqual(authored);
    expect(t[authored.length]).toBe(`remark:${PLACEHOLDER}`);
    expect(t.filter((x) => !x.startsWith("remark:"))).toEqual(texts(clean.body));
  });

  it("a wrong accusation: extra citations change nothing (no rating, same ending)", async () => {
    const innocent = c.characters.find((ch) => ch.id !== sol().murdererId)!.id;
    const base = { ...cleanWin(), murdererId: innocent };
    const a = await accuse(base);
    const b = await accuse({ ...base, keyEvidenceIds: [...base.keyEvidenceIds, redHerring()] });
    expect(a.body.outcome).toBe("lost");
    expect(b.body.outcome).toBe("lost");
    expect(a.body.rating).toBeUndefined();
    expect(b.body.rating).toBeUndefined();
    expect(texts(b.body)).toEqual(texts(a.body));
  });

  it("no authored sloppyRemark: the generic line plays", async () => {
    const cs: LoadedCase = { ...c, endings: { ...c.endings!, sloppyRemark: undefined } };
    const r = await accuse({ ...cleanWin(), keyEvidenceIds: [...cleanWin().keyEvidenceIds, redHerring()] }, cs);
    expect(r.body.ending!.beats.at(-1)).toMatchObject({ section: "remark", speaker: "narrator", text: DEFAULT_SLOPPY_REMARK });
  });
});

describe("E2 cap: min required + 1", () => {
  it("caps come from the solution (clues and testimony separately)", () => {
    expect(citeCaps(sol())).toEqual({ evidence: (sol().minKeyEvidence ?? 1) + 1, testimony: (sol().minKeyTestimony ?? 0) + 1 });
    expect(citeCaps({})).toEqual({ evidence: 2, testimony: 1 });
  });

  it("over-cap clues or testimony: 400, nothing consumed (no row, the game not over)", async () => {
    const caps = citeCaps(sol());
    const allEv = c.evidence.map((e) => e.id);
    const core = coreGuiltSecretIds(c);
    const allTe = c.characters.flatMap((ch) => ch.secrets.map((s) => s.id)).filter((id) => !core.has(id));
    expect(allEv.length).toBeGreaterThan(caps.evidence);
    for (const over of [{ keyEvidenceIds: allEv.slice(0, caps.evidence + 1) }, { keyTestimonyIds: allTe.slice(0, caps.testimony + 1) }]) {
      const r = await accuse({ ...cleanWin(), ...over });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("too_many_citations");
      expect(r.repo.rows.size).toBe(0);
      const g = (decodeStateToken(r.body.stateToken, c, TEST_ENV) as { ok: true; game: GameState }).game;
      expect(g.phase).not.toBe("resolved");
      expect(g.accusation ?? null).toBeNull();
    }
  });

  it("the client draft check and the form enforce the same cap ('Cite up to N')", () => {
    const caps = citeCaps(sol());
    const ev = c.evidence.map((e) => e.id);
    const opts = { suspectIds: c.characters.map((x) => x.id), evidenceIds: ev, motiveIds: c.motives.map((m) => m.id), testimonyIds: sol().keyTestimonyIds, caps };
    const over = validateAccusationDraft({ ...cleanWin(), keyEvidenceIds: ev.slice(0, caps.evidence + 1) }, opts);
    expect(over.ok).toBe(false);
    expect(validateAccusationDraft({ ...cleanWin(), keyEvidenceIds: ev.slice(0, caps.evidence) }, opts).ok).toBe(true);
    const view = getPublicCaseView(c);
    const html = renderToStaticMarkup(
      h(AccuseScreen, { suspects: view.suspects, evidence: view.evidence, motives: view.motives, busy: false, citeTestimony: true, citeCap: caps, onSubmit: () => {}, onBack: () => {} }),
    );
    expect(html).toContain(`Cite up to ${caps.evidence} clues`);
    expect(html).toContain(`Cite up to ${caps.testimony} confessions`);
  });
});

describe("E2 data", () => {
  it("validator: supporting ids must exist and must not overlap the key lists", () => {
    const k = sol().keyEvidenceIds[0]!;
    const kt = sol().keyTestimonyIds![0]!;
    const bad: LoadedCase = { ...c, solution: { ...c.solution, supportingEvidenceIds: ["no-such-clue", k], supportingTestimonyIds: ["no-such-secret", kt] } };
    const msgs = checkCaseReferences(bad).map((i) => `${i.path} ${i.message}`).join("\n");
    expect(msgs).toMatch(/supportingEvidenceIds\.0 .*no-such-clue/);
    expect(msgs).toMatch(/supportingEvidenceIds\.1 .*already in keyEvidenceIds/);
    expect(msgs).toMatch(/supportingTestimonyIds\.0 unknown secret "no-such-secret"/);
    expect(msgs).toMatch(/supportingTestimonyIds\.1 .*already in keyTestimonyIds/);
    expect(checkCaseReferences(c)).toEqual([]);
  });

  it("the supporting fields and the remark stay server-only (never in the public view)", () => {
    const cs: LoadedCase = { ...c, solution: { ...c.solution, supportingEvidenceIds: [redHerring()], supportingTestimonyIds: [strayTestimony()] } };
    const pub = JSON.stringify(getPublicCaseView(cs));
    expect(pub).not.toMatch(/supporting|sloppy/i);
    expect(pub).not.toContain(PLACEHOLDER);
  });
});
