# WHODUNIT?!

An AI-powered cartoon murder mystery. The game engine is truth; AI is performance.

## Stack
Next.js (App Router) · React · strict TypeScript · Tailwind · Framer Motion · Zod · Vitest

## Scripts
- `npm run dev` – dev server
- `npm run build` – production build
- `npm test` – vitest
- `npm run typecheck` – `tsc --noEmit`
- `npm run validate:case -- <caseId>` – validate a case folder (see docs/CASE_FORMAT.md)
- `npm run sync:assets` – copy assets/ to public/assets/ (runs automatically before dev/build)

## Environment
Copy `.env.example` to `.env.local` and set `XAI_API_KEY`. Never commit real keys.

## Layout
- `engine/` – deterministic game engine, Zod schemas (`types.ts`), server-only `solution.ts`, constants
- `ai/` – LLM output schemas (`schemas.ts`) and prompts
- `cases/` – authored case content
- `app/api/{interrogate,confront,accuse}` – API routes
- `components/` – UI
- `tests/` – vitest suites (fixture case in tests/fixtures/cases)

See docs/ARCHITECTURE.md, docs/CASE_FORMAT.md and docs/ART_BIBLE.md.
