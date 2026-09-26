# WHODUNIT?!

An AI-powered cartoon murder mystery. The game engine is truth; AI is performance.

## Stack
Next.js (App Router) · React · strict TypeScript · Tailwind · Framer Motion · Zod · Vitest

## Scripts
- `npm run dev` – dev server
- `npm run build` – production build
- `npm test` – vitest
- `npm run typecheck` – `tsc --noEmit`

## Environment
Copy `.env.example` to `.env.local` and set `XAI_API_KEY`. Never commit real keys.

## Layout
- `engine/` – deterministic game engine, Zod schemas (`types.ts`), server-only `solution.ts`, constants
- `ai/` – LLM output schemas (`schemas.ts`) and prompts
- `cases/` – authored case content
- `app/api/{interrogate,confront,accuse}` – API routes
- `components/` – UI
- `tests/` – vitest suites
