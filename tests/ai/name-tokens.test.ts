/** C3 (DX3): ordinary words split from multi-word names don't trip the guilt check alone; full names still do. */
import { beforeAll, describe, expect, it } from "vitest";
import { findGuiltLeak } from "@/ai/guilt-check";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences, checkCaseWarnings } from "@/engine/case-validation";
import { guiltProfile } from "@/engine/core-guilt";
import { COMMON_NAME_WORDS, keepNameToken } from "@/engine/name-tokens";

let c: LoadedCase;
let v: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
  // Blackwood with a nickname and a scene made of ordinary words (as in a ship case: "the Marmalade King", "Boat Deck").
  v = {
    ...c,
    victim: { ...c.victim, aliases: [...c.victim.aliases, "the Marmalade King", "Old Barnacle Brine"] },
    locations: c.locations.map((l) => (l.id === c.solution.locationId ? { ...l, name: "The Boat Deck" } : l)),
  };
});
const leak = (cs: LoadedCase, line: string) => findGuiltLeak(line, guiltProfile(cs), cs.solution.murdererId)?.kind ?? null;

describe("C3 name tokens", () => {
  it("the generic stoplist covers the reported words", () => {
    for (const w of ["king", "deck", "brine", "marmalade"]) expect(COMMON_NAME_WORDS.has(w), w).toBe(true);
    expect(keepNameToken("king")).toBe(false);
    expect(keepNameToken("barnacle")).toBe(true);
    expect(keepNameToken("barnacle", { ignoreNameTokens: ["barnacle"] })).toBe(false);
    expect(keepNameToken("brine", { keepNameTokens: ["brine"] })).toBe(true);
  });

  it("ordinary words of multi-word names are dropped from the profile; full names and real name words stay", () => {
    const p = guiltProfile(v);
    expect(p.victimNames).toEqual(expect.arrayContaining(["the marmalade king", "old barnacle brine", "barnacle"]));
    for (const w of ["king", "marmalade", "brine"]) expect(p.victimNames).not.toContain(w);
    expect(p.sceneNames).toEqual(["boat deck"]);
    // the weapon's head noun always counts (it is the point of the weapon rule)
    expect(p.weaponNames).toContain(c.evidence.find((e) => e.id === c.solution.weaponId)!.name.toLowerCase().split(/\s+/).pop());
  });

  it("an ordinary word alone no longer trips the check; the full name still does", () => {
    expect(leak(v, "I hit the king.")).toBeNull();
    expect(leak(v, "I hit the Marmalade King.")).toBe("killing");
    expect(leak(v, "I hit Barnacle.")).toBe("killing");
  });

  it("guiltCheck.ignoreNameTokens drops a case word; keepNameTokens puts a stoplisted one back", () => {
    const ign: LoadedCase = { ...v, guiltCheck: { ignoreNameTokens: ["barnacle"] } };
    expect(guiltProfile(ign).victimNames).not.toContain("barnacle");
    expect(leak(ign, "I hit Barnacle.")).toBeNull();
    const keep: LoadedCase = { ...v, guiltCheck: { keepNameTokens: ["brine"] } };
    expect(guiltProfile(keep).victimNames).toContain("brine");
    expect(leak(keep, "I hit Brine.")).toBe("killing");
  });

  it("Blackwood's own profile is unchanged except the ordinary 'room'-style words (no override needed)", () => {
    const p = guiltProfile(c);
    expect(p.victimNames).toEqual(expect.arrayContaining(["lord blackwood", "blackwood", "edmund"]));
    expect(p.locationNames.flatMap((l) => l.names)).not.toContain("room");
  });

  it("validator: a word in both lists is an error; a word of no multi-word name is a warning", () => {
    const both: LoadedCase = { ...v, guiltCheck: { ignoreNameTokens: ["barnacle"], keepNameTokens: ["barnacle"] } };
    expect(checkCaseReferences(both).map((i) => i.message).join("\n")).toMatch(/"barnacle" is in both/);
    const stray: LoadedCase = { ...v, guiltCheck: { ignoreNameTokens: ["zeppelin"], keepNameTokens: ["brine"] } };
    const w = checkCaseWarnings(stray).filter((x) => x.path?.startsWith("guiltCheck")).map((x) => x.message);
    expect(w).toEqual([expect.stringMatching(/"zeppelin" is not a word of any multi-word name/)]);
  });
});
