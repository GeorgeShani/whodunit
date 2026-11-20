import { describe, expect, it } from "vitest";
import { canonicalCaseId, CASE_ALIASES } from "@/lib/case-aliases";
import { getPublicCase, isPublicCaseId, listPublicCaseIds, UnknownCaseError } from "@/engine/case-registry";

describe("case aliases", () => {
  it("maps the draft id _tallyho onto the published id tallyho and leaves others alone", () => {
    expect(CASE_ALIASES).toEqual({ _tallyho: "tallyho" });
    expect(canonicalCaseId("_tallyho")).toBe("tallyho");
    expect(canonicalCaseId("tallyho")).toBe("tallyho");
    expect(canonicalCaseId("blackwood")).toBe("blackwood");
  });

  it("treats _tallyho as a public request for tallyho; other _ drafts stay hidden", async () => {
    expect(listPublicCaseIds()).toContain("tallyho");
    expect(listPublicCaseIds()).not.toContain("_tallyho");
    expect(isPublicCaseId("tallyho")).toBe(true);
    expect(isPublicCaseId("_tallyho")).toBe(true);
    expect(isPublicCaseId("_placeholder")).toBe(false);
    expect((await getPublicCase("_tallyho")).id).toBe("tallyho");
    await expect(getPublicCase("_placeholder")).rejects.toBeInstanceOf(UnknownCaseError);
  });
});
