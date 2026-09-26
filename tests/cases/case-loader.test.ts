import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CASE_ID } from "@/lib/cases";
import { CaseValidationError, loadCase, validateCase } from "@/engine/case-loader";
import { getPublicCaseView } from "@/engine/public-view";
import { FIXTURE_ID, FIXTURES_DIR, makeBrokenCopy } from "../helpers/fixture";

async function issuesFor(mutate: Parameters<typeof makeBrokenCopy>[0]) {
  const { casesDir, cleanup } = await makeBrokenCopy(mutate);
  try {
    const r = await validateCase(FIXTURE_ID, casesDir);
    expect(r.data).toBeUndefined();
    return r.issues.map((i) => `${i.file} ${i.path ?? ""} ${i.message}`).join("\n");
  } finally {
    await cleanup();
  }
}

describe("loadCase (valid fixture)", () => {
  it("loads and validates the fixture case", async () => {
    const c = await loadCase(FIXTURE_ID, FIXTURES_DIR);
    expect(c.id).toBe(FIXTURE_ID);
    expect(c.timeline.map((t) => t.id)).toContain("alpha-struck-victim");
    expect(c.solution.motiveId).toBe("partnership-dispute");
    expect(c.characters.map((ch) => ch.id)).toEqual(["alpha", "bravo", "charlie"]);
    expect(c.solution.murdererId).toBe("alpha");
  });

  it("loads the default (running-game) case", async () => {
    const c = await loadCase(DEFAULT_CASE_ID);
    expect(c.characters.length).toBeGreaterThanOrEqual(2);
  });

  it("throws CaseValidationError for a missing case", async () => {
    await expect(loadCase("does-not-exist", FIXTURES_DIR)).rejects.toBeInstanceOf(CaseValidationError);
  });
});

async function expectValid(mutate: Parameters<typeof makeBrokenCopy>[0]) {
  const { casesDir, cleanup } = await makeBrokenCopy(mutate);
  try {
    expect((await validateCase(FIXTURE_ID, casesDir)).issues).toEqual([]);
  } finally {
    await cleanup();
  }
}

