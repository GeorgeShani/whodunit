import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIVE_CASE_ID } from "@/engine/active-case";
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
    expect(c.meta.id).toBe(FIXTURE_ID);
    expect(c.characters.map((ch) => ch.id)).toEqual(["alpha", "bravo", "charlie"]);
    expect(c.solution.murdererId).toBe("alpha");
  });

  it("loads the active (running-game) case", async () => {
    const c = await loadCase(ACTIVE_CASE_ID);
    expect(c.characters.length).toBeGreaterThanOrEqual(2);
  });

  it("throws CaseValidationError for a missing case", async () => {
    await expect(loadCase("does-not-exist", FIXTURES_DIR)).rejects.toBeInstanceOf(CaseValidationError);
  });
});

describe("validateCase (broken fixtures)", () => {
  it("reports a murderer who is not a character", async () => {
    const out = await issuesFor((edit) => edit("solution.json", (s) => (s.murdererId = "nobody")));
    expect(out).toMatch(/murderer "nobody" is not a character/);
  });

  it("reports a weapon that is not evidence", async () => {
    const out = await issuesFor((edit) => edit("solution.json", (s) => (s.weaponId = "spoon")));
    expect(out).toMatch(/weapon "spoon" is not an evidence id/);
  });

  it("reports a murderer with no opportunity", async () => {
    const out = await issuesFor((edit) =>
      edit("case.json", (c) => {
        const t = c.timeline.find((x: any) => x.characterId === "alpha");
        t.from = "19:00";
        t.to = "20:00"; // 21:00 murder is > 15 min outside
      }),
    );
    expect(out).toMatch(/had no opportunity/);
  });

  it("accepts opportunity within the ±15 minute window", async () => {
    const { casesDir, cleanup } = await makeBrokenCopy((edit) =>
      edit("case.json", (c) => {
        const t = c.timeline.find((x: any) => x.characterId === "alpha");
        t.from = "20:30";
        t.to = "20:45"; // murder at 21:00 is exactly 15 min after
      }),
    );
    try {
      expect((await validateCase(FIXTURE_ID, casesDir)).issues).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("reports an innocent without secrets", async () => {
    const out = await issuesFor((edit) => edit("characters/bravo.json", (c) => (c.secrets = [])));
    expect(out).toMatch(/innocent "bravo" needs at least one secret/);
  });

  it("reports dangling character, evidence and location references", async () => {
    const out = await issuesFor(async (edit) => {
      await edit("characters/bravo.json", (c) => {
        c.secrets[0].pressuredByEvidenceIds = ["ghost-clue"];
        c.relationships[0].characterId = "ghost-person";
      });
      await edit("case.json", (c) => (c.evidence[0].locationId = "ghost-room"));
    });
    expect(out).toMatch(/unknown evidence "ghost-clue"/);
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
    const out = await issuesFor((edit) => edit("case.json", (c) => c.evidence.push({ ...c.evidence[0] })));
    expect(out).toMatch(/duplicate evidence id "note"/);
  });
});

describe("getPublicCaseView", () => {
  it("strips solution, private data and undiscovered evidence", async () => {
    const c = await loadCase(FIXTURE_ID, FIXTURES_DIR);
    const view = getPublicCaseView(c);
    const json = JSON.stringify(view);
    expect(view.evidence.map((e) => e.id)).toEqual(["note", "torn-glove"]);
    for (const banned of ["solution", "murdererId", "heavy-wrench", "UNDISCOVERED_WEAPON_DESC", "_SECRET", "_BELIEF", "PRIVATE_FACT", "GUILTY", "timeline", "relatedFactIds"]) {
      expect(json).not.toContain(banned);
    }
    expect(getPublicCaseView(c, { discoveredEvidenceIds: ["heavy-wrench"] }).evidence.map((e) => e.id)).toEqual(["heavy-wrench"]);
  });
});
