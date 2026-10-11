/** R8 / E15d: "in the dark" or "he was dead" in a line about finding the body is the discovery scene, not the killing. */
import { beforeAll, describe, expect, it } from "vitest";
import { atDiscovery, findGuiltLeak } from "@/ai/guilt-check";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { guiltProfile, type GuiltProfile } from "@/engine/core-guilt";

let c: LoadedCase;
let p: GuiltProfile;
beforeAll(async () => {
  c = await loadCase("blackwood");
  p = guiltProfile(c);
});
const m = () => c.solution.murdererId;

describe("R8 discovery scene", () => {
  it.each([
    "I went into the library when we found him, in the dark.",
    "I went to the library when the body was found.",
    "I was in the library with the others when the door was forced, and he was dead.",
  ])("the culprit's true discovery line passes: %s", (l) => expect(findGuiltLeak(l, p, m())).toBeNull());
  it.each(["I was in the library in the dark before anyone found him.", "I was in the library in the dark, and Edmund was dead."])(
    "the window is still caught: %s",
    (l) => expect(findGuiltLeak(l, p, m())?.kind).toBe("scene"),
  );
  it("discovery phrases and post-window anchors, not 'before' ones", () => {
    expect(atDiscovery("after I forced the door", p)).toBe(true);
    expect(atDiscovery("with the rest of us", p)).toBe(true);
    expect(atDiscovery("before anyone found him", p)).toBe(false);
    expect(atDiscovery("in the dark", p)).toBe(false);
  });
});