describe("validateCase (broken fixtures)", () => {
  it("reports a murderer who is not a character", async () => {
    const out = await issuesFor((edit) => edit("solution.json", (s) => (s.murdererId = "nobody")));
    expect(out).toMatch(/murderer "nobody" is not a character/);
  });

  it("reports a weapon that is not evidence", async () => {
    const out = await issuesFor((edit) => edit("solution.json", (s) => (s.weaponId = "spoon")));
    expect(out).toMatch(/weapon "spoon" is not an evidence id/);
  });

  it("reports a murderer with no opportunity (point entry > 15 min away)", async () => {
    const out = await issuesFor((edit) =>
      edit("timeline.json", (tl) => {
        tl.find((x: any) => x.id === "alpha-struck-victim").time = "20:44"; // murder at 21:00 -> 16 min
      }),
    );
    expect(out).toMatch(/had no opportunity/);
  });

  it("accepts a point entry exactly 15 minutes from the murder", async () => {
    await expectValid((edit) =>
      edit("timeline.json", (tl) => {
        tl.find((x: any) => x.id === "alpha-struck-victim").time = "21:15";
      }),
    );
  });

  it("accepts a window that ends 15 minutes before the murder, rejects one at 16", async () => {
    const toWindow = (to: string) => (edit: any) =>
      edit("timeline.json", (tl: any[]) => {
        const e = tl.find((x) => x.id === "alpha-struck-victim");
        delete e.time;
        e.from = "20:30";
        e.to = to;
      });
    await expectValid(toWindow("20:45"));
    expect(await issuesFor(toWindow("20:44"))).toMatch(/had no opportunity/);
  });

  it("requires the murderer to be at the solution location (not elsewhere)", async () => {
    const out = await issuesFor((edit) =>
      edit("timeline.json", (tl) => (tl.find((x: any) => x.id === "alpha-struck-victim").locationId = "garden")),
    );
    expect(out).toMatch(/had no opportunity/);
  });

  it("reports an innocent without secrets", async () => {
    const out = await issuesFor((edit) => edit("characters/bravo.json", (c) => (c.secrets = [])));
    expect(out).toMatch(/innocent "bravo" needs at least one secret/);
  });

  it("reports dangling character, evidence and location references", async () => {
    const out = await issuesFor(async (edit) => {
      await edit("characters/bravo.json", (c) => {
        c.secrets[0].revealConditions.evidenceIds = ["ghost-clue"];
        c.relationships[0].targetCharacterId = "ghost-person";
      });
      await edit("evidence.json", (ev) => (ev[0].locationId = "ghost-room"));
    });
    expect(out).toMatch(/revealConditions\.evidenceIds\.0 unknown evidence "ghost-clue"/);
    expect(out).toMatch(/unknown character\/victim "ghost-person"/);
    expect(out).toMatch(/unknown location "ghost-room"/);
  });

  it("reports schema errors with file and path (strict keys, bad times)", async () => {
    const out = await issuesFor(async (edit) => {
      await edit("characters/charlie.json", (c) => (c.isMurderer = false));
      await edit("solution.json", (s) => (s.time = "9pm"));
    });
    expect(out).toMatch(/characters\/charlie\.json .*isMurderer/);
    expect(out).toMatch(/solution\.json time/);
  });

  it("reports file-name/id mismatch, missing files and invalid JSON", async () => {
    const out = await issuesFor(async (edit, dir) => {
      await edit("characters/alpha.json", (c) => (c.id = "alpha-two"));
      await rm(path.join(dir, "solution.json"));
      await writeFile(path.join(dir, "characters/bravo.json"), "{ not json");
    });
    expect(out).toMatch(/must match the file name/);
    expect(out).toMatch(/solution\.json {2}file is missing/);
    expect(out).toMatch(/bravo\.json {2}invalid JSON/);
  });

  it("reports duplicate ids", async () => {
    const out = await issuesFor(async (edit) => {
      await edit("evidence.json", (ev) => ev.push({ ...ev[0] }));
      await edit("case.json", (c) => c.facts.push({ ...c.facts[0], id: "bravo-in-garden" })); // clashes with a timeline id
    });
    expect(out).toMatch(/duplicate evidence id "note"/);
    expect(out).toMatch(/duplicate fact\/timeline id "bravo-in-garden"/);
  });

  it("checks the new references: relatedCharacters, lie evidence/facts, reveal prerequisites, motive, key evidence", async () => {
    const out = await issuesFor(async (edit) => {
      await edit("evidence.json", (ev) => (ev[0].relatedCharacters = ["ghost-person"]));
      await edit("characters/alpha.json", (c) => {
        c.intendedLies[0].brokenByEvidenceIds = ["ghost-lie-clue"];
        c.intendedLies[0].aboutFactId = "ghost-fact";
        c.secrets[0].revealConditions.afterSecretIds = ["bravo-secret"]; // not alpha's own secret
      });
      await edit("solution.json", (s) => {
        s.motiveId = "ghost-motive";
        s.keyEvidenceIds = ["note", "ghost-key"];
      });
    });
    expect(out).toMatch(/relatedCharacters\.0 unknown character\/victim "ghost-person"/);
    expect(out).toMatch(/brokenByEvidenceIds\.0 unknown evidence "ghost-lie-clue"/);
    expect(out).toMatch(/aboutFactId unknown fact "ghost-fact"/);
    expect(out).toMatch(/afterSecretIds\.0 unknown own secret "bravo-secret"/);
    expect(out).toMatch(/motive "ghost-motive" is not one of case\.json motives/);
    expect(out).toMatch(/keyEvidenceIds\.1 unknown evidence "ghost-key"/);
  });

  it("allows the victim as a relationship target and in relatedCharacters", async () => {
    await expectValid(async (edit) => {
      await edit("evidence.json", (ev) => (ev[0].relatedCharacters = ["victim-v"]));
      await edit("characters/bravo.json", (c) => (c.relationships[0].targetCharacterId = "victim-v"));
    });
  });

  it("reports the old single-file layout / old field names", async () => {
    const out = await issuesFor(async (edit, dir) => {
      await rm(path.join(dir, "timeline.json"));
      await edit("case.json", (c) => {
        c.victimId = c.victim.id;
        delete c.victim;
      });
    });
    expect(out).toMatch(/timeline\.json {2}file is missing/);
    expect(out).toMatch(/case\.json victim/);
    expect(out).toMatch(/victimId/);
  });
});

