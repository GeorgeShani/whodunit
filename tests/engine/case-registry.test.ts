import { describe, expect, it } from "vitest";
import { getPublicCase, isPublicCaseId, listPublicCaseIds, UnknownCaseError } from "@/engine/case-registry";
import { FIXTURES_DIR } from "../helpers/fixture";

describe("case registry (allowlist)", () => {
  it("lists only public cases from cases/: templates starting with _ are excluded", () => {
    const ids = listPublicCaseIds();
    expect(ids).toContain("blackwood");
    expect(ids).not.toContain("_placeholder");
    expect(ids.every((id) => !id.startsWith("_"))).toBe(true);
  });

  it("fixtures are never in the production allowlist, only in their own dir", () => {
    expect(listPublicCaseIds()).not.toContain("fixture-manor");
    expect(listPublicCaseIds()).not.toContain("harbor-light");
    expect(listPublicCaseIds(FIXTURES_DIR)).toEqual(["fixture-manor", "harbor-light"]);
  });

  it.each([
    "_placeholder", "../blackwood", "blackwood/..", "BLACKWOOD", "blackwood ", "black wood", "cases/blackwood",
    "", "x".repeat(65), "nonexistent", "blackwood%2f..", 42, null, undefined, { id: "blackwood" },
  ])("rejects %j", (id) => {
    expect(isPublicCaseId(id)).toBe(false);
  });

  it("accepts an allowlisted id and loads it; rejects others without touching the path", async () => {
    expect(isPublicCaseId("blackwood")).toBe(true);
    expect((await getPublicCase("blackwood")).id).toBe("blackwood");
    await expect(getPublicCase("../tests/fixtures/cases/harbor-light")).rejects.toBeInstanceOf(UnknownCaseError);
    await expect(getPublicCase("_placeholder")).rejects.toBeInstanceOf(UnknownCaseError);
  });
});
