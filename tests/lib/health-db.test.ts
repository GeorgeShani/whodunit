/** #39: /api/health reports the closed-games database as ok / unreachable / unconfigured, always with 200. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import { dbHealth } from "@/lib/closed-games";

describe("dbHealth", () => {
  it("unconfigured without DATABASE_URL (no connection attempted)", async () => {
    expect(await dbHealth({ env: {} as NodeJS.ProcessEnv })).toBe("unconfigured");
  });
  it("ok when SELECT 1 answers; unreachable on an error or after the timeout", async () => {
    expect(await dbHealth({ ping: async () => [{ "?column?": 1 }] })).toBe("ok");
    expect(await dbHealth({ ping: () => Promise.reject(new Error("ECONNREFUSED")) })).toBe("unreachable");
    const t0 = Date.now();
    expect(await dbHealth({ ping: () => new Promise(() => {}), timeoutMs: 50 })).toBe("unreachable");
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("GET /api/health", () => {
  const prev = process.env.DATABASE_URL;
  afterEach(async () => {
    await closeDb();
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });
  const get = async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
  };

  it("unconfigured", async () => {
    delete process.env.DATABASE_URL;
    expect(await get()).toEqual({ status: 200, body: { ok: true, runtimeCache: "memory", db: "unconfigured" }, cache: "no-store" });
  });
  it("unreachable (the real client against a closed port), still 200, and nothing about the URL", async () => {
    process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:9/none";
    const r = await get();
    expect(r).toMatchObject({ status: 200, body: { ok: true, db: "unreachable" } });
    expect(JSON.stringify(r.body)).not.toContain("127.0.0.1");
  });
  it("ok (SELECT 1 answered)", async () => {
    vi.resetModules();
    const execute = vi.fn(async () => [{ "?column?": 1 }]);
    vi.doMock("@/db/client", () => ({ getDb: () => ({ execute }), dbConfigured: () => true, closeDb: async () => {} }));
    expect((await get()).body).toEqual({ ok: true, runtimeCache: "memory", db: "ok" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("keep-awake cron (vercel.json)", () => {
  it("one daily cron hitting /api/health, nothing else in the file", async () => {
    const { readFileSync } = await import("node:fs");
    const v = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(v.crons).toEqual([{ path: "/api/health", schedule: expect.stringMatching(/^\d+ \d+ \* \* \*$/) }]);
    expect(Object.keys(v).filter((k) => k !== "$schema")).toEqual(["crons"]);
  });
});
