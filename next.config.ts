import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Which clue illustrations exist (assets/evidence/<id>.webp or assets/evidence/<caseId>/<id>.webp), decided when the
 * app is built/started so the client never requests a missing file. Read by lib/clue-art.ts. Adding a file needs a
 * new build (Vercel does that on deploy) or a dev-server restart.
 */
function clueArtFiles(): string {
  const root = path.join(process.cwd(), "assets", "evidence");
  if (!existsSync(root)) return "";
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".webp")) out.push(entry.name.slice(0, -5));
    else if (entry.isDirectory()) {
      for (const f of readdirSync(path.join(root, entry.name))) if (f.endsWith(".webp")) out.push(`${entry.name}/${f.slice(0, -5)}`);
    }
  }
  return out.sort().join(",");
}

const nextConfig: NextConfig = {
  // Case JSON is read from disk at request time by API routes; make sure the
  // files ship with the serverless functions on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./cases/**/*.json"],
  },
  env: { NEXT_PUBLIC_CLUE_ART: clueArtFiles() },
};

export default nextConfig;
