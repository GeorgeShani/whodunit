/**
 * #39 / saved games: `closed_games` is only imported by /api/accuse, /api/health and /api/resume.
 * State-changing routes may import `saved_games` / `db/client` (saves are best-effort and must not throw).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const getDb = vi.fn(() => {
  throw new Error("a non-accuse route touched the database");
});
vi.mock("@/db/client", () => ({ getDb, dbConfigured: () => true, closeDb: async () => {} }));

const ROOT = resolve(__dirname, "../..");
const CLOSED_MODULE = /(^|\/)lib\/closed-games\.ts$/;
const SAVED_OR_DB = /(^|\/)(db\/(client|schema)|lib\/saved-games)\.ts$/;

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

const NON_CLOSED = ["interrogate", "confront", "investigate", "hint"];

describe("#39 / saved-games DB isolation", () => {
  it.each(NON_CLOSED)("/api/%s imports no closed_games module (static graph)", (route) => {
    const { files } = importGraph(join(ROOT, `app/api/${route}/route.ts`));
    expect(files.size).toBeGreaterThan(5);
    expect([...files].map((f) => f.slice(ROOT.length + 1)).filter((f) => CLOSED_MODULE.test(f))).toEqual([]);
  });

  it.each(NON_CLOSED)("/api/%s may reach saved_games / the db client (saves are best-effort)", (route) => {
    const { files } = importGraph(join(ROOT, `app/api/${route}/route.ts`));
    expect([...files].some((f) => SAVED_OR_DB.test(f)), route).toBe(true);
  });

  it("the accuse route, /api/health and /api/resume DO reach closed_games", () => {
    for (const route of ["accuse", "health", "resume"]) {
      const { files } = importGraph(join(ROOT, `app/api/${route}/route.ts`));
      expect([...files].some((f) => f.endsWith("lib/closed-games.ts")), route).toBe(true);
    }
  });

  it.each(NON_CLOSED)("/api/%s still answers if getDb throws (saves must not break play)", async (route) => {
    const mod = (await import(`@/app/api/${route}/route`)) as { POST: (r: Request) => Promise<Response> };
    const bodies = [{}, { caseId: "blackwood" }, { caseId: "blackwood", characterId: "victoria", question: "Hello?", locationId: "library", characterIds: ["victoria", "archibald"] }];
    for (const b of bodies) {
      const res = await mod.POST(new Request(`http://t/api/${route}`, { method: "POST", body: JSON.stringify(b) }));
      expect(res.status).toBeLessThan(600);
    }
  });
});
