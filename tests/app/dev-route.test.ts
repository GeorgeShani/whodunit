import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";

describe("dev-only split-screen stage route", () => {
  it("404s in production and is not listed in the sitemap", async () => {
    const src = readFileSync(path.join(process.cwd(), "app/dev/stage/page.tsx"), "utf8");
    expect(src).toMatch(/if \(process\.env\.NODE_ENV === "production"\) notFound\(\);/);
    expect(src).toMatch(/robots: \{ index: false/);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.includes("/dev"))).toBe(false);
  });
});
