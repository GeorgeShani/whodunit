/**
 * Copies assets/ -> public/assets/ so Next.js can serve them at /assets/...
 * assets/ is the source of truth (committed); public/assets/ is generated and
 * gitignored. Runs automatically via the `predev` and `prebuild` npm hooks,
 * so it also runs on Vercel (which executes `npm run build`).
 */
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "assets");
const dest = path.join(root, "public", "assets");

async function main() {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(src, dest, {
    recursive: true,
    // Docs (README/LICENSES .md) stay out of the public bundle.
    filter: (p) => path.basename(p) !== ".gitkeep" && !p.endsWith(".md"),
  });
  console.log(`[sync-assets] copied assets/ -> public/assets/`);
}

main().catch((e) => {
  console.error(`[sync-assets] failed: ${(e as Error).message}`);
  process.exit(1);
});
