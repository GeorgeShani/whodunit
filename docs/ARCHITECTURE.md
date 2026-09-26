# Architecture notes

## Truth vs performance

- `engine/` is truth. It holds the schemas (`types.ts`, `case-schema.ts`), the server-only `solution.ts`, the secret reveal rules (`secrets.ts`), the loader (`case-loader.ts`, which uses fs and is server-only), the referential checks (`case-validation.ts`), the runtime state (`game-state.ts`), the public projection (`public-view.ts`) and the context builder.
- `ai/` is performance. It holds the LLM output schema (`schemas.ts`), the request schema (`interrogate-schema.ts`) and the Phase-1 canned performer (`canned-responses.ts`). The canned performer gets swapped for Grok later.
- `engine/index.ts` is a barrel that is safe to use on the client. It deliberately leaves out `solution.ts` and `case-loader.ts`.

## Context builder location (decision)

The spec asked for `ai/context-builder.ts`.

- **Where it lives:** the implementation is in **`engine/context-builder.ts`**. It is a deterministic projection of engine truth (what one character is allowed to know), so it belongs with the engine and its tests.
- **Spec path still works:** `ai/context-builder.ts` re-exports it, so `import { buildCharacterContext } from "@/ai/context-builder"` works as written in the spec.
- **Tests:** `tests/engine/context-builder.test.ts` deep-scans the output to confirm none of these leak:
  - the solution;
  - other characters' secrets, beliefs or facts;
  - undiscovered or unshown evidence.

## Client/server split

- `app/page.tsx` is a server component. It loads the active case and passes only `getPublicCaseView()` to the client `<Game>`. That view contains no solution, facts, timeline, private character data, or undiscovered evidence.
- `POST /api/interrogate` receives only `{ characterId, action, turn }` and resolves everything else on the server. It returns only a validated `CharacterResponse`. Every failure returns the in-character fallback.
- **No persistence yet:** each request rebuilds state from the case's initial state. As a result, only initially available evidence can be presented. Sessions come later, with no database per the project rules.
- **Vercel file tracing:** `next.config.ts` sets `outputFileTracingIncludes` so `cases/**/*.json` ships with the API functions on Vercel.

## Assets pipeline

- **Source of truth:** `assets/` (committed; Toon owns `assets/characters`, `assets/effects` and `assets/audio`).
- **Serving:** `scripts/sync-assets.ts` copies `assets/` → `public/assets/`, leaving out `.md` and `.gitkeep`.
  - It runs through the npm `predev` and `prebuild` hooks, so it also runs on Vercel, which calls `npm run build`.
  - `public/assets/` is generated and gitignored. Browser URLs are `/assets/...`.
- **Sprites:** `assets/characters/<id>/<pose>.webp`. The canvas is 784×1224, sprites face LEFT, and feet sit on a shared baseline.
  - `components/characters/portrait-poses.ts` maps the 13 engine emotions to Toon's 7 poses.
  - `components/characters/sprite-meta.ts` reads `anchors.json` and `effects.json`, and implements overlay placement from ART_BIBLE §5, including mirroring (anchor x, offset x, pivot x and the overlay image all flip).
  - `components/characters/Portrait.tsx` applies `docs/toonMotion.ts`: sprite variants per pose, plus emotion overlays that play an intro and then a loop. It shows the `talking` pose while a line is delivered.