describe("endings.json", () => {
  it("is loaded when present and optional when absent", async () => {
    const c = await loadCase(FIXTURE_ID, FIXTURES_DIR);
    expect(c.endings?.correct.confession[0].speaker).toBe("alpha");
    expect(Object.keys(c.endings!.wrong).sort()).toEqual(["alpha", "bravo", "charlie"]);
    await expectValid(async (_edit, dir) => {
      const { rm } = await import("node:fs/promises");
      await rm(`${dir}/endings.json`);
    });
  });

  it("requires a wrong ending for EVERY suspect, including the murderer", async () => {
    const out = await issuesFor((edit) => edit("endings.json", (e) => delete e.wrong.alpha));
    expect(out).toMatch(/endings\.json wrong missing wrong ending for suspect "alpha" \(the murderer/);
  });

  it("checks speakers, evidence ids and wrong-ending keys", async () => {
    const out = await issuesFor((edit) =>
      edit("endings.json", (e) => {
        e.correct.confession[0].speaker = "lord-nobody";
        e.correct.recap[0].evidenceIds = ["ghost-clue"];
        e.wrong["victim-v"] = [{ speaker: "narrator", text: "?" }];
      }),
    );
    expect(out).toMatch(/correct\.confession\.0\.speaker unknown speaker "lord-nobody"/);
    expect(out).toMatch(/correct\.recap\.0\.evidenceIds\.0 unknown evidence "ghost-clue"/);
    expect(out).toMatch(/wrong\.victim-v "victim-v" is not a suspect/);
  });

  it("validates line shape (pauseMs range, emotion enum, strict keys)", async () => {
    const out = await issuesFor((edit) =>
      edit("endings.json", (e) => {
        e.correct.confession[0].pauseMs = 9000;
        e.correct.recap[0].emotion = "hangry";
        e.escapedLine = "";
        e.winner = "alpha";
      }),
    );
    expect(out).toMatch(/endings\.json correct\.confession\.0\.pauseMs/);
    expect(out).toMatch(/endings\.json correct\.recap\.0\.emotion/);
    expect(out).toMatch(/endings\.json escapedLine/);
    expect(out).toMatch(/winner/);
  });

  it("validates searchFlavor (1-2 lines) and discoveryLine", async () => {
    const out = await issuesFor(async (edit) => {
      await edit("case.json", (c) => (c.locations[0].searchFlavor = { lines: ["a", "b", "c"] }));
      await edit("evidence.json", (ev) => (ev[0].discoveryLine = ""));
    });
    expect(out).toMatch(/case\.json locations\.0\.searchFlavor\.lines/);
    expect(out).toMatch(/evidence\.json 0\.discoveryLine/);
  });
});

describe("getPublicCaseView", () => {
  it("keeps public search flavour and discovery lines, never endings", async () => {
    const c = await loadCase(FIXTURE_ID, FIXTURES_DIR);
    const view = getPublicCaseView(c);
    const json = JSON.stringify(view);
    expect(view.locations[0].searchFlavor?.lines).toEqual(["FIXTURE_SEARCH_hall"]);
    expect(view.evidence[0].discoveryLine).toBe("FIXTURE_DISCOVERY_note");
    for (const banned of ["ENDING_", "endings", "confession", "recap", "escapedLine"]) expect(json).not.toContain(banned);
  });

  it("strips solution, private data and undiscovered evidence", async () => {
    const c = await loadCase(FIXTURE_ID, FIXTURES_DIR);
    const view = getPublicCaseView(c);
    const json = JSON.stringify(view);
    expect(view.evidence.map((e) => e.id)).toEqual(["note", "torn-glove"]);
    // Motive OPTIONS are public multiple choice; the true motive is not flagged.
    expect(view.motives.map((m) => m.id)).toEqual(["partnership-dispute", "gambling-debt", "forged-will"]);
    expect(Object.keys(view.motives[0]).sort()).toEqual(["id", "label"]);
    for (const banned of [
      "solution", "murdererId", "motiveId", "keyEvidenceIds", "SOLUTION_EXPLANATION", "heavy-wrench", "UNDISCOVERED_WEAPON_DESC",
      "_SECRET", "_BELIEF", "_LIE", "intendedLies", "revealConditions", "stressThreshold", "PRIVATE_FACT", "GUILTY",
      "timeline", "relatedFactIds", "relatedCharacters", "relationships", "honesty", "_REL",
    ]) {
      expect(json).not.toContain(banned);
    }
    expect(getPublicCaseView(c, { discoveredEvidenceIds: ["heavy-wrench"] }).evidence.map((e) => e.id)).toEqual(["heavy-wrench"]);
  });
});
