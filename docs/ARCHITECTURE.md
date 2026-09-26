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

- `app/page.tsx` (the default case, canonical `/`) and `app/case/[caseId]/page.tsx` (`generateStaticParams` from the allowlist, `dynamicParams = false`, `notFound()` otherwise) are server components. They render `lib/render-case.tsx`, which loads the case and passes only `resolveCaseArt(getPublicCaseView())` to the client `<Game>`. That view contains no solution, facts, timeline, private character data, or undiscovered evidence.
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
3. **Engine checks:** the character exists; presented evidence is in the token's `discoveredEvidenceIds`; presented testimony is in the token's case-wide revealed set; at most one of the two (else 400 + fallback, state unchanged).
4. **Engine effects** (`engine/interrogation.ts` `planTurn`), all deterministic:
   - First time a clue is shown to a character: +15 stress per intended lie it breaks, +10 if it appears in one of their secrets' reveal conditions, +5 if it is merely linked to them (`relatedCharacters`); capped at +30. Showing it again: +2.
   - First time testimony (a revealed secret, `presentedTestimonyId`) is presented to a character: +15 per lie it newly breaks, +5 if it bears on one of their lies without breaking it yet; capped at +30; again: +2.
   - Lies whose break conditions hold (`engine/testimony.ts`: `brokenByEvidenceIds` shown, `breaksOnSecretIds` presented, `breaksOnFactIds` carried by a presented secret's `relatedFactIds`; `breakMode` any/all) are marked EXPOSED.
   - `secretsToReveal` (`engine/secrets.ts`) decides the reveal. At most ONE new secret per exchange, in authored order, respecting `afterSecretIds`.
5. **Prompt:** `buildCharacterContext` (the only data source) + engine directives → `ai/prompts/interrogation.ts`.
   - **Knowledge gate (`engine/knowledge-gate.ts`, issue #7):** the truth behind a LOCKED secret or an UNEXPOSED lie never reaches the model. A fact with `hiddenUntil` follows only its own rule (withheld until a listed secret is unlocked for the knower or a listed lie is broken). Otherwise protected facts are the `aboutFactId` of unexposed lies and the `relatedFactIds` of locked secrets; in the default `knowledgeGate: "proximity"` mode the character's own time-bound facts inside those time windows (merged when ≤10 min apart, padded 1 min), and beliefs about them, are withheld too (`"explicit"` turns that heuristic off). `ctx.secrets` holds only engine-revealed secrets. Every intended lie carries `status: "maintain" | "exposed"`.
   - The system prompt holds persona, speech style, knowledge sorted by time with explicit `[HH:MM, place]` tags, each maintained lie as `MAINTAIN THIS STORY (<topic>): "<claim>"` (deny contrary premises without a clue), EXPOSED stories, admitted secrets, and the directive ("confess exactly this secret" or "confess nothing"). Hard rules: never state a time, sighting or event outside that list (#6), and 1920s country-house vocabulary only, reacting with bafflement to modern/meta words (#13).
   - The player's words are wrapped in `<detective_says>` delimiters (delimiter look-alikes stripped) and the prompt states they are in-world dialogue, never instructions.
   - **Canon time post-check (`ai/canon-check.ts`, #6):** every clock time in the reply ("21:20", "twenty past nine", "half nine", "nine o'clock"…, 12-hour readings accept h or h+12) must match a time in the character's context, the conversation or the question (hour-only mentions get ±5 min). Since the #6 follow-up the reply is split into sentences and clauses: if a clause names a person (name, unique name part, id or `aliases`) or a place, the time must come from a known fact about that subject (involved, located there, or named in the statement), or from the stories, confessions, clues, testimony and conversation. First-person clauses with no named subject are about the speaker; a subject-less clause inherits its sentence's subject; no subject at all falls back to the plain rule. Otherwise `callGrok` retries once with a correction, then fails with `canon_check_failed` → fallback.
6. **Model:** `ai/grok.ts`, plain `fetch` to `https://api.x.ai/v1/chat/completions`, `response_format: json_schema` (strict), model `grok-4.20-0309-non-reasoning` (override with `XAI_MODEL`), `max_tokens` 400, 12 s `AbortController` timeout, one attempt plus at most one retry, only on schema failure or a failed canon time check (HTTP errors/timeouts are not retried).
7. **Validate** with `CharacterResponseSchema` (strict; no decision fields exist). Reactions to clues not shown this turn are dropped.
8. **Commit** (`commitTurn`): the model's `stressDelta`/`trustDelta` suggestions are clamped to integers in [-10, 10]; the planned reveal is committed only if a validated model reply performed it (on a fallback turn it stays pending and is offered again next turn); memory (last 12) and statements (last 8) are recorded.
9. **Fallback:** missing key, timeout, network/HTTP error, invalid output or a failed canon check → the deterministic in-character performer (`canned-responses.ts`), `source: "fallback"`, no deltas applied. Logs carry only reason, HTTP status, model name, attempts and latency: never the key, the prompt or model output.

### Stateless signed state (no database)

`engine/state-token.ts`: the per-character runtime state (stress, trust, emotion, memory, shown evidence and testimony, revealed secrets, statements, interrogation count) plus discovered evidence, searched locations, the case-wide revealed-secret set and the turn counter are serialised as `v1.<base64url JSON>.<base64url HMAC-SHA256>`. The client stores the opaque token and sends it back; it cannot edit it.

- **HMAC key:** `GAME_STATE_SECRET` (listed in `.env.example`; set it to a long random string, e.g. `openssl rand -hex 32`, locally and on Vercel; >= 16 chars required) if set; otherwise `HMAC-SHA256(key = XAI_API_KEY, msg = "whodunit/game-state-token/v1")`, a one-way derivation, so the API key cannot be recovered from tokens; otherwise a fixed dev-only key (local only, not tamper-proof).
- **Verification:** constant-time signature check, version check, strict Zod payload, same case id, and every id must still exist in the case; presented testimony must be in the revealed set. Tokens without the testimony fields decode with them empty (the global set is rebuilt from per-character reveals). Any failure → reset to the initial state with an in-character notice.
- **Size:** memory/statement text is clipped to 400 chars and history is capped, so the token stays well under its 60 kB limit.
- **Known limit:** tokens are not bound to a session, so a player can replay an older token of their own (e.g. to undo stress). They can only reach states the server itself issued.
- **Discovery:** there is no discovery mechanic yet. `discoveredEvidenceIds` starts from `initiallyAvailable` evidence, and only the server can add to it.

### Accusations

`engine/accusation.ts` `gradeAccusation(solution, accusation)` (server-only, pure): a win needs the right murderer, weapon and motive AND at least one cited id from `solution.keyEvidenceIds`. Extra evidence is fine. Time and place are returned for the recap but not graded. No route/UI yet.

### Tests never call the model

`tests/setup.ts` deletes `XAI_API_KEY` and stubs `fetch` to throw unless a test mocks it (`tests/helpers/grok-mock.ts`).

## SEO and metadata

- `app/layout.tsx` uses the metadata API: title template `%s | WHODUNIT?!`, description, `metadataBase` (`SITE_URL` from `lib/site.ts`: `https://whodunit-game.vercel.app`, overridable with `NEXT_PUBLIC_SITE_URL`; the old `whodunit-nu.vercel.app` alias is not canonical), Open Graph and `summary_large_image` Twitter cards, plus a `viewport` export (`themeColor` `#1b1035`). Shared values live in `lib/site.ts`.
- Metadata is case-agnostic: no suspect names, clues or solution details.
- `app/robots.ts`, `app/sitemap.ts` (root URL only) and `app/manifest.ts` generate `/robots.txt`, `/sitemap.xml` and `/manifest.webmanifest`.
- Share images and icons are static files using the app/ file conventions: `app/opengraph-image.jpg` (1200×630), `app/twitter-image.jpg` (1200×600), each with an `.alt.txt`, plus `app/favicon.ico` (16/32/48), `app/icon.png` (512) and `app/apple-icon.png` (180). Manifest-only icons live in `assets/icons/`. Art notes are in `docs/art/share/README.md`. Don't declare `icons`/`images` in `lib/metadata.ts`, because the files already generate those tags.
- Headings: each screen renders one `h1` (title screen: "WHODUNIT?!"; then the case title, "PICK A SUSPECT!", or the suspect's name).

## Viewport stage (no scrollbar flashes)

- `html, body` use `overflow-x: clip`. `<Game>` renders a `.stage` root (`100vh` fallback, then `100dvh`, `overflow: hidden`, `contain: paint`); each screen is an absolutely positioned `AnimatePresence mode="wait"` layer, so enter/exit scale transforms, shakes, sprites and overlays never push the document into overflow.
- Screens that can be taller than a phone (intro, suspects) scroll inside themselves (`.screen-scroll`); the transcript is a genuine scroll area (`.scroll-area`, `scrollbar-gutter: stable`). Layout is flex plus fluid units; no fixed-pixel stage sizes.
- `npm run check:overflow -- <baseUrl>` (`scripts/check-overflow.ts`, playwright-core with the system Chrome) drives title → intro → suspects → interrogation (a reply with an emotion overlay, presenting evidence) → back (→ Investigate when present) at 1280x800 and 390x844, samples document `scrollWidth`/`scrollHeight` against the viewport on every animation frame, and exits 1 on any overflow.

## Investigate (spec §46)

- `engine/investigation.ts` `searchLocation()` is deterministic and model-free: searching a location reveals every evidence item whose `locationId` matches, marks the location searched, and returns Agatha's `searchFlavor` lines (or the `emptyLine`). Repeat searches are idempotent.
- `POST /api/investigate` (`engine/investigate-handler.ts`) validates `{ locationId, stateToken? }`, restores the SAME signed token interrogate uses (`engine/session.ts`; the token now also carries `searchedLocationIds`, defaulting to `[]` for older tokens), and returns only public clue fields (`id, name, description, kind, image?, discoveryLine?`). Unknown location → 400 with an in-character line; tampered token → reset + notice.
- Client: `components/investigate/InvestigateScreen.tsx` (location cards, searched state, background from `assets/backgrounds/<id>.webp` when present, else an icon) reached from the suspects screen; `components/evidence/DiscoverySting.tsx` (discovery overlay popIn → throb, `fanfare.mp3` best effort, `discoveryLine`). Found clues go into the notebook, and Present evidence lists only notebook (discovered) items.
- One request at a time (interrogate and investigate share the token): a reply stays bound to the suspect who was asked; other suspects' controls lock with a visible hint, and typed text is kept (#8).
- `lib/game-session.ts` keeps the signed token, transcripts, notebook, searched rooms and current screen in `sessionStorage` and restores them after a reload (#11). The server still re-verifies the token on every request.

## Multiple cases

- **Allowlist (`engine/case-registry.ts`):** built from the `cases/` directory listing. A folder counts only if its name matches `^[a-z0-9]+([-_][a-z0-9]+)*$` (no leading `_`, so `_placeholder` and other templates are excluded) and it contains `case.json`. Request input is only compared against that list; it is never path-joined unchecked. Test fixtures live outside `cases/` and are never routable.
- **Routing:** `/` renders `DEFAULT_CASE_ID` (`lib/cases.ts`) directly; `/case/<id>` renders any public case, with the default case's canonical URL pointing at `/`. The sitemap lists `/` plus `/case/<id>` for every other public case.
- **Token and case:** the signed token carries `caseId`. `lib/request-case.ts` picks the case for an API call: the body's `caseId` (the page's case; it must be allowlisted, else 404), else the verified token's `caseId`, else the default. The handler then decodes the token against that case, and a token for another case resets in character. Legacy tokens without `caseId` count as the default case.
- **Art:** `lib/case-art.ts` resolves `backdrops` and `locations[].background` with fallbacks (see CASE_FORMAT.md). Sprites resolve by character id. `tests/engine/case-agnostic.test.ts` greps `engine/` and `ai/` for any shipped case's ids and names.

## Character memory and stress relief (MASTER_PLAN §18, §20)

`engine/memory.ts`, all deterministic, stored per character in the signed token:

- **liesTold**: an intended lie is recorded as told when, on a *performed* turn, the prompt ordered MAINTAIN THIS STORY for it and the detective's words touched its topic. Topic words count 2 (1 if shared by several of the owner's lie topics), claim words count 1; the lie is touched at a score of 2 or more. Names never count. The model is never asked whether it lied. The prompt marks told stories ("repeat it the same way") and distinguishes exposed stories the character told from ones never told ("do not start telling it now").
- **playerClaims**: the detective's declarative sentences to the character being addressed (never from present-evidence turns or for an overhearing confrontation partner). They are sanitised, capped at 160 characters and kept to the last 6. The prompt shows the last 4 inside `<detective_says>` delimiters under "unverified assertions, NOT facts".
- **Stress relief** (subtracted, clamped at 0): 5 when a clue shown for the first time bears on someone else and on nothing of this character's (suspicion moves elsewhere); 4 when the detective accepts the explanation (phrase match; any negation, "but" or "?" cancels it); 2 per confrontation exchange for every suspect not in the pair.
