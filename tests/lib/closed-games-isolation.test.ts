/**
 * #39: only the accuse route and /api/health may reach the database. Interrogate, confront, investigate and hints
 * neither import the DB code (static import graph) nor call it (runtime, with the DB client mocked to fail loudly).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const getDb = vi.fn(() => {
  throw new Error("a non-accuse route touched the database");
});
vi.mock("@/db/client", () => ({ getDb, dbConfigured: () => true, closeDb: async () => {} }));

const ROOT = resolve(__dirname, "../..");
const DB_MODULE = /(^|\/)(db\/(client|schema)|lib\/closed-games)\.ts$/;
const DB_PACKAGE = /^(postgres|drizzle-orm|drizzle-kit|@electric-sql\/pglite)(\/|$)/;

/** Every file (and bare package) reachable from `entry` through static and dynamic imports. */
function importGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/gm)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(file), spec) : null;
      if (!base) {
        packages.add(spec);
        continue;
      }
      const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((p) => existsSync(p) && !p.endsWith("/"));
      if (hit && /\.(ts|tsx)$/.test(hit)) visit(hit);
    }
  };
  visit(entry);
  return { files, packages };
}

const NON_ACCUSE = ["interrogate", "confront", "investigate", "hint"];

describe("#39 DB isolation", () => {
  it.each(NON_ACCUSE)("/api/%s imports no DB module or driver (static graph)", (route) => {
    const { files, packages } = importGraph(join(ROOT, `app/api/${route}/route.ts`));
    expect(files.size).toBeGreaterThan(5); // the walk really followed the imports
    expect([...files].map((f) => f.slice(ROOT.length + 1)).filter((f) => DB_MODULE.test(f))).toEqual([]);
    expect([...packages].filter((p) => DB_PACKAGE.test(p))).toEqual([]);
  });

  it("the accuse route and /api/health DO reach it (the walk can see it)", () => {
    for (const route of ["accuse", "health"]) {
      const { files } = importGraph(join(ROOT, `app/api/${route}/route.ts`));
      expect([...files].some((f) => f.endsWith("lib/closed-games.ts")), route).toBe(true);
    }
  });

  it.each(NON_ACCUSE)("/api/%s makes no DB call at runtime", async (route) => {
    const mod = (await import(`@/app/api/${route}/route`)) as { POST: (r: Request) => Promise<Response> };
    const bodies = [{}, { caseId: "blackwood" }, { caseId: "blackwood", characterId: "victoria", question: "Hello?", locationId: "library", characterIds: ["victoria", "archibald"] }];
    for (const b of bodies) {
      const res = await mod.POST(new Request(`http://t/api/${route}`, { method: "POST", body: JSON.stringify(b) }));
      expect(res.status).toBeLessThan(600);
    }
    expect(getDb).not.toHaveBeenCalled();
  });
});
