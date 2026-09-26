import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleHint } from "@/engine/hint-handler";
import { HINT_COOLDOWN_TURNS, hintCandidates, NO_HINT_LINE } from "@/engine/hints";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const fresh = (edit: (g: GameState) => void = () => undefined) => {
  const g = createInitialGameState(c);
  edit(g);
  return g;
};
const hint = (g?: GameState | string) =>
  handleHint({ caseId: "blackwood", ...(g ? { stateToken: typeof g === "string" ? g : encodeStateToken(g, TEST_ENV) } : {}) }, { caseData: c, env: TEST_ENV });
const decode = (t: string | undefined) => {
  const d = decodeStateToken(t, c, TEST_ENV);
  if (!d.ok) throw new Error(d.reason);
  return d.game;
};
/** Victoria has told her together-story; the player holds the library key but hasn't shown it to her. */
const toldAndHeld = () =>
  fresh((x) => {
    x.turn = 4;
    x.characters.victoria.liesToldIds = ["l-victoria-together"];
    x.discoveredEvidenceIds.push("library-key");
  });

describe("contradiction assistance (MASTER_PLAN §31, Phase 12)", () => {
  it("flags a POSSIBLE CONTRADICTION: told story + an item the player holds that would break it", () => {
    const r = hint(toldAndHeld());
    expect(r.status).toBe(200);
    expect(r.body.hint).toEqual({ characterId: "victoria", characterName: "Victoria Blackwood" });
    expect(r.body.line).toMatch(/^⚠ POSSIBLE CONTRADICTION: .*Victoria Blackwood told you about whereabouts during the blackout\. Which of them is wrong/);
  });

  it("is spoiler-safe: never the item, the lie's wording or id, or anything from the solution", () => {
    const r = hint(toldAndHeld());
    const json = JSON.stringify({ ...r.body, stateToken: undefined });
    const key = c.evidence.find((e) => e.id === "library-key")!;
    for (const banned of [key.name, key.id, "l-victoria", ...c.characters.flatMap((x) => x.intendedLies.map((l) => l.claim))]) expect(json).not.toContain(banned);
    const sol = c.solution as unknown as Record<string, unknown>;
    for (const v of Object.values(sol)) if (typeof v === "string" && v.length > 3 && !c.characters.some((x) => x.id === v)) expect(json).not.toContain(v);
    expect(json).not.toMatch(/murder(er|ed)|guilty|killer/i);
    // Hinted ids are sealed: the readable token payload names no lie.
    expect(Buffer.from(r.body.stateToken!.split(".")[1], "base64url").toString("utf8")).not.toContain("l-victoria");
  });

  it("never hints at a story the character hasn't told, or with items the player doesn't hold", () => {
    expect(hintCandidates(c, fresh((x) => x.discoveredEvidenceIds.push("library-key")))).toEqual([]);
    expect(hintCandidates(c, fresh((x) => (x.characters.victoria.liesToldIds = ["l-victoria-together"])))).toEqual([]);
    const r = hint(fresh());
    expect(r.body).toMatchObject({ hint: null, line: NO_HINT_LINE });
    // "Nothing to flag" does not start the cooldown.
    expect(decode(r.body.stateToken).hintTurn).toBeNull();
  });

  it("stops once the item has been put to them (the contradiction is no longer 'possible', it's exposed)", () => {
    const g = toldAndHeld();
    g.characters.victoria.evidenceShownIds.push("library-key");
    expect(hintCandidates(c, g).map((h) => h.lieId)).not.toContain("l-victoria-together");
  });

  it(`cooldown: ${HINT_COOLDOWN_TURNS} game turns between hints (429 in the meantime), then the next unhinted one first`, () => {
    const g = toldAndHeld();
    g.characters.victoria.liesToldIds.push("l-victoria-locked-in"); // also broken by the key
    const first = hint(g);
    expect(first.body.readyInTurns).toBe(HINT_COOLDOWN_TURNS);
    const again = hint(first.body.stateToken);
    expect(again.status).toBe(429);
    expect(again.body).toMatchObject({ hint: null, error: "cooldown", readyInTurns: HINT_COOLDOWN_TURNS });
    const later = decode(again.body.stateToken);
    later.turn += HINT_COOLDOWN_TURNS;
    const second = hint(later);
    expect(second.status).toBe(200);
    expect(second.body.line).toMatch(/about the locked library door/);
    expect(decode(second.body.stateToken).hintedLieIds).toEqual(["l-victoria-together", "l-victoria-locked-in"]);
  });

  it("the case being closed stops hints", () => {
    const g = toldAndHeld();
    g.accusation = { murdererId: "gregory", weaponId: "library-key", motiveId: c.motives[0].id, keyEvidenceIds: ["library-key"] };
    g.outcome = "lost";
    const r = hint(g);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("case_closed");
  });
});
