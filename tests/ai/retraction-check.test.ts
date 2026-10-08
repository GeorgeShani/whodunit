/** #48: a revealed secret is never denied or retracted (breakdowns included); data-driven cues, both cases. */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { guiltProfile } from "@/engine/core-guilt";
import { findRetraction } from "@/ai/retraction-check";
import { FIXTURES_DIR } from "../helpers/fixture";

let c: LoadedCase;
let hl: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});
const R = ["s-victoria-new-will", "s-victoria-left-dining"];
const v = (line: string, revealed = R) => findRetraction(line, c, "victoria", revealed, guiltProfile(c));

describe("findRetraction (#48)", () => {
  it("catches the Gremlin breakdown line after new-will was revealed", () => {
    const r = v("NO! YOU MONSTER—HOW DARE YOU ACCUSE ME LIKE THIS?! I KNOW NOTHING OF ANY WILL OR LIBRARY IN THE DARK! LEAVE ME BE!", ["s-victoria-new-will"]);
    expect(r).toMatchObject({ secretId: "s-victoria-new-will", kind: "denies_key_claim" });
  });

  it.each([
    ["I never burned that letter, Inspector.", "denies_key_claim"],
    ["There was no new will, darling.", "denies_key_claim"],
    ["I've never seen that letter in my life!", "denies_key_claim"],
    ["I never left the dining room.", "denies_key_claim"],
    ["Our little chat was about the Sunday menu, nothing more.", "restates_superseded_story"],
  ])("rejects %s", (line, kind) => {
    expect(v(line)?.kind).toBe(kind);
  });

  it.each([
    "Yes, I burned the letter. I am not sorry I burned the letter.",
    "I will not discuss it further, darling.",
    "Nothing will make me say more. I knew of the will; that is all.",
    "I know nothing of any library in the dark, Inspector.", // the scene: the culprit may always deny the murder's own terms
    "I never touched the candlestick.",
    "Not just the will, darling, the whole wretched estate.",
    "I left the dining room for a few minutes, that is all.",
    "That is no business of yours, Inspector.",
    "Archibald and I sat by the fire before the candles, and then I left.",
  ])("accepts %s", (line) => {
    expect(v(line)).toBeNull();
  });

  it("Gregory (in-hall admitted) may still say he saw nothing in the dark", () => {
    expect(findRetraction("Er, well... I didn't see nothin' in the dark, sir. Just heard a thud, that's all.", c, "gregory", ["s-gregory-in-hall"], guiltProfile(c))).toBeNull();
  });

  it("a secret not yet revealed can still be denied", () => {
    expect(v("There was no new will, darling.", [])).toBeNull();
    expect(v("There was no new will, darling.", ["s-victoria-left-dining"])).toBeNull();
  });

  it("is case-agnostic (harbor-light fixture: the cook's rum)", () => {
    const g = guiltProfile(hl);
    expect(findRetraction("There's no rum in my galley, never was.", hl, "cook-marlow", ["marlow-secret"], g)?.secretId).toBe("marlow-secret");
    expect(findRetraction("Aye, the rum's for the captain. Happy now?", hl, "cook-marlow", ["marlow-secret"], g)).toBeNull();
    expect(findRetraction("There's no rum in my galley.", hl, "cook-marlow", [], g)).toBeNull();
  });
});
