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

  it("generic: every card that breaks a lie reveals a secret that supersedes it on that same exchange (every suspect, the murderer included since r7c R4)", () => {
    const gaps: string[] = [];
    for (const ch of c.characters)
      for (const lie of ch.intendedLies.filter((l) => l.supersededBySecretIds.length))
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

  it("r7c R4: Victoria's 'together' lie breaks only on what cracks left-dining (no burned letter, no Gregory card)", () => {
    const v = c.characters.find((x) => x.id === c.solution.murdererId)!;
    const lie = v.intendedLies.find((l) => l.id === "l-victoria-together")!;
    const left = v.secrets.find((s) => s.id === "s-victoria-left-dining")!.revealConditions!;
    expect([...lie.brokenByEvidenceIds].sort()).toEqual([...(left.evidenceIds ?? [])].sort());
    expect([...(lie.breaksOnSecretIds ?? [])].sort()).toEqual([...(left.testimonyIds ?? [])].sort());
  });

  /** r7b (Gremlin N4): the same rule for CLUES. Each entry is a deliberate exception with its reason. */
  const EVIDENCE_EXCEPTIONS: Record<string, string> = {
    "reginald:l-reginald-few-words <- burned-letter":
      "Decision 12. The letter first cracks s-reginald-theft (his own deeper secret); the overheard truth needs theft first and opens on the next plain or letter exchange. Showing other items in between does not change it, so the exposed state can last more than one exchange (Gremlin r7c R13). Gremlin rated it benign; Marvin to confirm (alternative: drop burned-letter from the lie's brokenByEvidenceIds). The engine fix (E-R4: 'admit NOTHING' while superseders are locked) covers the prompt side.",
  };
  it("generic: every CLUE that breaks a lie reveals a secret that supersedes it on that same exchange (r7b N4; the murderer included since r7c R4)", () => {
    const gaps: string[] = [];
    for (const ch of c.characters)
      for (const lie of ch.intendedLies.filter((l) => l.supersededBySecretIds.length))
        for (const ev of lie.brokenByEvidenceIds) {
          const g = r7State(c, { ev: c.evidence.map((e) => e.id) });
          g.characters[ch.id].liesToldIds.push(lie.id);
          const plan = planTurn(c, g, ch.id, { playerText: "Explain this.", presentedEvidenceId: ev });
          if (plan.exposedLieIds.includes(lie.id) && !(plan.revealSecretId && lie.supersededBySecretIds.includes(plan.revealSecretId)))
            gaps.push(`${ch.id}:${lie.id} <- ${ev}`);
        }
    expect(gaps.filter((x) => !(x in EVIDENCE_EXCEPTIONS))).toEqual([]);
    // an exception that no longer happens must be removed
    expect(Object.keys(EVIDENCE_EXCEPTIONS).filter((x) => !gaps.includes(x))).toEqual([]);
  });

  it("r7c: no reachable state (any order of up to 3 clues or cards, every lie told) leaves a superseded lie exposed with all its superseders locked", () => {
    const ALL_EV = c.evidence.map((e) => e.id);
    const core = new Set(c.characters.flatMap((x) => x.secrets.filter((s) => s.coreGuilt).map((s) => s.id)));
    const cards = c.characters.flatMap((x) => x.secrets.map((s) => s.id)).filter((id) => !core.has(id));
    const owner = (sid: string) => c.characters.find((x) => x.secrets.some((s) => s.id === sid))!;
    const found = new Set<string>();
    for (const ch of c.characters) {
      type St = { ev: string[]; tm: string[]; rev: string[] };
      const seen = new Set<string>();
      const q: St[] = [{ ev: [], tm: [], rev: [] }];
      while (q.length) {
        const s = q.shift()!;
        const pres: [string, string][] = [...ALL_EV.map((e) => ["e", e] as [string, string]), ...cards.filter((id) => !ch.secrets.some((x) => x.id === id)).map((id) => ["t", id] as [string, string])];
        for (const [kind, id] of pres) {
          if (kind === "e" ? s.ev.includes(id) : s.tm.includes(id)) continue;
          const g = r7State(c, { ev: ALL_EV });
          const rt = g.characters[ch.id];
          rt.evidenceShownIds.push(...s.ev); rt.testimonyShownIds.push(...s.tm); rt.revealedSecretIds.push(...s.rev); g.revealedSecretIds.push(...s.rev);
          for (const t of [...s.tm, ...(kind === "t" ? [id] : [])]) {
            const o = owner(t);
            for (const pre of [...(o.secrets.find((x) => x.id === t)!.revealConditions?.afterSecretIds ?? []), t])
              if (!g.characters[o.id].revealedSecretIds.includes(pre)) { g.characters[o.id].revealedSecretIds.push(pre); g.revealedSecretIds.push(pre); }
          }
          rt.liesToldIds.push(...ch.intendedLies.map((l) => l.id)); rt.interrogationCount = 3;
          const plan = planTurn(c, g, ch.id, { playerText: "Explain this.", ...(kind === "e" ? { presentedEvidenceId: id } : { presentedTestimonyId: id }) });
          const rev = [...s.rev, ...(plan.revealSecretId ? [plan.revealSecretId] : [])];
          for (const lid of plan.exposedLieIds) {
            const lie = ch.intendedLies.find((l) => l.id === lid)!;
            if (lie.supersededBySecretIds.length && !lie.supersededBySecretIds.some((x) => rev.includes(x))) found.add(`${ch.id}:${lid}`);
          }
          const ns: St = { ev: kind === "e" ? [...s.ev, id] : s.ev, tm: kind === "t" ? [...s.tm, id] : s.tm, rev };
          const k = [ns.ev.slice().sort().join(","), ns.tm.slice().sort().join(","), ns.rev.slice().sort().join(",")].join("|");
          if (!seen.has(k) && ns.ev.length + ns.tm.length < 3) { seen.add(k); q.push(ns); }
        }
      }
    }
    // only decision 12 (Reginald's few-words after the letter cracked his theft) remains
    expect([...found].sort()).toEqual(["reginald:l-reginald-few-words"]);
  });

  it("r7b N4: the burned letter shown to Archibald cracks his false alibi too (it already broke 'together')", () => {
    const g = r7State(c, { ev: ["silver-candlestick", "library-key", "burned-letter"] });
    g.characters.archibald.liesToldIds.push("l-archibald-together");
    const plan = planTurn(c, g, "archibald", { playerText: "This letter was in the dining-room fire. You sat there all along?", presentedEvidenceId: "burned-letter" });
    expect(plan.exposedLieIds).toContain("l-archibald-together");
    expect(plan.revealSecretId).toBe("s-archibald-false-alibi");
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
