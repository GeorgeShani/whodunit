import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/cases");
export const FIXTURE_ID = "fixture-manor";

/** Copy the valid fixture into a temp cases dir so a test can break it. */
export async function makeBrokenCopy(
  mutate: (edit: (file: string, fn: (json: any) => void) => Promise<void>, dir: string) => Promise<void>,
): Promise<{ casesDir: string; cleanup: () => Promise<void> }> {
  const casesDir = await mkdtemp(path.join(os.tmpdir(), "whodunit-case-"));
  const dir = path.join(casesDir, FIXTURE_ID);
  await cp(path.join(FIXTURES_DIR, FIXTURE_ID), dir, { recursive: true });
  const edit = async (file: string, fn: (json: any) => void) => {
    const p = path.join(dir, file);
    const json = JSON.parse(await readFile(p, "utf8"));
    fn(json);
    await writeFile(p, JSON.stringify(json));
  };
  await mutate(edit, dir);
  return { casesDir, cleanup: () => rm(casesDir, { recursive: true, force: true }) };
}
