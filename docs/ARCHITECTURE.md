# Architecture notes

## Truth vs performance

- `engine/` is truth. It holds the schemas (`types.ts`, `case-schema.ts`), the server-only `solution.ts`, the secret reveal rules (`secrets.ts`), the per-exchange engine step (`interrogation.ts`), accusation grading (`accusation.ts`, server-only), the signed state token (`state-token.ts`, server-only), the loader (`case-loader.ts`, which uses fs and is server-only), the referential checks (`case-validation.ts`), the runtime state (`game-state.ts`), the public projection (`public-view.ts`) and the context builder.
- `ai/` is performance. It holds the LLM output schema (`schemas.ts`), the request/response contract (`interrogate-schema.ts`), the prompts (`prompts/interrogation.ts`), the xAI client (`grok.ts`), the request orchestration (`interrogate-handler.ts`) and the in-character fallback performer (`canned-responses.ts`).
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
- `POST /api/interrogate` receives `{ characterId, question (<= 500 chars), presentedEvidenceId?, stateToken? }` and returns `{ response, source: "model" | "fallback", stateToken, notice?, error? }`. See "Live interrogation" below.

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

## Live interrogation (Phase 3)

Golden rule: **the engine is truth, the AI is performance.** The model never decides the murderer, weapon, location, time, evidence, reveals or win state, and never sees the solution.

One exchange (`ai/interrogate-handler.ts`):

1. **Validate** the request with Zod (strict; question capped at 500 chars).
2. **Restore state** from the signed token (below). No token = new game. A bad token resets to the initial state and returns an in-character `notice` ("the notebook blew out of the window").
3. **Engine checks:** the character exists; presented evidence is in the token's `discoveredEvidenceIds` (else 400 + fallback, state unchanged).
4. **Engine effects** (`engine/interrogation.ts` `planTurn`), all deterministic:
   - First time a clue is shown to a character: +15 stress per intended lie it breaks, +10 if it appears in one of their secrets' reveal conditions, +5 if it is merely linked to them (`relatedCharacters`); capped at +30. Showing it again: +2.
   - Lies whose `brokenByEvidenceIds` have been shown are marked EXPOSED.
   - `secretsToReveal` (`engine/secrets.ts`) decides the reveal. At most ONE new secret per exchange, in authored order, respecting `afterSecretIds`.
5. **Prompt:** `buildCharacterContext` (the only data source) + engine directives → `ai/prompts/interrogation.ts`. The system prompt holds persona, speech style, knowledge boundaries, hidden secrets, lies to maintain / exposed lies, and the directive ("confess exactly this secret" or "confess nothing"). The player's words are wrapped in `<detective_says>` delimiters (delimiter look-alikes stripped) and the prompt states they are in-world dialogue, never instructions.
6. **Model:** `ai/grok.ts`, plain `fetch` to `https://api.x.ai/v1/chat/completions`, `response_format: json_schema` (strict), model `grok-4.20-0309-non-reasoning` (override with `XAI_MODEL`), `max_tokens` 400, 12 s `AbortController` timeout, one attempt plus at most one retry and only on schema failure (HTTP errors/timeouts are not retried).
7. **Validate** with `CharacterResponseSchema` (strict; no decision fields exist). Reactions to clues not shown this turn are dropped.
8. **Commit** (`commitTurn`): the model's `stressDelta`/`trustDelta` suggestions are clamped to integers in [-10, 10]; the planned reveal is committed only if a validated model reply performed it (on a fallback turn it stays pending and is offered again next turn); memory (last 12) and statements (last 8) are recorded.
9. **Fallback:** missing key, timeout, network/HTTP error or invalid output → the deterministic in-character performer (`canned-responses.ts`), `source: "fallback"`, no deltas applied. Logs carry only reason, HTTP status, model name, attempts and latency: never the key, the prompt or model output.

### Stateless signed state (no database)

`engine/state-token.ts`: the per-character runtime state (stress, trust, emotion, memory, shown evidence, revealed secrets, statements, interrogation count) plus discovered evidence and the turn counter are serialised as `v1.<base64url JSON>.<base64url HMAC-SHA256>`. The client stores the opaque token and sends it back; it cannot edit it.

- **HMAC key:** `GAME_STATE_SECRET` (listed in `.env.example`; set it to a long random string, e.g. `openssl rand -hex 32`, locally and on Vercel; >= 16 chars required) if set; otherwise `HMAC-SHA256(key = XAI_API_KEY, msg = "whodunit/game-state-token/v1")`, a one-way derivation, so the API key cannot be recovered from tokens; otherwise a fixed dev-only key (local only, not tamper-proof).
- **Verification:** constant-time signature check, version check, strict Zod payload, same case id, and every id must still exist in the case. Any failure → reset to the initial state with an in-character notice.
- **Size:** memory/statement text is clipped to 400 chars and history is capped, so the token stays well under its 60 kB limit.
- **Known limit:** tokens are not bound to a session, so a player can replay an older token of their own (e.g. to undo stress). They can only reach states the server itself issued.
- **Discovery:** there is no discovery mechanic yet. `discoveredEvidenceIds` starts from `initiallyAvailable` evidence, and only the server can add to it.

### Accusations

`engine/accusation.ts` `gradeAccusation(solution, accusation)` (server-only, pure): a win needs the right murderer, weapon and motive AND at least one cited id from `solution.keyEvidenceIds`. Extra evidence is fine. Time and place are returned for the recap but not graded. No route/UI yet.

### Tests never call the model

`tests/setup.ts` deletes `XAI_API_KEY` and stubs `fetch` to throw unless a test mocks it (`tests/helpers/grok-mock.ts`).

## SEO and metadata

- `app/layout.tsx` uses the metadata API: title template `%s | WHODUNIT?!`, description, `metadataBase` (`https://whodunit-nu.vercel.app`), Open Graph and `summary_large_image` Twitter cards, plus a `viewport` export (`themeColor` `#1b1035`). Shared values live in `lib/site.ts`.
- Metadata is case-agnostic: no suspect names, clues or solution details.
- `app/robots.ts`, `app/sitemap.ts` (root URL only) and `app/manifest.ts` generate `/robots.txt`, `/sitemap.xml` and `/manifest.webmanifest`.
- Share images and icons are static files using the app/ file conventions: `app/opengraph-image.jpg` (1200×630), `app/twitter-image.jpg` (1200×600), each with an `.alt.txt`, plus `app/favicon.ico` (16/32/48), `app/icon.png` (512) and `app/apple-icon.png` (180). Manifest-only icons live in `assets/icons/`. Art notes are in `docs/art/share/README.md`. Don't declare `icons`/`images` in `lib/metadata.ts`, because the files already generate those tags.
- Headings: each screen renders one `h1` (title screen: "WHODUNIT?!"; then the case title, "PICK A SUSPECT!", or the suspect's name).
