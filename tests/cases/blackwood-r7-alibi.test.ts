/** r7 M1 (CA-28): a card that breaks an innocent's whereabouts lie also cracks the secret behind it, and Archibald cannot invent an alibi. */
import { beforeAll, describe, expect, it } from "vitest";
import { planTurn } from "@/engine/interrogation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { r7State, r7Verdict, type R7Spec } from "../helpers/r7-guard";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

describe("CA-28 (r7 M1): no 'exposed lie, truth still locked' gap", () => {
  it("Victoria's stress-only left-dining card, shown to Archibald with no clues held, cracks his false alibi", () => {
    const g = r7State(c, { rev: [["victoria", "s-victoria-left-dining"]] });
    g.characters.archibald.liesToldIds.push("l-archibald-together");
    const plan = planTurn(c, g, "archibald", { playerText: "Lady Victoria admits she left the dining room. Where were you?", presentedTestimonyId: "s-victoria-left-dining" });
    expect(plan.revealSecretId).toBe("s-archibald-false-alibi");
  });

  it("Gregory's eyewitness card does the same", () => {
    const g = r7State(c, { rev: [["gregory", "s-gregory-in-hall"], ["gregory", "s-gregory-saw-victoria"]] });
    g.characters.archibald.liesToldIds.push("l-archibald-together");
    const plan = planTurn(c, g, "archibald", { playerText: "Gregory saw her come out of the library. Where were you?", presentedTestimonyId: "s-gregory-saw-victoria" });
    expect(plan.revealSecretId).toBe("s-archibald-false-alibi");
  });

  it("generic: every card that breaks an innocent's lie reveals a secret that supersedes it on that same exchange", () => {
    const victoria = c.solution.murdererId;
    const gaps: string[] = [];
    for (const ch of c.characters.filter((x) => x.id !== victoria))
      for (const lie of ch.intendedLies)
        for (const card of lie.breaksOnSecretIds ?? []) {
          const owner = c.characters.find((x) => x.secrets.some((s) => s.id === card))!;
          const g = r7State(c, { rev: [[owner.id, card]] });
          // the card's own prerequisites, so it is a reachable card
          for (const pre of owner.secrets.find((s) => s.id === card)!.revealConditions?.afterSecretIds ?? []) {
            g.revealedSecretIds.push(pre);
            g.characters[owner.id].revealedSecretIds.push(pre);
          }
          g.characters[ch.id].liesToldIds.push(lie.id);
          const plan = planTurn(c, g, ch.id, { playerText: "Explain this.", presentedTestimonyId: card });
          if (plan.exposedLieIds.includes(lie.id) && !(plan.revealSecretId && lie.supersededBySecretIds.includes(plan.revealSecretId)))
            gaps.push(`${ch.id}:${lie.id} <- ${card} (reveal=${plan.revealSecretId ?? "-"})`);
        }
    expect(gaps).toEqual([]);
  });
});

describe("CA-28 (r7 M1): Archibald cannot invent where he was", () => {
  const after: R7Spec = { ev: ["library-key"], rev: [["archibald", "s-archibald-false-alibi"]], shown: { archibald: ["library-key"] } };
  it.each([
    "If you must know, I went along to the library to have it out with Edmund, but the door was locked.",
    "I was in the billiard room, nursing a brandy, from a quarter past nine.",
    "I went to fetch the brandy from the cellar, and came back at twenty-two minutes past.",
    "Very well, I stepped out onto the terrace for a cigar. Hardly a hanging matter, old boy.",
    "I went up to my room for a spell. A man may fetch his own handkerchief.",
  ])("blocked even after his false alibi is out: %s", (line) => {
    expect(r7Verdict(c, "archibald", line, after, "Where were you, then?")).not.toBeNull();
  });

  it.each(["I left for a few minutes, that's all. Victoria was alone. Make of that what you will.", "I went to fetch the brandy, old boy, nothing more."])(
    "blocked before his false alibi is out: %s",
    (line) => expect(r7Verdict(c, "archibald", line, {}, "Did you leave the dining room?")).not.toBeNull(),
  );

  it.each([
    "When Reginald screamed I ran to the library door and shouldered it open.",
    "Your butler rang the police from the servants' telephone, but nobody can get through.",
    "The butler telephoned the police, old boy, but the road is flooded.",
  ])("true lines pass in a fresh state: %s", (line) => {
    expect(r7Verdict(c, "archibald", line, {}, "What happened after the scream?")).toBeNull();
  });

  it("after his false alibi is out, the true telephone story passes", () => {
    expect(r7Verdict(c, "archibald", "Fine! I nipped out to the servants' telephone to ring my broker. Satisfied?", { ...after, rev: [...after.rev!, ["archibald", "s-archibald-embezzlement"]] }, "Where were you?")).toBeNull();
  });
});
