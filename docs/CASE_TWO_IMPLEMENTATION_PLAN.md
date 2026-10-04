# Case two (S.S. Tallyho): implementation plan

| | |
|---|---|
| **Status** | **Plan for George to approve. Nothing here is implemented.** Docs-only PR. **Revision 3:** decisions from George and Agatha recorded (section "Decisions made"); earlier revision 2 rebased on the built progression system and the authoring guide. |
| **Branch** | `docs/case-two-plan` (base `main` at `5cdc9d4`; it includes progression `5831a5e..4709822`, the UI `5610094`, the Blackwood progression data #36 and `docs/CASE_AUTHORING.md` #35) |
| **Inputs** | `docs/cases/TALLYHO_DESIGN.md` (#33), `docs/BLACKWOOD_PROGRESSION_PROPOSAL.md` (#32, now built), `docs/CASE_AUTHORING.md` (#35), `docs/CASE_FORMAT.md` ("Progression"), `docs/MASTER_PLAN.md`, `docs/ART_BIBLE.md`, `docs/SOUND_NOTES.md`, and the code under `engine/`, `ai/`, `components/`, `lib/`, `app/`, `scripts/`, `cases/`, `tests/` |
| **Direction** | WHODUNIT?! is a real public game. Favour robustness and polish over demo shortcuts. Case two ships only on George's signal. |
| **Spoilers** | This plan names Tallyho *mechanics* (a staged watch, a recording, a ship that changes its list) because the work depends on them. It does not name the culprits; it says "doer" and "stager". The full solution stays in `docs/cases/TALLYHO_DESIGN.md`. |

**Evidence base.** Every claim cites a file and function I read on `main` at `5cdc9d4`. Two numbers I measured with throw-away scripts at the earlier base `09e4962` (not committed): token size and prompt size (F5, F14). Progression added no token fields (its only `state-token.ts` change is the optional `keyTestimonyIds` on a stored accusation), so the token numbers still apply. Where something is a recommendation or an unmeasured estimate, it says so.

**What changed in revision 3.** Seven questions are now decided and moved to "Decisions made" (strict two-culprit grading and the always-asked helper picker, confrontation caps 4/16, unlock after solving Blackwood, Tallyho's setting and vocabulary, authority = the purser). The plan gains a small **case unlock** build item (3.8, phase 10), a rewritten `setting` block (4.4), and a check that the in-world authority is not a suspect.

**What changed in revision 2.** Progression is **built**, so it is no longer a prerequisite to build; it is done and listed under "Already built" (1.2). The plan now covers only what is still missing, plus Agatha's authoring needs: the second culprit, the authoring tooling and a single validator, and the per-case presentation gaps (theme, era text, order landmarks, clue-art resolver, per-case audio).

---

## 0. Summary for George (read this first)

**What case two still needs from the engine.** Progression (gated rooms and clues, leads, the accuse gate, key clues and key testimony) is **done**, and Blackwood already uses it (nine leads, fastest legal path 10 actions, `tests/cases/blackwood-progression.test.ts`). What is missing:

1. **A second culprit** in grading, the accusation, the endings and the validator.
2. **A "the clock lies" mechanic** (a staged watch and a recording) that the model cannot undermine, and a **ship-list proof** panel.
3. **A 6-suspect UI** and a confrontation system that works for 15 pairs.
4. **Per-case presentation:** era/voice text, a theme, order-of-events landmarks, a clue-art resolver and per-case audio. Today these are Blackwood's, hard-wired.
5. **Authoring tooling:** a scaffold command, one validator that catches everything (today the story checks live in Blackwood's tests), and a case-test template.

Plus three **robustness problems that would hurt case two specifically**: the signed state token can overflow its own 60,000-character cap with 6 suspects in a worst case and silently reset the game; the in-world wording is hard-wired to "an English country house in the 1920s"; and nothing stops a half-finished non-underscore case folder from going public.

**Key decisions (recommended; each is reversible until its PR merges)**

| # | Decision | Why |
|---|---|---|
| D1 | **Progression: DONE.** Remaining progression work is small: a `keyTestimonyGroups` option, making the simulator understand confrontations, and optional atoms (`lieBrokenIds`, testimony-triggered reveals). | Built in `engine/progress.ts`, `engine/progression-validation.ts`, `engine/route-progress.ts`, `components/progress/*`. |
| D2 | **DECIDED (Agatha): strict two-culprit grading via one optional field**: `solution.accompliceId` and `Accusation.accompliceId` (+ `accompliceAct`). Absent means "no one helped". A win needs doer **and** stager correct, in the right roles. | Smallest change; every existing case is unchanged (design G1, G3). |
| D3 | **DECIDED (Agatha): the "Did anyone help?" picker is always shown**, with an explicit "No one helped" answer, nothing preselected, and **Submit disabled until an answer is picked** (3.2). | An always-visible picker means a single-culprit case does not tip off that a case has an accomplice. |
| D4 | **Data first, code only when data cannot express it.** Optional fields need no declaration. Code lives in **feature modules** a case opts into with `"features": [...]` in `case.json`. Two for case two: `time-misdirection`, `ship-list`. | A future case is storytelling, art, animation and sound, not engineering (section 4). |
| D5 | **Drafts use the existing `_` prefix; publishing is gated.** `engine/case-registry.ts` already never serves a folder whose name starts with `_` (`PUBLIC_CASE_ID_RE`), and `docs/CASE_AUTHORING.md` already says to build under `_<caseId>`. What is missing is a **gate on the rename**: CI runs `validate:case --strict` (zero warnings, simulation, smoke) on every non-underscore case, so a bad case cannot go public. No new `status` field. | Reuses what exists. |
| D6 | **State token goes to `v2`** (dual-read first, then dual-write), with a per-case size budget that trims instead of resetting. | 6 suspects break the v1 cap in the worst case. |
| D7 | **DECIDED (George): case two caps confrontations at 4 per pair and 16 total.** The limits become per-case data (defaults stay 6 per pair / 12 total, so Blackwood is unchanged). | Cost is bounded by the *total*, not by the 15 pairs. |
| D8 | **Per-case presentation is data:** `setting` (place, decade, authority, vocabulary allowed/banned; **decided**, 4.4), `theme` (colours, title/logo), `orderLandmarks` (**decided** for Tallyho), `audio`, and an `Evidence.image` resolver. Defaults equal Blackwood's current values. | Section 4. |
| D9 | **One validator, one scaffold, one case-test template.** `npm run new:case -- <id>` copies `cases/_template`; the story checks in `tests/cases/blackwood.test.ts` move into the validator; `tests/cases/_template.test.ts` pins the rest. | Section 6.5. |
| D10 | **DECIDED (George): case two unlocks after the player solves Blackwood.** No case chooser. A client-side flag set on a Blackwood win, a case-level `unlockedBy` in `case.json`, a "Next case" button on the win screen, and a locked screen on a direct visit (3.8, phase 10). | Keeps the intended order and needs no accounts. The unlock is spoofable, which is fine: there are no stakes. |

**Rough size.** Remaining engineering is about **55 to 75 commits** across 10 phases (section 9), then Tallyho content, art, animation and sound. Phase 1 (progression) is done. The work is front-loaded: after phases 2 to 8 a new case should need no engineering.

**Decisions made** (George and Agatha; section "Decisions made" below): strict two-culprit grading with an always-asked helper picker; confrontation caps 4 per pair / 16 total; case two unlocks after solving Blackwood (no chooser); Tallyho's setting, vocabulary and authority (the purser).

**Open questions that still shape the build** (full list in section 10.2): Q3 whether confrontation exchanges count towards the talk gate (they do today); Q7 how far per-case theming (colours, logo) goes; Q8 to Q16 (token compression, `keyTestimonyGroups`, balance, analytics, assets, validator rollout, `publish:case`); and the new Q17 (an escape hatch for players who lose their browser storage).

## Decisions made (George and Agatha)

These were open questions in earlier revisions. Each is now a decision; the dependent sections have been updated.

| Was | Decision | By | Reason | Where it lands |
|---|---|---|---|---|
| Q1 | **Strict two-culprit grading.** The doer must be named as murderer and the stager as accomplice, in the right roles; swapping or naming only one loses. No "either order" mode is built. | Agatha | Each role is provable from different clues (design G1b), so a half-right accusation has not proved the case. | 3.1, `gradeAccusation` |
| Q2 | **The accuse screen always shows "Did anyone help?"** with an explicit **"No one helped"** answer. **Nothing is preselected and Submit stays disabled until an answer is picked.** | Agatha | An always-visible picker means a single-culprit case does not tip off that a case has an accomplice; the explicit answer prevents a silent default on a one-shot accusation (#22). | 3.2, `AccuseScreen`, `validateAccusationDraft` |
| Q4 | **Case-two confrontation caps are 4 per pair and 16 total** (at most 32 model calls). | George | Cost is bounded by the total, not by the number of pairs; 4 per pair stops one pair eating the budget. Blackwood keeps 6 / 12. | 3.6, `case.json confrontation`, R2 |
| Q5 | **Players unlock case two by solving Blackwood. There is no case chooser.** | George | Keeps the intended order (Blackwood teaches the game) and avoids building a chooser UI. | 3.8, phase 10, D10 |
| Q6 | **Tallyho is set in the summer of 1936 on a private steam yacht at sea in a storm.** A per-case `setting` block holds the place, the decade ("the 1930s"), and a vocabulary list: allowed words (disc, gramophone, wireless, telegraph, galley, purser) and banned words (phones, apps). It replaces the hard-coded `ERA_RULE`. The player stays "detective". | Agatha | Period voice must match the story; a yacht cannot say "constable" or "the house". | 4.4, `ai/prompts/interrogation.ts`, `ai/canon-check.ts` |
| Q6 | **The in-world authority is the purser**, a neutral, non-suspect, offstage figure; there are no police on board until port. The authority noun is a **per-case field**. | Agatha | The captain cannot be the authority because Captain Bilge is a suspect; "the constable" does not exist at sea. | 4.4, V32, `engine/session.ts` lines |
| Q6 | **The vocabulary check (the "telephone is not modern" rule from #26) reads the per-case list**, not a hard-coded one. | Agatha | Blackwood's "telephone is fine" exemption must not leak into, or block, another era. | 4.4, `ai/canon-check.ts` |
| Q6 | **`orderLandmarks` are per-case in `case.json`** for Tallyho: the storm, the wave at 22:14, the cheer at 22:38, the body found at 22:55. | Agatha | The order check only knows Blackwood's five landmarks today (F9), so it would be inert for Tallyho. | 4.4, `ai/order-check.ts`, V13 |
| Q7 | *Partly resolved by the Q6 decision:* the `setting` block (era, place, authority, vocabulary) is settled. **Theme colours / logo scope stays open** as the narrowed Q7. | Agatha | Her decision did not cover colours or title art. | 4.4, 10.2 |


---

## 1. What `main` does today (grounded)

### 1.1 Facts that drive the plan

| # | Fact (file / function) | Consequence for case two |
|---|---|---|
| F1 | **Progression is built.** `engine/progress.ts` (`evaluateCondition`, `leadStates`, `isUnlocked`, `accuseProgress`, `publicProgress`); `engine/progression-validation.ts` (`checkProgression`, `progressionWarnings`, `simulate`, `fastestPath`); `engine/route-progress.ts` (`attachProgress`); schema in `engine/types.ts` (`ConditionSchema`, `LeadSchema`, `AccuseGateSchema`, `requires` + `lockedLine` on `Location` and `Evidence`, `PublicLocation`); `engine/investigation.ts` `searchLocation` (state before the action, `lockedLine`, `locked`); `engine/accuse-handler.ts` (403 `accuse_locked`, `testimony_not_revealed`); UI in `components/progress/{LeadsPanel,CaseNotReady,NewLeadToast}.tsx`, `Notebook.tsx` (Evidence/Leads tabs), `InvestigateScreen.tsx` (padlocks), `SuspectSelect.tsx` ("questioned n/2", CASE NOT READY), `AccuseScreen.tsx` ("A confession" section). Blackwood uses it (#36). | **No progression build work is left** except the small extensions in 3.7. |
| F2 | Grading: `engine/accusation.ts` `gradeAccusation`: `won = murdererCorrect && weaponCorrect && motiveCorrect && hasKeyEvidence && hasKeyTestimony` (counts: `solution.minKeyEvidence`, `keyTestimonyIds`, `minKeyTestimony`). `AccusationSchema` (`engine/types.ts`) has one `murdererId`, `keyEvidenceIds` 1 to 5, optional `keyTestimonyIds` (max 3). `CaseSolutionSchema` (`engine/solution.ts`) has one `murdererId`. **There is no `accompliceId` anywhere in `engine/`, `ai/`, `components/`, `lib/`, `app/`, `scripts/` or `tests/`** (only in docs). | Two culprits are phase 5 (3.1). |
| F3 | Loss endings: `engine/ending-payload.ts` `lossBeats` uses `endings.wrong[accusedId]` unless the accused **is** `solution.murdererId`, and drops lines whose speaker is the real murderer. `buildEnding`'s default confession is spoken by `solution.murdererId`. `toVerdict` has `hasKeyTestimony` but no accomplice field. | With two culprits both rules must cover both ids, or a loss ending leaks who is guilty (#22). |
| F4 | Validator today: `engine/case-validation.ts` `checkCaseReferences` (ids, references, the murderer opportunity rule `wasPresent` / `OPPORTUNITY_WINDOW_MINUTES = 15`, "innocent needs a secret" is `ch.id !== s.murdererId`, `endings.wrong` covers every suspect) + `checkProgression` (unknown ids, cycles, reachability of rooms, clues, the gate and key evidence/testimony); `checkCaseWarnings` (reachability of secrets and lies, `progressionWarnings`); `fastestPath` (printed by `scripts/validate-case.ts`). **It does not check**: knowledge boundaries (who knew what), giveaway words in free text, public text naming a suspect, clock and order consistency, timeline presence, testimony-summary clock times, any accomplice rule. Those checks exist **only as Blackwood tests** (`tests/cases/blackwood.test.ts` "knowledge boundaries", "free text tells no secrets", "testimony", "order of events"; `blackwood-content.test.ts` "public flavour never names a suspect"). `validate-case.ts` exits 0 on warnings and treats missing art as a warning. | Move these into the validator (6.5). |
| F5 | Token: `engine/state-token.ts`: `TOKEN_VERSION = "v1"`; `verifiedPayload` rejects any other version; `TokenPayloadSchema` is `z.strictObject`; `STATE_LIMITS.tokenChars = 60_000`; a token over the cap is `malformed`, so `restoreSession` **resets the game**. **Measured** (throw-away script, Blackwood with synthetic full state): 4 suspects, typical (8 memory entries of 160 chars, 4 statements) = 17.5K chars, about 4.4K per suspect, so about 26K at 6; worst case (12 memory entries and 8 statements at 400 chars, 6 claims at 160) = 53.8K at 4, about 13.5K per suspect, so **about 81K at 6, above the 60K cap**. Real replies are usually shorter than 400 chars, so the worst case is synthetic, but the failure is a silent reset. | Token v2 plus a per-case budget (phase 4). |
| F6 | Confrontation: `engine/constants.ts` `MAX_CONFRONTATION_TURNS = 6` (per pair), `MAX_CONFRONTATION_TOTAL = 12`. The constants are baked into schemas: `ConfrontationStateSchema.turnsUsed`, `GameStateSchema.pairTurns`, `TokenPayloadSchema.pairTurns`. `ai/confront-handler.ts` makes **two sequential model calls** per exchange (and now `ai/confront-check.ts` scrubs repeats and stale partner names); `ai/grok.ts` `GROK_TIMEOUT_MS = 12_000` with one retry; `app/api/confront/route.ts` `maxDuration = 60`. The token allows `confrontedPairs` up to 20 (15 pairs fit). | 15 pairs; cost already capped by the total. Per-case limits need the schema ceilings loosened. |
| F7 | `engine/interrogation.ts` `commitTurn` bumps `characters[id].interrogationCount` for **every** committed turn, including both sides of a confrontation exchange. `fastestPath` models only searches, single exchanges and clue-cracks, **not confrontations**, so it cannot see this shortcut. A reveal commits only if a validated model reply performed it (`revealed = plan.revealSecretId !== null && out.performed`); on a fallback it stays pending. | (a) The talk gate can be partly met through confrontations (Q3); the simulator must model it. (b) A required secret can be delayed indefinitely by repeated canon failures (R6). |
| F8 | In-world wording is hard-coded: `ai/prompts/interrogation.ts` `ERA_RULE` ("an English country house in the 1920s", rule 7) and `Others in the house:`; `engine/session.ts` `CASE_CLOSED_LINE` / `CASE_CLOSED_SEARCH_LINE` ("constable", "house"); `engine/accuse-handler.ts` `ACCUSE_LINES` ("in this house"); `engine/investigate-handler.ts`; `ai/confront-handler.ts` `CONFRONT_LINES`; `engine/hints.ts` `NO_HINT_LINE`; `components/ending/EndScreen.tsx` ("The whole house is talking about you"); `components/evidence/Notebook.tsx` ("Investigate the house!"); `ai/canon-check.ts` `MODERN_WORDS`. | A yacht needs a `setting` block (phase 3). |
| F9 | **Order-of-events landmarks are Blackwood's.** `ai/order-check.ts` `LANDMARKS` has exactly five (lights go out, candles lit, the scream, body found, lights back), each with a hard-coded `say` and `fact` regex; `landmarksOf`, `orderLines` and `ORDER_RULE` feed the prompt (`ai/prompts/interrogation.ts`) and the canon check. Tallyho's landmarks (the Great Lurch, the storm, the horn, the cheer) are not recognised, so the order check is silently inert for it. | `orderLandmarks` as case data (4.4). |
| F10 | Other Blackwood leaks in shared code: `lib/case-art.ts` `ART_DEFAULTS.blackwood`; `lib/cases.ts` `DEFAULT_CASE_ID = "blackwood"` (used by `lib/request-case.ts` as the legacy default); `components/effects/audio-scenes.ts` `bedForScreen` returns only `rain_loop` / `bed_manor` / `bed_library`, and `components/effects/audio.ts` `BedName` is that union; `components/stage/layout.ts` `REFERENCE = "reginald"`; no `theme` field anywhere in `engine/case-schema.ts` or `engine/types.ts`. `tests/engine/case-agnostic.test.ts` scans only `engine/` and `ai/`. | Move to data; widen the scan (phase 3). |
| F11 | Publishing: `engine/case-registry.ts` `listPublicCaseIds` lists every folder under `cases/` whose name matches `PUBLIC_CASE_ID_RE` (**no leading `_`**) and that has a `case.json`; `CaseIdSchema` allows a leading `_` for internal cases. So `cases/_placeholder` and any `cases/_<id>` are never served, and the sitemap and `generateStaticParams` skip them (`tests/engine/case-registry.test.ts`, `tests/app/seo.test.ts`). Renaming to a plain id publishes instantly; **nothing validates at that moment**. There is no case chooser (`TitleScreen` has none; `/` is Blackwood). | Gate the rename in CI (D5); discovery is the decided unlock flow (3.8). |
| F12 | **Clue art has no resolver.** `Evidence.image` is `IdSchema` ("asset key") in `engine/types.ts`, but `components/evidence/Notebook.tsx` renders `<img src={e.image}>` directly (line ~192). No case sets `image`, so this path has never run, and `docs/CASE_AUTHORING.md` §6 says to leave it out. | Add a resolver (`/assets/clues/<id>.webp`) before Tallyho's 10 clue illustrations (phase 3). |
| F13 | Art is file-convention only: backgrounds `assets/backgrounds/<locationId>.webp` (global namespace, plus `_lightning` / `_window_mask`); sprites `assets/characters/<portrait ?? id>/<pose>.webp` (7 poses) that **must be listed** in the single shared `assets/characters/anchors.json` (statically imported by `components/characters/sprite-meta.ts`) or a silhouette shows. `scripts/validate-case.ts` only checks `backdrops.*` and `locations[].background` and only warns. | Asset checks as errors; collision checks (R10). |
| F14 | Prompt size is roughly constant per call: **measured** at Blackwood's initial state, system prompts are 9.3K to 12.5K chars (about 2.3K to 3.1K tokens) for 26 to 39 known facts per character (151 timeline entries total). `buildCharacterContext` (in `engine/context-builder.ts`, re-exported by `ai/context-builder.ts`) adds only `{ id, name, role, aliases }` per other suspect. The order rule (`ORDER_RULE`, `orderLines`) adds a few lines. | More suspects barely change per-call prompt size; cost scales with the number of *calls*, which the caps bound. |
| F15 | `next.config.ts` `outputFileTracingIncludes` ships `./cases/**/*.json` only. | New per-case data must be `.json` under `cases/<id>/` or it is missing on Vercel. Feature config lives in `case.json`. |
| F16 | **Resume works for progression.** `getPublicCaseView` now includes `progress: publicProgress(c, createInitialGameState(c))`; `components/game/Game.tsx` seeds from `view.progress`; `lib/game-session.ts` saves the last `progress` with the session (`isPublicProgress`). It is display data, recomputed by the server on every action. | The earlier idea of a `POST /api/progress` route is **dropped**. |
| F17 | Layout: `components/characters/SuspectSelect.tsx` grid is `grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-4`, and the mobile pass already made each card a **row card on phones** (`flex-row`, `h-40` portrait, `md:flex-col`). 6 suspects = 4 + 2 orphans on desktop and six tall rows on a phone. `AccuseScreen` "Who did it?" grid is `grid-cols-2 sm:grid-cols-4`. `InvestigateScreen` is `lg:grid-cols-3`. `Notebook` has Evidence / Leads tabs (testimony shows inside Evidence). `components/ending/sequence.ts` `castAt` already supports two actors. | 6-suspect UI work (phase 7). |
| F18 | Authoring today: `docs/CASE_AUTHORING.md` §7.1 tells authors to **hand-copy `cases/_placeholder`** (it still holds a Blackwood-style 4-character cast); §7.2 has a test template only as prose; §8 lists "second culprit, per-case theme, per-case sound beds, clue-art resolver, scaffold command, case-defined order landmarks, per-case era text" as **PLANNED**. No `scripts/` entry creates a case; `package.json` has `validate:case`, `sync:assets`, `check:overflow` only. | Section 6.5. |

### 1.2 Already built (do not rebuild)

- **Progression** (F1): conditions, gated rooms/clues, leads, the accuse gate, key clues and key testimony, `accuse_locked`, the public `progress` object on every token-returning route, the Leads tab, padlocks, CASE NOT READY, the NEW LEAD sting, "questioned n/2" badges, the confession picker, progress saved with the session, `check:overflow` coverage of the new screens, the reachability simulation and exact `fastestPath`, a fixture (`tests/fixtures/progression/progress-light`), and tests (`tests/engine/progress*.test.ts`, `progression-validation.test.ts`, `progression-routes.test.ts`, `tests/components/progression-ui.test.ts`, `tests/cases/blackwood-progression.test.ts`).
- **Blackwood on progression** (#36): gated rooms and clues, nine leads, accuse gate, win rule, `jabs` / `defensiveOn` relationship fields, fastest legal path 10.
- **Authoring guide** (#35): `docs/CASE_AUTHORING.md` (layout, workflow, validator rules, knowledge rules, fairness bar, art needs, skeleton, definition of done).
- **Engine pieces that already handle arbitrary cases:** the knowledge firewall (`engine/knowledge-gate.ts`), testimony (`engine/testimony.ts`), reveal rules (`engine/secrets.ts` `shouldRevealSecret`), the time-provenance canon check (`ai/canon-check.ts` `canonTimes` / `checkTimes`), the confrontation engine (`engine/confrontation.ts` `openConfrontation` / `spendExchange` / `testimonyToThrow`), `tests/helpers/leak-scan.ts` (`forbiddenPromptStrings`, `SOLUTION_KEYS`), `tests/helpers/grok-mock.ts`, and `tests/e2e/second-case.test.ts` with fixtures `fixture-manor` and `harbor-light`.

---

## 2. Design principles

1. **Engine is truth, AI is performance** (`docs/ARCHITECTURE.md`). Every new rule is deterministic and server-side. The model never grades, gates, or decides a reveal.
2. **Additive and optional.** Every new field is optional with a default that reproduces today's behaviour. Blackwood keeps working byte for byte until its own data PR opts in.
3. **Data before code.** A new case should be `cases/<id>/*.json` plus assets under `assets/`. Code is added only for a *mechanic*, never for a *case*.
4. **Feature modules are named for the mechanic, never the case, and take every id from case data.** `time-misdirection`, not `tallyho-watch`. The case-agnostic test, widened to `engine/`, `ai/`, `components/`, `lib/` and `app/`, enforces this.
5. **Fail loudly at authoring time, never at play time.** A bad case fails `validate:case` in CI, not a player's third interrogation.
6. **Spoiler safety is tested, not hoped for.** Public strings, prompts and API bodies are scanned against the solution (section 6).
7. **Never lose a player's game silently.** Token overflow trims; schema drift gets an explicit version; a model outage degrades gracefully.

---

## 3. The logic changes

### 3.1 Two-culprit grading (strict)

**Data.** `solution.json` gains `accompliceId?: Id`, next to the progression fields that already exist (`minKeyEvidence?`, `keyTestimonyIds?`, `minKeyTestimony?`), and optionally `keyTestimonyGroups?: Id[][]` (design G5, nice-to-have: cite at least one id from each group, so two doer-side testimonies cannot stand in for one witness of each half). Optional `accompliceAct?: { locationId, time }` (design G3) lets the validator run the opportunity rule for the stager's act.

**Accusation.** `AccusationSchema` (`engine/types.ts`) already has the optional `keyTestimonyIds` (max 3); it gains `accompliceId?: Id`. Absent means "I say no one helped".

**Grading** (`engine/accusation.ts` `gradeAccusation`). Today: `won: murdererCorrect && weaponCorrect && motiveCorrect && hasKeyEvidence && hasKeyTestimony`. After:

```ts
const accompliceCorrect = (accusation.accompliceId ?? null) === (solution.accompliceId ?? null);   // strict, role-sensitive
const hasKeyTestimony = keyTestimonyCited.length >= (solution.minKeyTestimony ?? 0)
                        && groupsSatisfied(solution.keyTestimonyGroups, keyTestimonyCited);        // groups: nice-to-have
won: murdererCorrect && accompliceCorrect && weaponCorrect && motiveCorrect && hasKeyEvidence && hasKeyTestimony
```

`AccusationGrade` (`engine/accusation.ts`) and `AccuseVerdict` (`engine/accuse-schema.ts`, filled by `toVerdict` in `engine/ending-payload.ts`) gain `accompliceCorrect`; `SolutionReveal` gains the accomplice (touching `engine/solution.ts`, `engine/types.ts`, `engine/accusation.ts`, `engine/accuse-schema.ts`, `engine/accuse-handler.ts`).

**Strict (decided, Agatha)** means the doer must be named as murderer and the stager as accomplice; swapping them, or naming only one, loses. Reason: the roles are provable from different clues. No lenient (`either-order`) mode is built.

**Server checks** (`engine/accuse-handler.ts` `handleAccuse`), same shape as the existing rejections: unknown `accompliceId` (`unknown_suspect`), `accompliceId === murdererId` (new `accomplice_is_murderer`), (the check that every cited testimony id is revealed, `testimony_not_revealed`, and the 403 `accuse_locked` gate already exist). `state-token.ts` `decodeStateToken` already validates a stored accusation against the case; extend it for the new ids.

**Verdict and reveal** (win only, per #22): `AccuseVerdict` gains `accompliceCorrect`; `SolutionReveal` gains `accomplice?`; `components/ending/summary.ts` `summaryRows` gains an "Accomplice" row (the `SummaryRow.field` union grows).

**Endings must not leak the second culprit** (F3):
- `lossBeats`: use the authored `wrong[accusedId]` only if the accused is **neither** culprit; drop lines spoken by **either** culprit from every loss ending.
- A named-but-innocent accomplice adds at most one generic engine line, never an authored line for a culprit.
- Win: `correct.confession` already allows any speakers; `components/ending/sequence.ts` `castAt` already shows two actors. The `escaped` beat shows the doer alone (acceptable; revisit if art wants both).
- `case-validation.ts`: "missing wrong ending" applies to the accomplice too; the "innocent needs a secret" rule (`ch.id !== s.murdererId` today) excludes both culprits; the opportunity rule also runs for `accompliceAct` (V5). None of these accomplice checks exist anywhere yet, not even in Blackwood's tests.

### 3.2 The always-visible "Did anyone help?" picker (decided)

**Decided (Agatha):** the accuse screen always shows "Did anyone help?" with an explicit "No one helped" answer; nothing is preselected; **Submit stays disabled until an answer is picked.** Reason: an always-visible picker means single-culprit cases do not tip off that a case has an accomplice.

`components/accuse/AccuseScreen.tsx` is a numbered `Section` list ("Who did it?" is section 1, the optional "A confession" is section 5). The picker becomes a new section 2, after "Who did it?", and the later sections renumber:

- Title **"Did anyone help?"**, hint "Name one helper, or tell us no one did."
- A radio-group button row: **No one helped** (explicit), then every suspect except the one chosen as murderer (that chip is disabled and labelled, not hidden, so the layout does not jump). If the player changes the murderer to the suspect already picked as helper, the helper answer is cleared and Submit disables again.
- **No preselected answer.** The submit button in the sticky bar (`AccuseScreen.tsx`, today disabled only while `busy`) is also disabled until the helper answer exists, and a visible hint beside it says why ("Say whether anyone helped") with `aria-describedby`, so a disabled button is never a mystery. The other fields keep today's behaviour (errors listed after a tap on Submit).
- **Wire format.** `AccusationDraft.accompliceId` is `string | null | undefined`: `undefined` = not answered (client blocks submit), `null` = "No one helped", an id = that suspect. `validateAccusationDraft` (`engine/accuse-schema.ts`) fails with "Say whether anyone helped." on `undefined`. The new client always sends `accompliceId` as an id or `null`; the server treats an absent field (an old tab, an old test) as `null`, so single-culprit grading is unchanged and stale clients keep working.
- Shown for **every** case, including single-culprit ones (in a single-culprit case the right answer is "No one helped"). Blackwood players get one extra tap.
- `ConfirmDialog` repeats the full accusation (murderer, helper or "no one", weapon, motive) before "This ends the case."
- On phones the helper picker uses name-only chips (no portraits) to save height; the sticky submit bar is unchanged.

### 3.3 Time-misdirection (a watch and a recording)

**What is data-only today.** The staged watch and the recorded cheer are ordinary timeline entries, clues and secrets (`TALLYHO_DESIGN.md` Appendix A). The knowledge firewall already hides who staged what (`hiddenUntil`), and `ai/canon-check.ts` already forces every spoken clock time to come from the speaker's own knowledge.

**Two related gaps.** (1) `ai/order-check.ts` recognises only Blackwood's five landmarks (F9), so for Tallyho the order-of-events check is inert until `orderLandmarks` is case data (4.4). (2) The existing `checkTimes` is the only guard on clock times.

**What is not covered, and is the real risk (R3).** The canon check verifies *which time* is said, not *how it is framed*. The staged time (the watch's reading) is legitimately in many characters' knowledge, so a model can say "he died at 22:41" as fact and still pass the check, which turns a decoy into false canon. Nothing stops a non-knower asserting the true time either. So `time-misdirection` is a **feature module**:

```jsonc
// case.json
"features": ["time-misdirection"],
"featureConfig": {
  "time-misdirection": {
    "stagedClaims": [
      { "time": "22:41", "factIds": ["f-..."], "evidenceIds": ["smashed-watch"], "kind": "death" },
      { "time": "22:38", "factIds": ["ev-..."], "kind": "alive" }
    ],
    "appearanceWords": ["watch", "clock", "read", "says", "said", "stopped", "hands", "programme", "heard", "horn", "bellow"],
    "provedBy": ["marmalade-run", "cheer-cylinder"]
  }
}
```

| Hook | What it does |
|---|---|
| `validate` (load time, errors) | Each `stagedClaims[].time` is at least `OPPORTUNITY_WINDOW_MINUTES` away from `solution.time`; every `factIds` / `evidenceIds` exists; `provedBy` are key evidence; **proof-of-when**: at least one `provedBy` evidence has `relatedFactIds` pointing at a fact or timeline entry whose range contains `solution.time` (the true time is provable, not just asserted). |
| `warn` (design warnings) | **Alibi shape**: from the `involvesCharacterIds` of located timeline entries, exactly one suspect is unaccompanied at `solution.time`, and the culprits are accompanied at each staged time (the property `TALLYHO_DESIGN.md` section 12 check 10 calls "the alibis cover the wrong window"). |
| `canonChecks` (run time, inside `ai/perform-turn.ts` `validate`) | Reject a clause that contains a staged time **and** a death/alive assertion verb **and** none of the `appearanceWords`, with a correction ("That time is only what the watch/horn showed; do not state it as fact. Say what it showed."). Retried once, then falls back, like the existing canon failures. Skipped when the character's own *maintained story* asserts it (a culprit keeps their authored lie). |
| `contextSections` | None needed for Tallyho (authored lies carry it). The hook exists for future cases. |

**Why a module and not core.** Plenty of future cases will not stage a time. Core stays small; the module is opt-in and validated.

**LLM-drift tests** (section 8): table-driven canon tests with adversarial questions ("Was he dead at 22:41?", "What time did he die?"), a golden set of accepted and rejected replies, and a live-model soak (8.5) that counts rejection rates.

### 3.4 The list (ship-tilt) proof

The proof is evidence-driven: `marmalade-run` requires `smashed-watch` and `heel-chart` (progression `requires`), and the heel chart shows the flip time. The engine only needs to make the proof **readable and checkable**:

```jsonc
"features": ["ship-list"],
"featureConfig": {
  "ship-list": {
    "history": [ { "from": "21:40", "list": "starboard", "degrees": 6 }, { "from": "22:14", "list": "port", "degrees": 6 } ],
    "diagrams": [ {
      "evidenceId": "marmalade-run",
      "frames": [
        { "label": "Before the Lurch (21:54, leaning starboard)", "image": "/assets/clues/<name>_before.webp" },
        { "label": "After the Lurch (22:14, leaning port)",       "image": "/assets/clues/<name>_after.webp" } ] } ],
    "locationTilt": { "<locationId>": { "asFound": "port" } }
  }
}
```

- **Validator:** `history` is sorted with no equal times; the **flip time lies strictly between `solution.time` and the staged time** (the logic of the proof; a flip before the murder would make the clue prove nothing); every `evidenceId` is a clue whose `requires` includes the clue that shows the flip; every frame image exists.
- **UI** (`components/features/ship-list/`): a notebook clue panel with a two-frame toggle (a button, not hover; honours `prefers-reduced-motion`; both frames have text labels so it works with images off), and an optional static CSS tilt of the scene background for locations with `locationTilt`. Tilt degrees come from data.
- **Art cost:** two frames and one chart, already in `TALLYHO_DESIGN.md` section 10.3. No new engine state.

### 3.5 The 6-suspect UI (phone and desktop)

Targets are a starting point and must be verified with `npm run check:overflow` screenshots (`--shots`) at the viewports already in `scripts/check-overflow.ts` (360x740, 390x844, 430x932, 740x360, 844x390, 768x1024, 1024x768, desktop 1280x800).

| Screen | Today | Change |
|---|---|---|
| `SuspectSelect` | `lg:grid-cols-4`; 6 cards = 4+2 orphan; one tall card per row on phones | Phones already get a **row card** (`flex-row`, `h-40` portrait; `md:flex-col`), so six cards are six rows of about 200px. A pure helper `suspectLayout(n)` returns the classes. **n = 6: 3 columns at `lg`, 2 at `min-[560px]`; phones under 560px, n >= 5: a 2-column compact card** (head-and-shoulders crop about 112px high, name, role, emotion badge, "questioned n/2" chip), so six cards take about three rows. n <= 4 keeps today's layout (Blackwood unchanged). |
| `AccuseScreen` | `grid-cols-2 sm:grid-cols-4` | `sm:grid-cols-3` when n = 6; new "Did anyone help?" chip row; sticky submit bar unchanged; confirm dialog stays scrollable. |
| `InterrogationScreen` "Ask about" and "Confront" menus | `otherSuspects` buttons, flex-wrap | Works for 5 others. Add per-pair status chips and the game-wide counter (3.6). |
| `Notebook` | Evidence / Leads tabs (`data-notebook-tab`); clue and testimony cards share one list | Tallyho has 10 clues, up to about 13 testimony cards and 12 leads. Split into **Clues / Testimony / Leads** (the tablist exists; add one tab), group clues by location, a key/new badge. Targets at least 44px (the tabs already use `min-h-11`). |
| `InvestigateScreen` | 3-column grid (6 rooms = 3x2 already); padlocked cards with `lockedLine` **already built** | Only the `locationTilt` hook for `ship-list`. |
| Stage and endings | 1 or 2 actors | No change; `components/stage/layout.ts` `REFERENCE` is replaced by a data-derived reference. |
| Landscape phone (740x360, 844x390) | `short:` variants | Verify compact cards and picker rows scroll without horizontal overflow; the `screen-scroll` pattern already allows vertical scroll. |

**Accessibility:** radio-group semantics for pickers (already used), 44px targets, no information by colour alone (the disabled-murderer chip carries text), reduced motion for the tilt toggle.

### 3.6 Confrontations among 15 pairs (cap, cost, UX)

**Cost model (from code).** One exchange = 2 sequential model calls. Total exchanges are capped by `MAX_CONFRONTATION_TOTAL` regardless of pair count, so 15 pairs do not change the maximum cost: Blackwood (6 pairs) and Tallyho (15 pairs) both stop at the total cap (12 exchanges = 24 calls today, 16 = 32 calls for case two). Worst-case wall time per exchange is `2 calls x (1 try + 1 retry) x 12 s = 48 s`, under `maxDuration = 60` with thin margin; typical latency is **not measured** (R2).

**Cap proposal.** Per-case, optional, defaulting to today's constants:

```jsonc
"confrontation": { "maxPerPair": 4, "maxTotal": 16, "requires": { "interrogated": [ ... ] } }
```

- Code: `openConfrontation` / `spendExchange` read the case values. `ConfrontationStateSchema`, `GameStateSchema.pairTurns` and `TokenPayloadSchema.pairTurns` keep a hard ceiling (for example 10) as a schema bound while the case value is the rule. `Game.tsx` stops importing `MAX_CONFRONTATION_TURNS` and uses the `max` already returned in `ConfrontResponseBody.confrontation`.
- **Decided (George): case two uses 4 per pair and 16 total.** Blackwood stays at 6 / 12 (`tests/engine/confrontation.test.ts` pins 6 and 12 for the defaults). With 15 pairs and about 4 productive ones, 16 lets a thorough player try each productive pair at its cap and probe a few others. The cost ceiling is 16 exchanges x 2 calls = 32 model calls; the live soak (8.5) still measures real latency against it (R2).
- Optional `confrontation.requires` (a `Condition`, the same type as progression) opens a pair only after both suspects have been questioned at least twice, so the limited budget is not wasted on strangers.

**UX.**
- The pair picker is already the "Confront..." menu on a suspect's screen (5 choices, not 15). Add **per-pair chips** ("2/4 used", "finished", disabled) from `confrontStatus` in `Game.tsx`, and a **game-wide counter** ("Face-offs left: 9 of 16") in the menu and on `ConfrontScreen` (today it shows only the pair's count).
- **No "productive pair" hints** in the UI (a spoiler). The existing contradiction hint (`engine/hints.ts` `takeHint`) stays the only nudge.
- Phones: menu chips wrap; targets at least 44px (`ConfrontScreen` already uses `min-h-12`).

### 3.7 Progression: built; what case two adds on top

Everything in `docs/BLACKWOOD_PROGRESSION_PROPOSAL.md` is on `main` (F1, 1.2). I checked every Tallyho gate in `TALLYHO_DESIGN.md` sections 8.1 to 8.4 against the shipped `ConditionSchema` (`engine/types.ts`): **every Tallyho condition is single-mode** (all-of or any-of, never nested), and it uses only the five existing atoms, so **no new condition atom is required**. The shipped `AccuseGateSchema` fields (`minEvidence`, `minSuspectsQuestioned`, `minRevealedSecrets`, `closedLeadIds`, `lockedLines`) already express the design's gate (8 clues, 6 suspects x 4 exchanges, 10 secrets, 3 closed leads).

What remains is small:

| Item | Detail | Size |
|---|---|---|
| Scale check | 12 leads, 3 of them gate leads, 15 secrets, 161 checkpoint rows. `simulate` / `fastestPath` are bounded (`FASTEST_PATH_BUDGET = 400_000` states; `fastestPath` returns `null` when the budget runs out and `validate-case.ts` then says it "could not be computed"). Six suspects with a cap of 4 exchanges each is a much bigger state space than Blackwood's. **Measure it in phase 8**; if it overruns, cap exchanges per suspect at the largest threshold actually used (already done by `exchangeCap`) and use A* or a symmetry reduction. | S to M |
| Confrontations in the simulator | `fastestPath` offers only search, one exchange, and show-a-clue. `commitTurn` also bumps `interrogationCount` for both sides of a confrontation (F7), so the true floor can be lower than the printed number and lower than the design's 32. Add a "confront (a, b)" move (cost 1 action, +1 exchange each side, capped by the per-case limits) and report both numbers: the floor with and without confrontations (Q3). | M |
| `keyTestimonyGroups` | Nice-to-have (design G5): `solution.keyTestimonyGroups?: Id[][]`, win needs at least one cited id from each group, so two doer-side testimonies cannot stand in for one witness of each half. Extends `gradeAccusation` (`hasKeyTestimony`), `checkProgression` (each group non-empty and reachable) and the accuse form (group labels are not shown, to avoid hinting). | S |
| `lieBrokenIds` condition atom | Nice-to-have (design G8): "this lie is broken" as a `Condition` atom. Tallyho does not need it (it closes `lead-stager` on a revealed testimony). Extends `ConditionSchema`, `evaluateCondition` (needs the lie state from `GameState`), `condRefs` / `checkCondition`, and the simulator. Defer unless a story needs it. | S to M |
| Testimony-triggered reveal | Nice-to-have (design G4): `revealConditions.testimonyIds?: Id[]` (another character's revealed secret, shown as testimony to this one, can trigger their own). Needs `RevealState` to know which testimony was presented to whom, `engine/secrets.ts` `shouldRevealSecret`, the reveal simulator in `revealableSecrets`, and `afterSecretIds` interplay. Tallyho does not need it. Defer (Q10). | M |
| Required-secret soft-lock | See R6: after N consecutive canon-check failures the fallback speaks the secret's `testimonySummary` and commits it (small optional per-character counter in the token). | M |
| Search again | Already shipped: a locked clue appends its `lockedLine`; the "Search again" button exists. | - |

### 3.8 Case unlock: case two opens after solving Blackwood (decided, George)

**Decided (George):** players unlock case two by solving Blackwood. There is **no case chooser**. Today `/` renders the default case (`app/page.tsx`, `DEFAULT_CASE_ID = "blackwood"`), `/case/[caseId]` renders any public case (`app/case/[caseId]/page.tsx`, `generateStaticParams` from `listPublicCaseIds`), `TitleScreen` takes only `tagline`/`backdrop`/`onStart`, `EndScreen` offers only "PLAY AGAIN" (`playAgain` clears the session and reloads), and the only browser storage is `sessionStorage` for the in-progress game (`lib/game-session.ts`) and `localStorage` for the mute flag (`components/effects/audio.ts`). Nothing records a win across sessions.

**How the unlock works**

| Piece | Design |
|---|---|
| **Case data** | New optional `case.json` field `unlockedBy?: CaseId[]` (all listed cases must be solved). Absent = open to everyone (Blackwood). Tallyho: `"unlockedBy": ["blackwood"]`. Public (not a secret), so it goes in the public view with the required cases' titles. |
| **The flag** | `localStorage` key `whodunit:solved`, value `{ "v": 1, "cases": { "blackwood": { "at": "<ISO time>" } } }`. New `lib/solved-store.ts` (`readSolved`, `markSolved`, `isUnlocked(case, solved)`), with an injectable store like `lib/game-session.ts` so it is unit-testable. All access is wrapped in `try/catch`; if `localStorage` is unavailable (private mode, blocked), fall back to an in-memory set for the page's lifetime and treat the case as locked afterwards. |
| **When it is set** | In `components/game/Game.tsx`, when `/api/accuse` returns `outcome === "won"` (the place that calls `setResult(r)`), call `markSolved(caseId)`; also when a saved won result is restored. Only a **win** unlocks. A loss does not. |
| **Winner's route onward** | `EndScreen` gets an optional `nextCase?: { id, title }` and renders a **"NEXT CASE: <title>"** button (a link to `/case/<id>`) next to "PLAY AGAIN", on a win only. The next case(s) are computed server-side in `lib/render-case.tsx`: the public cases whose `unlockedBy` includes this case's id. |
| **Title screen** | `TitleScreen` gets an optional `nextCases` prop. On `/` (and on any case) it shows a secondary "Next case: <title>" button only once `isUnlocked` is true, so a returning player who solved Blackwood in an earlier session finds it. `/` always stays Blackwood. |
| **`/` and the sitemap** | `/` is unchanged (canonical Blackwood). `/case/tallyho` stays in `app/sitemap.ts` and `generateStaticParams`: the locked page is a real, indexable teaser (title and tagline come from `generateMetadata`). Both read `listPublicCaseIds` as today; no change. |
| **Direct visit to `/case/tallyho` while locked** | The page is statically generated, so it cannot know the browser's storage. A new client wrapper `components/game/CaseGate.tsx` reads `whodunit:solved` after hydration. Until it has read it, it shows a neutral splash (no flash of the game). If the case is open (`unlockedBy` absent, or all solved), it renders `<Game>`. If locked, it renders `LockedScreen`: the case title and tagline, "This case opens when you solve <required title>", and a **"Play <required title>"** button to `/`. It deliberately does **not** offer a skip link (see Q17). |
| **Resume** | An in-progress Tallyho game in `sessionStorage` is unaffected; the gate only decides whether to mount `<Game>`. |
| **Existing winners** | A player who won Blackwood before this ships has no flag, and the old win is gone. The flag is only set on a new win, plus a one-time backfill if a saved won result is found in `sessionStorage`. They replay Blackwood once. |

**Server and API.** The API does not enforce the unlock. `/api/*` already accept any allowlisted case id from `lib/request-case.ts`, and the signed state token is per case. Adding a server-side check would need an account or a signed cookie, which is out of scope for a game with no stakes.

**Honest trade-off.** The unlock is client-side and **spoofable**: anyone can set `whodunit:solved` in devtools, or call the API directly. That is acceptable because there are no stakes (no accounts, no scores, no leaderboard) and the lock exists for pacing, not security. Two real downsides: (1) players who clear storage, use another device or browser, or play in private mode lose the unlock and must solve Blackwood again; (2) a friend sharing a `/case/tallyho` link sees the locked teaser. The plan keeps the lock as decided; an optional escape hatch is Q17.

**Validator and tests.** Registry/validator: `unlockedBy` ids must exist, must not name the case itself, must not form a cycle, and at least one case in the repo must have no `unlockedBy` (V31). Unit tests: `solved-store` read/write/corrupt value/missing storage; `isUnlocked` with all/none/some solved; `EndScreen` shows "NEXT CASE" only on a win and only when a next case exists; `CaseGate` renders the locked screen without a flag, the game with a flag, and the splash before storage is read; the sitemap still lists the locked case. **Size: S to M, 4 to 6 commits** (schema + registry + validator 1 to 2; `solved-store` + tests 1; `CaseGate`/`LockedScreen` 1 to 2; `EndScreen`/`TitleScreen` buttons + `render-case` wiring 1 to 2). It depends only on phase 3 (case-agnostic hardening) and can land any time before Tallyho is published.

---

## 4. The case-agnostic architecture

### 4.1 Rule: data first, modules second, the engine never names a case

| Layer | Lives in | Declared how | Examples |
|---|---|---|---|
| **Core data** (optional fields, defaults = today) | `cases/<id>/*.json` | not declared; presence is the signal | `solution.accompliceId` / `accompliceAct`, `keyTestimonyGroups`, `confrontation`, `setting`, `theme`, `orderLandmarks`, `audio`, `lint`, `endings`; already built: `requires`, `leads`, `accuseGate` |
| **Feature module** (code for a *mechanic*) | `engine/features/<name>/` (server) and `components/features/<name>/` (client) | `case.json` `"features": ["time-misdirection", ...]` plus `"featureConfig"` | `time-misdirection`, `ship-list` |
| **Never allowed** | | | a case name, character id, clue id or location id in `engine/`, `ai/`, `components/`, `lib/`, `app/` |

**Loader contract** (`engine/case-loader.ts`, `engine/features/registry.ts`):
1. Every name in `features` must be a registered module, and every registered module a case uses must be declared. Unknown or undeclared means **load error**, never silently ignored.
2. `featureConfig[name]` must parse against the module's own Zod `configSchema`. A feature with no config, or config with no declaration, is an error.
3. `featureConfig` is **never sent to the client** wholesale. Only `module.publicConfig(config, state)` is returned in the public view, and the validator checks it holds no solution ids (V18). The ship-list diagram frames are public art by design; the staged-claim table is server-only.
4. `next.config.ts` `outputFileTracingIncludes` already ships `./cases/**/*.json`; feature config lives in `case.json` so nothing new needs tracing (F15).

### 4.2 The module interface (server side)

```ts
// engine/features/types.ts  (new)
export interface FeatureModule<C = unknown> {
  name: string;                                   // "time-misdirection"
  configSchema: z.ZodType<C>;
  validate(c: LoadedCase, cfg: C): Issue[];        // errors at load / validate:case
  warn?(c: LoadedCase, cfg: C): Issue[];           // design warnings
  simulate?(c: LoadedCase, cfg: C, sim: SimHooks): void;   // solvability model extras
  grade?(c: LoadedCase, cfg: C, acc: Accusation, s: GameState): GradeAdjustment;   // optional extra grading terms
  contextSections?(c: LoadedCase, cfg: C, ch: Character, s: GameState): PromptSection[];  // context-builder additions
  canonChecks?(c: LoadedCase, cfg: C, ch: Character, s: GameState): CanonCheck[];   // reply validators
  publicConfig?(c: LoadedCase, cfg: C, s: GameState): unknown;                       // safe, client-visible slice
}
```

Client slots (a small registry in `components/features/registry.ts`, keyed by module name; a module only renders for a case that declares it): `notebook.clue` (extra panel for a clue), `accuse.extra` (extra form section), `investigate.location` (decoration or badge), `stage.overlay` (scene effect such as tilt), `ending.recap` (extra recap block).

### 4.3 Extension points, named explicitly

| # | Extension point | Today | Where it hooks (file / function) | Case-specific via |
|---|---|---|---|---|
| **E1** | **Grading rules** | `gradeAccusation` (murderer, weapon, motive, `minKeyEvidence`, `minKeyTestimony`) | `engine/accusation.ts`; core optional fields (`accompliceId`, `keyTestimonyGroups`); module `grade()` returns extra terms ANDed into `won` | optional core fields, or a module |
| **E2** | **Progression** | **built** (`engine/progress.ts`) | `Condition` atoms, `requires`, `leads`, `accuseGate` | data (a new atom only if a story needs one, e.g. `lieBrokenIds`) |
| **E3** | **Context-builder sections** | `engine/context-builder.ts` `buildCharacterContext` (re-exported by `ai/context-builder.ts`), `ai/prompts/interrogation.ts` | module `contextSections()` appended after the standard sections; each section passes the leak scan | module |
| **E4** | **Canon checks** | `ai/canon-check.ts` (`checkTimes`, `MODERN_WORDS`; the per-case vocabulary of 4.4), `ai/order-check.ts`, `ai/confront-check.ts`, run via `ai/perform-turn.ts` | module `canonChecks()` joins the validator list; same retry-then-fallback behaviour; `setting.vocabulary` (4.4); `orderLandmarks` (E14) | module / data |
| **E5** | **Validator rules** | `engine/case-validation.ts`, `engine/progression-validation.ts` | module `validate()` / `warn()` / `simulate()` | module |
| **E6** | **UI panels** | fixed screens | the five client slots in 4.2 | module |
| **E7** | **Setting and voice** | hard-coded (F8) | `case.json` `setting` (4.4) read by prompts, handlers and screens | data |
| **E8** | **Art mapping** | file conventions (F13): `lib/case-art.ts` (`resolveCaseArt`, `resolveStageArt`), `components/characters/sprite-meta.ts` | `case.json` `backdrops` / `location.background` / character `portrait` already win; clue art resolver (E15); validator checks collisions in the flat, shared namespace (R10) | data |
| **E9** | **Sound mapping** | `components/effects/audio-scenes.ts` `bedForScreen` + `audio.ts` `BedName` (global) | `case.json` `audio` (4.4): per-case beds per screen and cue overrides, falling back to today's | data (+ audio files) |
| **E10** | **Endings** | `engine/ending-payload.ts` `buildEnding`, `lossBeats` | data (`endings.correct`, `endings.wrong[id]`); engine rules for leak safety (both culprits); module `ending.recap` | data / module |
| **E11** | **Confrontation rules** | `engine/constants.ts` | `case.json` `confrontation` (caps, `requires`) | data |
| **E12** | **Publish gate** | `listPublicCaseIds` (`_` prefix not served) | CI runs `validate:case --strict` on every non-underscore case (D5) | convention + CI |
| **E13** | **Theme** | none (F10) | `case.json` `theme` (4.4) read by the title/intro/end screens | data |
| **E14** | **Order landmarks** | five hard-coded regexes in `ai/order-check.ts` (F9) | `case.json` `orderLandmarks` (4.4) replaces `LANDMARKS` | data |
| **E15** | **Clue art resolver** | `Notebook.tsx` raw `<img src={e.image}>` (F12) | one function `clueImageSrc(e)` in `lib/case-art.ts` | data (`image` or convention) |
| **E17** | **Case unlock** | none; `/` is always Blackwood, no stored wins | `case.json unlockedBy`, `lib/solved-store.ts`, `CaseGate`, `EndScreen`/`TitleScreen` next-case buttons (3.8) | data + one small client module |
| **E16** | **Authoring tooling** | hand copy of `_placeholder` (F18) | `npm run new:case`, `cases/_template`, `tests/cases/_template.test.ts` (6.5) | convention |

### 4.4 Per-case presentation as data

**`setting`** (replaces hard-coded wording; **decided by Agatha** for Tallyho). Every field is optional and the defaults equal today's Blackwood strings, so Blackwood needs no edit.

```jsonc
// cases/tallyho/case.json (Blackwood omits the block and gets the defaults)
"setting": {
  "place": "aboard a private steam yacht at sea in a storm",    // era rule: "You live {place} in {dateLine ?? decade}."   default: "in an English country house"
  "decade": "the 1930s",                                        // default: "the 1920s"
  "dateLine": "the summer of 1936",                             // optional; overrides decade in the sentence above
  "site": "the ship",                                           // short noun for "in this house" / "Investigate the house!" / "the whole house"   default: "the house"
  "authority": { "noun": "the purser", "policeAboard": false, "note": "the police take over when we make port" },   // default: { "noun": "the constable", "policeAboard": true }
  "roster": "Others aboard:",                                   // default: "Others in the house:"
  "vocabulary": {
    "allowed": ["disc", "gramophone", "wireless", "telegraph", "galley", "purser"],   // named in the prompt as ordinary for this world; exempt from every banned list.   default: ["telephone"]
    "banned":  ["phones", "apps"]                               // added to the default anachronism list; whole words, case-insensitive, plural-aware
  }
}
```

- **The player stays "detective"** in every case; there is no field for it.
- **Authority.** The in-world authority is a per-case noun. For Tallyho it is **the purser**: neutral, offstage, never a suspect, and there are **no police on board until port**. The captain cannot be the authority because Captain Bilge is a suspect. The validator rejects an authority whose noun matches any suspect's name, alias or role (V32). The purser is not in `TALLYHO_DESIGN.md` yet; Agatha adds them to the offstage extras (alongside the helmsman, forty guests and kitchen boys), never as a character, a witness or someone the player can question.
- **Lines that read `setting`:** `engine/session.ts` `CASE_CLOSED_LINE` ("The constable has everyone's statements...") becomes "{Authority} has everyone's statements, and the police take over at port" style text built from `authority.noun` / `authority.note`, and `CASE_CLOSED_SEARCH_LINE` ("The constable has sealed the house") from `authority.noun` + `site`. `ACCUSE_LINES` ("...in this house"), `CONFRONT_LINES`, `NO_HINT_LINE`, the roster line, `EndScreen` ("The whole house is talking about you") and the Notebook empty state ("Investigate the house!") use `site` and `roster`. Defaults reproduce today's strings exactly (a golden test, phase 3).
- **`ERA_RULE` becomes a function** `eraRule(setting)` in `ai/prompts/interrogation.ts`. With no `setting` it returns today's string byte for byte ("You live in an English country house in the 1920s. Use only period-appropriate words. ... The telephone is NOT modern: it is an ordinary 1920s household fitting (the servants' telephone) and you may mention it freely."), pinned by a golden test. With a `vocabulary.allowed` list, the Blackwood-specific telephone sentence is replaced by a generated one ("These are NOT modern in your world, they are ordinary here, and you may mention them freely: disc, gramophone, wireless, telegraph, galley, purser."), and the opening sentence is built from `place` and `dateLine ?? decade`.
- **The vocabulary check reads the per-case list.** Today `ai/canon-check.ts` has a fixed `MODERN_WORDS` regex (plus `MODERN_CASED` for "AI" and `MODERN_PROMPT`), and the telephone exemption lives only in the `ERA_RULE` prompt text. After: `findModernWord(text, heard)` gains a third argument (the case's vocabulary) and builds, once per case, `META_WORDS` (always banned in every era: emoji, AI, JSON, system prompt, LLM, "okay", ...; stays in code) + `DEFAULT_MODERN` (computer, internet, email, smartphone, app, ... as today) + `vocabulary.banned`, minus `vocabulary.allowed`. "Allowed" wins on any overlap. Matching is whole-word and plural-aware, so "phones" bans phone/phones but not "telephone" or "gramophone". `ai/perform-turn.ts` (the `validate` step that already calls `findModernWord`) passes the case vocabulary, so a reply that says "my phone" aboard the Tallyho is rejected and retried like any other canon failure.
- **Validator (V26, V32).** `allowed` and `banned` do not overlap; every `allowed` word is not also in `META_WORDS`; no authored string (bio, secrets, lies, facts, `lockedLine`, endings) contains a banned word; `authority.noun` is not a suspect.

**`theme`** (new; there is no theme concept today, F10):

```jsonc
"theme": {
  "colors": { "accent": "#...", "paper": "#...", "ink": "#...", "backdropTint": "#..." },   // CSS custom properties applied on the case root
  "eraText": "A cruise on the S.S. Tallyho",           // title/intro eyebrow line
  "title": { "logo": "/assets/title/tallyho_logo.webp", "background": "/assets/title/tallyho_bg.webp" }
}
```

- Applied as CSS custom properties on the case's root element (a tiny `ThemeProvider` in `app/case/[caseId]/`), with the current purple/yellow palette as the default so Blackwood is unchanged. Components keep their Tailwind classes; only the handful of palette tokens move to variables (phase 3 audits how many; expected small, since the UI is mostly one palette).
- `title.logo` / `title.background` use `AssetPathSchema`, checked by V21. The `setting` block is decided (above); **how far `theme` goes is still open (Q7, narrowed)**: this plan assumes colours, logo and title art only.

**`orderLandmarks`** (replaces the five hard-coded entries in `ai/order-check.ts`; **decided (Agatha)**: per-case in `case.json`). Tallyho's four, with the times the design gives them:

```jsonc
"orderLandmarks": [
  { "id": "storm", "label": "the storm closes in",
    "say":  ["storm", "squall", "thunderstorm", "when it (?:broke|hit)"],
    "fact": ["squall", "thunderstorm closes in"],                       "expectTime": "21:40" },
  { "id": "wave",  "label": "the big wave (the ship heels the other way)",
    "say":  ["(?:great )?lurch", "the (?:big )?wave", "when she (?:rolled|flipped|heeled)"],
    "fact": ["great lurch", "list(?:ed)? to port"],                     "expectTime": "22:14" },
  { "id": "cheer", "label": "the cheer over the horns",
    "say":  ["(?:the )?cheer", "heard him (?:cheer|shout)", "the horns?"],
    "fact": ["cheer"],                                                  "expectTime": "22:38" },
  { "id": "body",  "label": "the body is found",
    "say":  ["(?:body|commodore) (?:was )?found", "found (?:him|the body)"],
    "fact": ["found dead", "opens the (?:door|stateroom)"],             "expectTime": "22:55" }
]
```

- The pattern strings above are **illustrative**: Agatha writes the real ones from the final facts, and the storm time (21:40, the squall in `TALLYHO_DESIGN.md` section 3.1) is the design's, not a decision from Agatha's note. The engine still derives each landmark's minute from the speaker's own knowledge (`landmarksOf`), exactly as for Blackwood; `expectTime` is a **validator pin only** (V13 fails if the knowledge-derived minute differs), so the four times in Agatha's decision are checked rather than trusted.
- `LANDMARKS` becomes the default for a case with no `orderLandmarks` (so Blackwood is byte-identical until it opts in; phase 3 moves its five into `cases/blackwood/case.json` and a golden test proves no behaviour change).
- Compiled once per case with safe-regex limits (length cap, no nested quantifiers) and validated at load; `landmarksOf(ctx)` and `orderLines(ctx)` read the case's list. V13 checks every landmark's `fact` pattern matches at least one fact/timeline statement (otherwise it is inert, as it is for Tallyho today).

**Clue art resolver (E15).** `Evidence.image` becomes `AssetPathSchema.optional()` (schema change in `engine/types.ts`; no case sets it today, so nothing breaks). A single `clueImageSrc(evidence)` in `lib/case-art.ts` returns `e.image` if set and the file exists, else `/assets/clues/<id>.webp` if that file exists (the convention `docs/CASE_AUTHORING.md` §6 already names as planned), else `undefined` (kind icon). `toPublicEvidence` and `Notebook.tsx` use it. Resolution happens server-side at render time (like `resolveCaseArt`), so a missing file never produces a broken image.

**Audio hook (E9).** Cues and beds are one global table, `CUES: Record<AudioCue, CueDef>` in `components/effects/audio.ts` (`CueDef.files` are file stems in `assets/audio/`), and `bedForScreen` in `components/effects/audio-scenes.ts` maps the screens `title`, `intro`, `suspects`, `investigate`, `interrogation`, `confront`, `accuse`, `ending` to three beds (`BedName = "rain_loop" | "bed_manor" | "bed_library"`).

```jsonc
"audio": {
  "beds": { "title": "bed_ship_hum", "suspects": "bed_ship_hum", "investigate": "bed_ship_deck", "interrogation": "bed_saloon", "ending": "bed_ship_hum" },
  "cues": { "siren": ["ship_horn"], "thunder": ["storm_wave_1", "storm_wave_2"] }     // override the file stems of an existing cue
}
```

- `bedForScreen(screen, endingPart, caseAudio?)` returns the case's bed when set, else today's three. `BedName` becomes a string validated against the cue table; a case bed is registered as a `CueDef` (`loop: true`) by a small per-case `registerCaseAudio(caseAudio)` at case load, so mixing, ducking and the iOS-safe gain path are reused unchanged.
- `cues` lets a case re-skin an existing named cue (the emotion map and every call site keep using the same `AudioCue` names), so no UI code names a case sound. Unknown cue names are rejected by the validator.
- New files follow the existing pipeline: `scripts/audio/make_noir.py` / `master_all.py` (loudness policy in `docs/SOUND_NOTES.md`), both `.mp3` and `.ogg` under `assets/audio/`.
- Missing audio degrades to the default bed or silence, never an error (`docs/CASE_AUTHORING.md` §7.3: "the case must degrade gracefully").

### 4.5 What a future case then needs

| Need | Who | Engineering? |
|---|---|---|
| `case.json`, `solution.json`, `timeline.json`, `characters/*.json`, `endings.json` (+ `leads`, `accuseGate`, `setting`, `theme`, `orderLandmarks`, `audio`, `confrontation`) | Story | **No** (validated by `validate:case`) |
| Backgrounds (with variants), clue art `assets/clues/<id>.webp`, 7 poses per suspect + `anchors.json` entry, victim portrait, title and ending art | Art | **No** (asset-existence check) |
| Ambient beds, cue overrides, music | Sound | **No** (add files; name them in `case.json audio`) |
| Animation timings per suspect | Art | **No** if the existing pose set and `docs/toonMotion.ts` keys suffice |
| A *new mechanic* (a new kind of proof, grading term or panel) | Engineering | **Yes**, as one feature module (typically S to M) |

**Success test for D4/D8:** after phases 2 to 8, building a third case must not touch `engine/`, `ai/`, `components/` or `lib/` unless the case declares a *new* module. `tests/engine/case-agnostic.test.ts` (widened) and a CI check ("a PR that only adds `cases/<id>/` and new files under `assets/` and `anchors.json` entries changes no source file") defend this.

---

## 5. Files that change

Sizes: S = under an hour of focused work, M = a few hours, L = a day or more. "(new)" = new file. Progression files are **not** listed (done).

### 5.1 Engine (`engine/`, `app/api/`, `lib/`)

| File | Change | Size |
|---|---|---|
| `engine/types.ts` | `Accusation.accompliceId?`; `setting`, `theme`, `orderLandmarks`, `confrontation`, `features`, `featureConfig`, `audio` on the case; `Evidence.image` becomes `AssetPathSchema` (F12); optional `keyTestimonyGroups`-related types | M |
| `engine/case-schema.ts` | schemas for the new case-level blocks (`SettingSchema`, `ThemeSchema`, `OrderLandmarkSchema`, `ConfrontationConfigSchema`, `AudioSchema`) | M |
| `engine/solution.ts` | `accompliceId?`, `accompliceAct?: { locationId, time }`, `keyTestimonyGroups?` | S |
| `engine/accusation.ts` | `gradeAccusation`: `accompliceCorrect`, groups; `AccusationGrade.accompliceCorrect` | M |
| `engine/accuse-handler.ts` | validate `accompliceId` (`unknown_suspect`, new `accomplice_is_murderer`); `ACCUSE_LINES` from `setting` | M |
| `engine/accuse-schema.ts` | `AccuseVerdict.accompliceCorrect`; `SolutionReveal.accomplice`; `AccusationDraft.accompliceId`; `validateAccusationDraft` requires a helper answer (`undefined` = unanswered, `null` = no one) | S |
| `engine/ending-payload.ts` | `lossBeats` / `buildEnding` cover both culprits; `toVerdict` gains `accompliceCorrect`; `buildSolutionReveal` names the accomplice | M |
| `engine/public-view.ts` | `publicConfig` of modules; `theme`/`setting` slices the client may see | S |
| `engine/progress.ts`, `engine/progression-validation.ts` | optional: `keyTestimonyGroups`, `lieBrokenIds`; simulator: confrontation move (3.7) | M |
| `engine/confrontation.ts`, `engine/constants.ts` | per-case limits, schema ceiling; defaults 6/12 | S |
| `engine/state-token.ts` | `TOKEN_VERSION` v2 (dual-read, then dual-write), deflate (Q8), budget trimming, `accompliceId` in the stored accusation | L |
| `engine/session.ts` | `restoreSession` keeps trimmed state instead of resetting on size; closed-case lines from `setting` | M |
| `engine/interrogation.ts` | optional pending-reveal failure counter and fallback (R6, Q9) | M |
| `engine/hints.ts`, `engine/investigate-handler.ts` | `NO_HINT_LINE` and in-world lines from `setting` | S |
| `engine/case-loader.ts`, `engine/case-registry.ts` | validate `features` / `featureConfig`; no draft field (D5); loader unchanged for `_` ids | M |
| `engine/features/types.ts`, `registry.ts` (new) | the module interface and registry (4.2) | M |
| `engine/features/time-misdirection/*` (new) | config schema, validator, canon checks (3.3) | M |
| `engine/features/ship-list/*` (new) | config schema, validator (3.4) | S |
| `engine/leak-scan.ts` (new, from `tests/helpers/leak-scan.ts`) | spoiler scan callable by the validator | M |
| `lib/case-art.ts` | `clueImageSrc`; `ART_DEFAULTS.blackwood` into `cases/blackwood/case.json`; asset checks shared with the validator | S to M |
| `lib/cases.ts` / `lib/request-case.ts` | `DEFAULT_CASE_ID` stays the legacy default for tokens without a case id; documented as such | S |
| `app/case/[caseId]/*` | theme provider (4.4); wrap `<Game>` in `CaseGate` (3.8); no draft handling needed | S |
| `lib/solved-store.ts` (new) | `readSolved` / `markSolved` / `isUnlocked` over `localStorage` key `whodunit:solved`, injectable store, in-memory fallback (3.8) | S |
| `lib/render-case.tsx` | compute `nextCases` (public cases whose `unlockedBy` includes this id) and pass `unlockedBy` titles to the client (3.8) | S |
| `engine/case-schema.ts`, `engine/public-view.ts` | `unlockedBy?: CaseId[]` on the case; public view carries it with the required cases' titles | S |
| `app/api/{investigate,interrogate,confront,accuse,hint}/route.ts` | map new error codes only (progress already attached) | S each |

### 5.2 AI and prompts (`ai/`)

| File | Change | Size |
|---|---|---|
| `ai/prompts/interrogation.ts` | `ERA_RULE` becomes `eraRule(setting)` (golden-pinned to today's string by default; `vocabulary.allowed` replaces the baked-in telephone sentence); roster line from `setting`; module `contextSections` appended | S |
| `ai/order-check.ts` | `LANDMARKS` becomes the default; `landmarksOf` / `orderLines` read the case's `orderLandmarks` (compiled once, safe-regex limits) | M |
| `ai/canon-check.ts` | `findModernWord(text, heard, vocabulary?)` builds the banned set per case (`META_WORDS` + default modern + `vocabulary.banned` - `vocabulary.allowed`); run module `canonChecks` | S |
| `ai/perform-turn.ts` | pass the case vocabulary to `findModernWord` and module checks into `validate`; count consecutive canon failures for R6 | M |
| `ai/confront-handler.ts`, `ai/confront-check.ts` | `CONFRONT_LINES` from `setting`; per-case caps | S |
| `engine/context-builder.ts` (implementation; `ai/context-builder.ts` re-exports) | call `contextSections`; keep the leak scan green with 6 suspects | M |
| `ai/grok.ts` | none (a timeout/budget review is part of R2) | |

### 5.3 Schema and validator

| File | Change | Size |
|---|---|---|
| `engine/case-validation.ts` | split into `checkStructure`, `checkSolution`, `checkKnowledge`, `checkText`, `checkAssets`, `checkLeaks`; accomplice rules; the story checks of 6.5 | L |
| `engine/progression-validation.ts` | confrontation-aware `fastestPath`; budget handling (3.7) | M |
| `scripts/validate-case.ts` | `--strict` (non-zero on any warning), `--smoke`, `--json`; asset check as an error for non-underscore ids; prints both path numbers | M |
| `scripts/new-case.ts` (new) + `package.json` `new:case` | scaffold (6.5) | M |
| `cases/_template/` (new) | the template case (6.5), valid with zero warnings | M |
| `scripts/smoke-playthrough.ts` (new) | scripted solve using the real handlers and the Grok mock (6.4) | L |
| `docs/CASE_FORMAT.md` | every new field, the `features` contract | M |

### 5.4 UI (`components/`, `app/`)

| File | Change | Size |
|---|---|---|
| `components/accuse/AccuseScreen.tsx` | "Did anyone help?" section (new section 2; "A confession" renumbers) with an explicit "No one helped", nothing preselected, **Submit disabled until answered** plus a visible reason (3.2); 3-column suspect grid for 6; richer confirm dialog | M |
| `components/characters/SuspectSelect.tsx` + `suspect-layout.ts` (new) | 6-suspect grid and compact phone cards (3.5) | M |
| `components/dialogue/InterrogationScreen.tsx`, `components/confront/ConfrontScreen.tsx` | per-pair chips, global counter, per-case max | M |
| `components/game/Game.tsx` | remove the `MAX_CONFRONTATION_TURNS` import; theme and audio plumbing; `markSolved(caseId)` on a win (3.8) | M |
| `components/game/CaseGate.tsx`, `LockedScreen.tsx` (new) | read the solved flag after hydration; locked teaser screen with "Play <required case>" (3.8) | S |
| `components/game/TitleScreen.tsx`, `components/ending/EndScreen.tsx` | optional `nextCases` / `nextCase` prop; "NEXT CASE" button on a win, "Next case" on the title once unlocked (3.8); `EndScreen` copy from `setting.site` | S |
| `components/evidence/Notebook.tsx` | `clueImageSrc`; separate Testimony tab (Evidence / Testimony / Leads); empty-state from `setting` | M |
| `components/investigate/InvestigateScreen.tsx` | `locationTilt` hook for `ship-list` | S |
| `components/ending/summary.ts`, `EndScreen.tsx`, `ending/sequence.ts` | accomplice row; copy from `setting`; two-culprit recap | M |
| `components/effects/audio-scenes.ts`, `audio.ts` | `caseAudio` beds and cue overrides (4.4) | M |
| `components/stage/layout.ts` | `REFERENCE` derived from the case's first suspect | S |
| `components/features/registry.ts`, `time-misdirection/`, `ship-list/` (new) | client slots; ship-list panel and tilt | M |
| `lib/game-session.ts` | bump `SESSION_VERSION` only if the saved shape changes; tolerate old shape | S |
| `scripts/check-overflow.ts` | add a 6-suspect case, the picker and the new Notebook tabs to the screens it visits | S |

### 5.5 Tests and docs

Tests are in section 8. Docs: `docs/CASE_FORMAT.md`, `docs/CASE_AUTHORING.md` (replace the "PLANNED" items in §6, §7.1, §7.2 and §8 as each lands; the scaffold command and test template replace the hand-copy instructions), `docs/ARCHITECTURE.md` (feature modules, token v2), `docs/MASTER_PLAN.md` status, this plan, and a one-line "built" note in `docs/BLACKWOOD_PROGRESSION_PROPOSAL.md` (it already carries a status note).

### 5.6 Assets and scripts

| Path | Change |
|---|---|
| `assets/characters/<suspectId>/{neutral,talking,angry,nervous,sad,shocked,smug}.webp`, entries in `assets/characters/anchors.json`, `assets/backgrounds/<locationId>.webp` (+ `_lightning`, `_window_mask`), `assets/clues/<clueId>.webp`, title art | Tallyho art in the layout that exists today, which is **flat and shared across cases**. Two cases that use the same location id or character id would overwrite each other, and `anchors.json` is one file everyone edits. The validator fails on any collision with another case's ids (R10); an optional later move to per-case asset folders is Q14. |
| `assets/audio/*` + `scripts/audio/make_noir.py`, `master_all.py` | new ship beds and cue overrides (4.4) |
| `scripts/gen-timeline.ts` (new, optional) | generate the roughly 161 checkpoint timeline rows (R12) from a compact movement grid; the reviewed output is checked in as JSON |
| `scripts/playtest.ts` (new, manual) | live-model soak (8.5), not run in CI |

---

## 6. Adding a new case: checklist, one validator, and the tooling

### 6.1 Authoring checklist (what a story/art/sound person does)

This extends `docs/CASE_AUTHORING.md` §2 (design doc first, review gate, JSON order, validator, tests, proof). Steps that change:

1. **Scaffold:** `npm run new:case -- <id>` (6.5) creates `cases/_<id>/` from `cases/_template` and `tests/cases/<id>.test.ts` from `tests/cases/_template.test.ts`. No hand copying. The leading `_` keeps it unroutable (F11).
2. Write the design doc and get it reviewed (unchanged, `CASE_AUTHORING.md` §2).
3. Write `case.json` (meta, `setting`, `theme`, `orderLandmarks`, `audio`, victim, locations, evidence, facts, motives, weapons, `leads`, `accuseGate`, `confrontation`, `lint`, `features`/`featureConfig`), `solution.json` (incl. `accompliceId`/`accompliceAct` when two culprits), `timeline.json`, `characters/*.json`, `endings.json`.
4. Decide whether the case needs a *new mechanic*. If it fits an existing module, declare it. If not, open an engineering ticket for a new module **before** writing the dependent story beats.
5. Add art (7 poses per suspect + an `anchors.json` entry, a background per location, clue art `assets/clues/<clueId>.webp`, title art) and sound (beds and cue overrides named in `case.json audio`).
6. `npm run validate:case -- _<id> --strict` until it prints no errors **and no warnings**; read the two path numbers it prints and write them in the design doc.
7. `npm run validate:case -- _<id> --smoke` (scripted playthrough with the model mocked).
8. `npx vitest run tests/cases/<id>.test.ts` (the template test, filled in with the case's pinned numbers and a few story assertions).
9. Live soak with a real model once (8.5); read transcripts for spoilers and tone.
10. **Publish PR:** `npm run publish:case -- <id>` (6.5) runs the strict gate and then renames `_<id>` to `<id>` (updating the id and the test constant). CI re-runs the strict gate on every non-underscore case (D5).

### 6.2 Checks (severity: **E** = error, fails the load or CI; **W** = warning, fails `--strict`; **I** = info). "Exists" = already on `main`.

| # | Check | Sev | Status |
|---|---|---|---|
| V1 | `case.json` / `solution.json` / `timeline.json` / `characters/*.json` / `endings.json` parse against the strict Zod schemas | E | exists (`validateCase`) |
| V2 | Ids unique per namespace, `IdSchema`-valid, folder name equals `meta.id`; facts and timeline share one namespace; **ids do not collide with another case's asset-backed ids** (locations, characters) | E | collisions new |
| V3 | Every reference resolves (`knownFactIds`, `relatedFactIds`, `involvesCharacterIds`, reveal conditions, lies, endings, jabs) | E | exists (`checkCaseReferences`) |
| V4 | Murderer, accomplice, weapon, location, motive, key evidence, key testimony all exist; `accompliceId !== murdererId`; the victim is not a suspect | E | accomplice new |
| V5 | **Opportunity rule** for the murderer (exists) and for the accomplice: `accompliceAct` must have a timeline entry placing the accomplice at `accompliceAct.locationId` within `OPPORTUNITY_WINDOW_MINUTES` of `accompliceAct.time` | E | accomplice new |
| V6 | Every non-culprit suspect has a secret (**now excluding both culprits**); every suspect has an `endings.wrong` entry | E | extends exists |
| V7 | **Reachability**: every room, clue, lead, the accuse gate, key evidence and key testimony reachable from an empty state; no cycles | E | exists (`checkProgression`, `simulate`) |
| V8 | **Solvability**: the win rule is satisfiable (`minKeyEvidence`, `minKeyTestimony`, and each `keyTestimonyGroups` group), and the gate can open | E | mostly exists; groups new |
| V9 | **Soft-lock freedom**: the model-outage run (6.3) still reaches the gate; required secrets have a fallback path (R6) | E | new |
| V10 | **Fastest path**: both numbers are printed, with and without confrontations, and must equal the numbers pinned in the case test | I / E in test | prints one number today |
| V11 | **Knowledge boundaries** (moved from `tests/cases/blackwood.test.ts`): nobody knows a located timeline entry from somewhere they were not; everyone knows their own whereabouts; perception facts (non-canonical `source`) are known only by the perceivers they involve; each intended lie is about something the liar knows; every incriminating fact a character knows is linked to their own secret or lie | E (located entries) / W | **new in validator**, tests-only today |
| V12 | **Timeline presence**: every suspect is in exactly one place at every checkpoint; every located entry (point or window) only involves people who are there throughout; no one in transit; travel times respected; the murderer is at the scene at the murder time and no innocent is; the body is found where and when the victim card says | E | **new in validator**, tests-only today |
| V13 | **Clock and order consistency**: a secret's `testimonySummary` uses only clock times from its owner's own knowledge; summaries <= 240 chars; lead titles <= 70, hints <= 240, `lockedLine` <= 160; `orderLandmarks` patterns compile and each matches at least one fact (otherwise inert); a lie's claim and its fact agree on the order of the case's landmarks | E / W | summary rules and landmark checks new |
| V14 | **Giveaway words in free text**: goals, personality, speech style, relationship notes, `jabs` and `defensiveOn` text contain none of a default giveaway list (alibi, secret, stole, hid, overheard, never left, hated him, ...) plus the case's optional `lint.giveawayWords` | W | tests-only today (Blackwood's own list includes "phone") |
| V15 | **Public text names no suspect or hidden fact**: location text, `searchFlavor`, `discoveryLine`, `lockedLine`, lead titles/hints/closed lines, `intro`, motive labels contain no suspect name/alias, no weapon name before discovery, and not the true time or place | E | tests-only today (`blackwood-content.test.ts`) |
| V16 | **Leak: prompt scan.** For each suspect build `buildCharacterContext` for a set of states (empty, mid-game, all revealed) and scan the system prompt: no solution keys, no other suspects' secrets, no unrevealed reveal-condition text, no `hiddenUntil` fact text | E | helper exists in tests; promote to `engine/leak-scan.ts` |
| V17 | **Leak: API bodies and loss endings.** Public view, handler responses and every wrong-accusation ending (each single suspect; each doer/stager combination) carry no culprit line, no culprit-only phrasing and no solution text; `progress` carries ids and counts only | E | new |
| V18 | **Feature declarations**: `features` declared <=> registered <=> configured; each `featureConfig` parses; each module's `validate` / `warn` pass; `publicConfig` holds no solution ids | E | new |
| V19 | `time-misdirection` (3.3) and `ship-list` (3.4) rules | E / W | new |
| V20 | **Setting/theme**: all `setting` fields present when non-default; `theme.colors` are valid CSS colours with a contrast ratio at or above 4.5 for text on paper; `theme.title.*` assets exist | E / W | new |
| V21 | **Assets exist** (E for non-underscore ids, W for drafts): every `location.background`, `backdrops.*`, `evidence.image` (or `assets/clues/<id>.webp` where a clue declares art), module frames, `theme` art; for each suspect all 7 poses (`neutral, talking, angry, nervous, sad, shocked, smug`) **and** an entry in `assets/characters/anchors.json` (otherwise a silhouette shows); `assets/backgrounds/<locationId>.webp` for every room | E / W | only `backdrops` and `background` today, warn-only |
| V22 | **Audio**: every bed and cue file named in `case.audio` exists as `.mp3` and `.ogg`; cue names are valid `AudioCue`s | E | new |
| V23 | **Placeholder guard**: no `TODO`, `PLACEHOLDER`, `FIXME` or template stub text in any authored string of a non-underscore case | E | new (needed because the template ships stubs) |
| V24 | **Token budget**: simulate a max-chat state (all suspects, all pairs, caps reached, replies at schema maximum) and fail if the encoded token exceeds the budget after trimming | E | new (R1) |
| V25 | **Prompt budget**: report the longest system prompt (chars/tokens); warn above a threshold (Blackwood: 9.3K to 12.5K chars) | W | new |
| V26 | **Era/voice**: `vocabulary.allowed` and `vocabulary.banned` do not overlap and `allowed` avoids the always-banned meta words; no authored string (bios, secrets, lies, facts, `lockedLine`s, endings) contains a banned word | W (E for non-underscore ids) | new |
| V27 | **Confrontation**: `maxPerPair`, `maxTotal` sane; every pair that can open has something to throw (shared fact or testimony), else it is reported | W / I | new |
| V28 | **Docs drift**: `CASE_FORMAT.md` lists every top-level field the schema accepts | W | new |
| V29 | **Smoke playthrough** (6.4) passes | E | new |
| V30 | **Publish gate**: every non-underscore case under `cases/` passes V1 to V32 with `--strict` in CI | E | new (D5) |
| V31 | **Unlock graph**: every id in `unlockedBy` is a case in the repo, not the case itself, with no cycles; at least one case has no `unlockedBy` (otherwise nothing can be played first) | E | new (3.8) |
| V32 | **Authority is not a suspect**: `setting.authority.noun` (ignoring "the") matches no suspect's name, alias or role; `policeAboard: false` cases have no line that says police are present | E | new (4.4) |

### 6.3 The solvability simulation (extends `engine/progression-validation.ts`)

`simulate` (generous fixed point) and `fastestPath` (breadth-first, exact) already exist and are the base. Extensions:

- **Confront move:** `confront(a, b)` costs 1 action, adds an exchange to each side (F7), and consumes the per-pair and total caps. The validator prints the floor **with** and **without** confrontations (Q3).
- **Multi-culprit and groups:** `done()` also requires each `keyTestimonyGroups` group; the accusation itself must name a valid doer/stager pair.
- **Model-outage run:** a second pass where no reveal is "performed by the model" (all fallbacks), using the pending-reveal fallback rule (R6). If the gate cannot open, V9 fails.
- **Budget:** keep `FASTEST_PATH_BUDGET`, but report "could not be computed" as an **error** for non-underscore cases (today it is a note), since publication needs the number.
- **Module hooks:** `simulate()` lets a module add or remove edges (rare).

### 6.4 The smoke playthrough (`scripts/smoke-playthrough.ts`)

Drives the **real handlers** (`handleInvestigate`, `handleInterrogate`, `handleConfront`, `handleAccuse`) with `tests/helpers/grok-mock.ts` standing in for the model, following the simulator's cheapest winning path. Asserts:

1. each unlock occurs at the step the design says and **not earlier** (a locked door stays locked; a gated clue stays hidden; ACCUSE returns 403 `accuse_locked` until the gate opens);
2. the winning accusation wins;
3. every single-field mutation of the winning accusation (murderer, accomplice, weapon, motive, each key clue, each key testimony group, a wrong "no one helped") **loses**;
4. every loss body passes the leak scan (V17);
5. the token stays under the cap and round-trips through v1 and v2 decode (section 7);
6. replaying the same token after the verdict returns the original verdict (`engine/accuse-handler.ts` treats a concluded token as final).

### 6.5 Authoring tooling

**Scaffold command: `npm run new:case -- <id> [--title "..."]`** (`scripts/new-case.ts`, new)

- Validates `<id>` against `PUBLIC_CASE_ID_RE` (no leading `_`, kebab/snake case, at most 64 chars) and refuses if `cases/<id>` or `cases/_<id>` already exists.
- Copies `cases/_template/` to `cases/_<id>/` (leading `_` = unroutable), sets `id` to `_<id>` (the loader requires id == folder name) and `title`, and replaces a small set of tokens (`__CASE_ID__`, `__TITLE__`).
- Copies `tests/cases/_template.test.ts` to `tests/cases/<id>.test.ts` with the case id constant set, and creates a stub `cases/_<id>/docs/SOLUTION_PROOF.md` and `docs/cases/<NAME>_DESIGN.md` (a heading list that mirrors `CASE_AUTHORING.md` §2).
- Prints the next five commands (validate, test, soak, publish) and the art/sound ask list.
- Companion `npm run publish:case -- <id>`: runs the strict validator and the case test, then renames `_<id>` to `<id>` and fixes the id and the test constant. It does not commit or push.

**`cases/_template/`** (new; replaces hand-copying `cases/_placeholder`):

- All required files with the smallest valid cast (3 suspects: doer, two innocents), 3 rooms, 4 clues, one lead and one gated room, and an `accuseGate` so the progression path is exercised. `emptyLine` and `lockedLine` stubs (for example `"TODO: one funny line saying nothing new is here"`), a testimony-summary stub, a complete `endings.json`, `setting`, `theme`, `orderLandmarks` and `audio` blocks with the default values, and a `docs/SOLUTION_PROOF.md` skeleton.
- **It validates with zero warnings** (stubs are grammatical placeholders, not empty strings), so CI keeps the template honest. V23 forbids the stub markers in any non-underscore case, so a half-filled template cannot be published.
- `cases/_placeholder` stays until `tests/engine/case-registry.test.ts`, `tests/app/seo.test.ts` and `tests/lib/request-case.test.ts` (which use it as the "hidden id" example) are retargeted to `_template`, then it is deleted.

**One validator.** Move the generic story checks out of `tests/cases/blackwood.test.ts` and `tests/cases/blackwood-content.test.ts` into `engine/case-validation.ts` as V11 to V15 (table above). What stays as case tests is genuinely case-specific: the pinned numbers, the named murderer/weapon/clues, the exact deduction chain, and Blackwood's order-of-events narrative. Blackwood's tests then shrink to those plus one call to the validator, and the validator is tested on the fixtures (including deliberately broken copies, one per check). Accomplice checks do not exist anywhere today (not even in Blackwood's tests), so they are written once in the validator.

**Case-test template: `tests/cases/_template.test.ts`** (new; also run against `_template` itself):

| Section | What it asserts |
|---|---|
| Loads clean | `validateCase(id).issues` is `[]` and `checkCaseWarnings(c)` is `[]` (zero warnings); the strict validator passes |
| Pinned paths | `fastestPath(c)` equals a number in the file (and, once confrontations are modelled, the with/without-confrontation numbers); a comment says to copy it from the design doc |
| Timeline presence | each suspect has exactly one place at every checkpoint; located entries involve only people present throughout (V12), kept as an explicit test so a data edit breaks CI with the entry id |
| Knowledge boundaries | V11, run as a test with the case's own roster |
| Free text and public text | V14 and V15 with the case's `lint` additions |
| Summaries | testimony summaries <= 240 chars and the owner's clock times (V13) |
| Endings | `endings.json` has a confession, a recap whose time and place match `solution.json`, and a `wrong` entry for every suspect; the confession cites the weapon and key evidence; with two culprits, no loss ending contains a culprit line |
| Story pins (author fills in) | named doer/stager, weapon, key clues, key testimony, and "provable from evidence with no confession" |

---

## 7. Blackwood migration and token versioning

### 7.1 No-breakage rules

1. **Golden snapshots first (phase 2):** commit snapshot tests for Blackwood's behaviour **as it is now, with progression**: its public view (including `progress`), a fixed list of search results at fixed states, the context for every suspect at fixed states, the grading result for a set of accusations, and the ending payload for each ending. Phases 3 to 6 must leave these unchanged. (`tests/cases/blackwood-progression.test.ts` already pins the gates and the 10-action path.)
2. **Every new field is optional with a default that reproduces today.** Blackwood's data does not change unless a phase says so. Phase 3 moves Blackwood's hard-coded values into its own `case.json` (its `setting`, `orderLandmarks`, `ART_DEFAULTS` backdrop); a golden test proves the strings, prompts and landmark matches are identical.
3. **Blackwood's progression migration is done** (#36). There is no separate "Blackwood data PR" left in this plan, and Q7 (go-ahead to change live Blackwood) is closed. The only remaining visible change for Blackwood players is the **"Did anyone help?" picker** (phase 5): one extra tap, answer "No one helped". Old clients that omit `accompliceId` grade as "no one" (3.1), so a stale tab still works.
4. **A game in flight survives every release.** Progression added no token state, and the optional `keyTestimonyIds` was already accepted. The new stored `accompliceId` is optional, so a v1 token stays valid (7.2).

### 7.2 Token versioning (`engine/state-token.ts`)

Facts: `TOKEN_VERSION = "v1"`; `verifiedPayload` rejects any other version; `TokenPayloadSchema` is strict; a bad token is `malformed` and resets the game (F5). Progression adds **no** token state, so in-flight Blackwood tokens stay valid. The two-culprit change touches only the stored `accusation` (new optional `accompliceId`, `keyTestimonyIds`), which is a strict-schema extension and therefore needs the version bump rules below.

| Release | Decode | Encode | Purpose |
|---|---|---|---|
| **A** | v1 and v2 | **v1** | Ships the v2 decoder everywhere first, so a rollback of the next release cannot strand v2 tokens. The strict schema for v1 gains only optional fields. |
| **B** | v1 and v2 | **v2** (deflate-compressed payload, same HMAC secret and signing scheme, `v2.` prefix) | New tokens are smaller. Existing v1 tokens are re-encoded as v2 on the next action. |
| **C** (later) | v2 only | v2 | Remove v1 once the v1 population has aged out (the session lifetime is one browser session; a few days is ample). |

- **Rollback (R11):** if B is rolled back, tokens already issued as v2 would be rejected as malformed. Mitigation: A has been live long enough that the previous release (A) still decodes v2. The release plan forbids deploying B without A having been in production.
- **Size budget (`TOKEN_BUDGET`, per case):** `engine/state-token.ts` computes the encoded size on every encode; above, say, 80% of the cap it **trims** oldest-first: memory entries beyond a lower count, old statement text to its summary, then old `claims`. It never trims facts, secrets, evidence, or progress state (the things the engine needs for correctness). `restoreSession` no longer treats "too big" as `malformed`. Compression may make trimming unnecessary (Q8); trimming stays as the safety net because the token travels in every request body and the right ceiling should be checked against platform request-size limits (R1; not verified here).
- **`MAX_*` constants in the schema.** With per-case confrontation limits the schema ceiling must be raised and the case value enforced at runtime (3.6); a token with `turnsUsed` above the case value is rejected by `spendExchange`, not by the schema.

### 7.3 Migration tests

- Golden tokens: a v1 token produced by `main` today decodes and plays on the new code (stored as a fixture).
- A v2 token round-trips; a tampered v2 token fails the signature; a v2 token on code that only knows v1 is simulated and fails closed.
- A synthetic max-size 6-suspect state encodes under the budget after trimming, and the trimmed state still plays (an interrogation, a search, an accusation).
- `lib/game-session.ts`: a `SESSION_VERSION = 1` blob (sessionStorage) is accepted or cleanly discarded.

---

## 8. Test plan

Existing: Vitest (`npm test`), `tests/engine`, `tests/cases`, `tests/components`, `tests/lib`, `tests/e2e/second-case.test.ts`, `tests/helpers/{fixture,grok-mock,leak-scan}.ts`, fixtures `fixture-manor` and `harbor-light`. New work extends these rather than inventing a second harness.

### 8.1 Unit tests by area

| Area | Tests |
|---|---|
| Grading | Table-driven: win; wrong murderer; wrong or missing accomplice; accomplice named in a one-culprit case; roles swapped; swapped weapon/motive; `minKeyEvidence`; `keyTestimonyGroups`; unrevealed testimony id rejected; `accomplice_is_murderer`. |
| Endings | `lossBeats` for every wrong accusation: no culprit lines; `wrong[accusedId]` never used for a culprit; two-actor win sequence; `summaryRows` accomplice row. |
| Progression (extensions only; the base is covered by `tests/engine/progress.test.ts`, `progression-validation.test.ts`, `progression-routes.test.ts`) | Confront move in `fastestPath`; `keyTestimonyGroups`; any new atom; Tallyho-scale simulator timing. |
| Token | v1 and v2 decode; compression round trip; tamper; budget trimming; 6-suspect size with the max-chat fixture. |
| Confrontation | Per-case caps; 15 pairs open and close; total cap across pairs; both-sides `interrogationCount` (F7); schema ceiling. |
| Context/prompt | 6-suspect contexts: leak scan clean; roster has 5 others; `setting` strings used; module `contextSections` leak-scanned. |
| Canon | `time-misdirection` accept/reject golden sets; skip for a maintained lie; `setting.vocabulary` (allowed wins on overlap; "phones" bans phone/phones but not "telephone" or "gramophone"; Blackwood's `eraRule` string unchanged). |
| Unlock (3.8) | `solved-store` read/write/corrupt/missing storage; `isUnlocked` all/none/some solved; `CaseGate` splash then locked or game; `EndScreen` "NEXT CASE" only on a win with a next case; locked case still in the sitemap; V31 negative cases. |
| Picker (3.2) | Submit disabled until "No one helped" or a suspect is chosen; changing the murderer clears a clashing helper; `undefined` fails `validateAccusationDraft`; `null` and an absent field both grade as "no one" server-side. |
| Registry | `features` declared <=> registered <=> configured; drafts excluded from `listPublicCaseIds` and the sitemap. |
| Agnosticism | `tests/engine/case-agnostic.test.ts` widened to `engine/`, `ai/`, `components/`, `lib/`, `app/` and to all case ids and character names found under `cases/`. |

### 8.2 Fixtures

Existing fixtures `fixture-manor`, `harbor-light` and `tests/fixtures/progression/progress-light` stay. Add `tests/fixtures/cases/two-hands` (small, 5 to 6 suspects, a second culprit, progression, both feature modules, a tiny set of 1x1 placeholder assets) so engine tests do not depend on Tallyho's content or art. Tallyho itself gets `tests/cases/tallyho.test.ts` (content assertions like `blackwood-content.test.ts`).

### 8.3 Case tests

- `tests/cases/_template.test.ts` (6.5): the case-test template, run against `cases/_template` in CI and copied by `new:case` to `tests/cases/<id>.test.ts`.
- `tests/cases/tallyho.test.ts`: the filled-in template (strict validation with zero warnings, both fastest-path numbers pinned to the design doc, smoke playthrough, spoiler scan) plus story pins.
- Blackwood: `tests/cases/blackwood*.test.ts` keep passing at every phase. After phase 8 the generic checks they contain (knowledge boundaries, timeline presence, free text, public text, summaries) are provided by the validator (V11 to V15) and the files shrink to Blackwood-specific story assertions plus one strict-validator call.
- Validator tests: each check has a deliberately broken copy of a fixture that must fail with the expected message (one per V-number), so a weakened check fails CI.

### 8.4 UI and layout

- `npm run check:overflow` at all 8 viewports (360x740, 390x844, 430x932, 740x360, 844x390, 768x1024, 1024x768, 1280x800) on: suspect select (6), accuse (picker + 6), notebook (Clues / Testimony / Leads tabs), investigate (padlocks), confront (counter), end screen (two culprits). Save screenshots (`--shots`) in the PR.
- Component tests for `suspectLayout(n)`, `summaryRows`, `notebook-model.ts`, and the audio scene mapping with data beds (`tests/components`).
- Optional (not in the open questions; a tooling call for Dexter): one Playwright smoke test of the happy path on a phone viewport.

### 8.5 Live-model soak (manual, not CI): `scripts/playtest.ts`

Scripted conversations with a real model against Tallyho, logging: canon-check rejection rate per character, fallback rate, any reply that contains a solution string, mean/p95 latency per interrogation and per confrontation exchange, and the staged-time assertion rate (R3). Run before each content freeze and after any prompt change. Output is the evidence for R2 (latency/cost) and R3.

---

## 9. Build order (numbered, with sizes)

Owners follow the studio roles in `docs/MASTER_PLAN.md`: Dexter (engineering), Agatha (story/data), Toon (art/sound). Sizes: S = about 1 to 3 commits, M = 4 to 8, L = 9+. Commit counts are ballpark.

| # | Phase | Contents | Size | Commits | Depends on |
|---|---|---|---|---|---|
| 1 | **Progression** | **DONE.** Engine (`5831a5e..4709822`), UI (`5610094`), Blackwood data (#36), authoring guide (#35). Left over: see 3.7 (simulator confront move; optional atoms) which sit in phases 5 and 8. | done | about 20 shipped | |
| 2 | **Decisions and golden snapshots** | George answers the remaining open questions that block phase 3 onward (Q3, Q7); Blackwood golden snapshots (with progression); the max-chat token fixture; the "no source change for a new case" CI check | S | 2 | |
| 3 | **Case-agnostic hardening** | `setting` (place, decade, dateLine, site, authority, roster, vocabulary), `theme` + theme provider, `orderLandmarks` (Blackwood's five move to its data), `Evidence.image` -> `AssetPathSchema` + `clueImageSrc`, per-case audio hook, `REFERENCE`, `ART_DEFAULTS`, widen the case-agnostic test | L | 10 to 14 | 2 |
| 4 | **Token v2** | Release A (decode v1+v2, encode v1), Release B (encode v2, deflate, budget trimming), tests; plan Release C | M | 4 to 6 | 2 |
| 5 | **Two-culprit grading and the picker** | `accompliceId`/`accompliceAct` in solution, accusation, token; `gradeAccusation`; verdict, reveal and summary row; `lossBeats`; the picker UI; validator rules V4 to V6; fixture `two-hands`; optional `keyTestimonyGroups` | M | 7 to 9 | 3, 4 |
| 6 | **Feature framework and the two modules** | `engine/features/*`; `time-misdirection`; `ship-list`; client slots; module tests | M | 6 to 9 | 5 |
| 7 | **6-suspect UI and confrontation** | `suspectLayout`, compact cards, accuse grid, Notebook Testimony tab, per-case confrontation limits, per-pair chips and counter, `check:overflow` updated | M | 7 to 10 | 5 |
| 8 | **Validator v2, simulator, smoke, authoring tooling** | split `case-validation.ts`; V9 to V30 (incl. the story checks moved from Blackwood's tests); confront-aware `fastestPath` + outage run; `engine/leak-scan.ts`; `scripts/smoke-playthrough.ts`; `new:case` / `publish:case`; `cases/_template` + `tests/cases/_template.test.ts`; shrink Blackwood's tests; CI strict gate; `CASE_FORMAT.md` and `CASE_AUTHORING.md` updated | L | 12 to 17 | 3, 5, 6 (the tooling and the moved story checks can start after 3) |
| 9 | **Tallyho content, art and sound** | JSON (Agatha, in `cases/_tallyho`), art and anchors (Toon), ship beds and cue overrides (Toon), timeline generator; stays under the `_` prefix until phase 11 | L | 12 to 20 (mostly JSON) | 8 for validation; art can start earlier |
| 10 | **Case unlock** (3.8) | `unlockedBy` in schema, registry and validator (V31); `lib/solved-store.ts` + tests; `CaseGate` / `LockedScreen`; "NEXT CASE" on the win screen and "Next case" on the title; `markSolved` on a win | S to M | 4 to 6 | 3 |
| 11 | **Release hardening** | live soak and fixes, `check:overflow` screenshots reviewed, accessibility pass, `publish:case` (rename to `tallyho`), verify the unlock end to end on a real device (win Blackwood, land on Tallyho), analytics decision (Q13) | S to M | 3 to 5 | 9, 10 |

**Totals:** remaining engineering is about **55 to 75 commits** (phases 2 to 8, 10 and 11); progression's roughly 20 are already shipped (the first plan counted 60 to 85 with it). **Critical path:** 3 -> 5 -> 6 -> 8 -> 9 -> 11. Phases 4 and 7 run in parallel with it, and the scaffold/template/validator-move part of phase 8 can start right after phase 3, so Agatha gets the tooling before Tallyho content (phase 9) starts. Art (phase 9) can start as soon as the design is approved, since it depends only on `docs/ART_BIBLE.md` and the asset list in `TALLYHO_DESIGN.md` section 10.

**Ordering rationale:** hardening first because Tallyho's wording, order check, theme and sound are all Blackwood's today; token v2 before the 6-suspect UI because 6 suspects are what stress it; the validator, simulator and scaffold before Tallyho content, so content is written against a checker rather than checked afterwards; Tallyho stays under `_tallyho` until phase 11 so the repo can merge content continuously without exposing it.

---

## 10. Risks and open questions

### 10.1 Risks

| # | Risk | Likelihood / impact | Mitigation | Evidence |
|---|---|---|---|---|
| R1 | **Token overflow with 6 suspects** silently resets the game | Low-medium / **high** | Token v2 (deflate), budget with trimming, `restoreSession` stops resetting on size, V24, platform request-size check | F5: typical about 26K, synthetic worst case about 81K vs the 60K cap |
| R2 | **Prompt cost and latency**: 15 pairs, 2 calls per exchange | Medium / medium | Caps bound the total (4 per pair, 16 total = 32 calls); `maxDuration = 60` margin is thin (worst 48 s); consider one call per exchange; soak-test p95 | F6, F14; typical latency **not measured** |
| R3 | **LLM drift on time-misdirection**: the model states the staged time as fact | **High** / high | `time-misdirection` canon check, authored lies carry the staging, adversarial test set, live soak counting rejection rates | 3.3 |
| R4 | **Mobile UI density** with 6 suspects, a 10-clue notebook, a 6-pair picker | Medium / medium | Compact cards, Testimony tab, 44px targets, `check:overflow --shots` at 8 viewports | 3.5, F17 |
| R5 | **Balance / grind**: 24 forced exchanges, 32-action floor, long total | Medium / medium | The simulator reports the true floor (with and without confrontations); every locked door carries a nudge; consider reducing the talk gate (Q11) | design 9.5; F7 |
| R6 | **Required-secret soft-lock**: repeated canon failures keep a gate-critical reveal pending | Low / **high** | Pending-reveal fallback after N failures, validator outage run (V9) | F7 |
| R7 | **Spoiler leaks** via prompts, public strings, API bodies, loss endings, `lockedLine`, `featureConfig`, theme text | Medium / **high** | V15 to V18; public types separate from internal; scan in the smoke run; `featureConfig` never shipped | F3 |
| R8 | **The new accusation flow** confuses players (a half-right loss) | Medium / medium | Always-visible explicit picker, confirm dialog repeats the choice, generic loss only (Q12) | design 11.3 |
| R9 | **Publishing accident**: someone renames `_tallyho` to `tallyho` (or adds a plain-id folder) before it is ready | Medium / medium | `_` prefix already hides drafts (F11); CI strict gate (V30) and `publish:case` | `engine/case-registry.ts` |
| R10 | **Asset collisions**: assets are a flat, shared namespace, and `anchors.json` is one shared file | Medium / medium | V2/V21 collision checks; reviewer rule for `anchors.json`; possible namespacing (Q14) | F13 |
| R11 | **Token rollback** after v2 is live | Low / high | Release A before B; B is not deployed until A has run in production | 7.2 |
| R12 | **Authoring burden**: about 161 checkpoint rows, 12 leads, 15 secrets | High / medium | `scripts/gen-timeline.ts`, scaffold and validator from day one (phase 8 before phase 9) | design 12 |
| R13 | **Era/voice mismatch**: Blackwood's era text, constable, house, landmarks | High (if unfixed) / medium | `setting` incl. vocabulary and authority, `orderLandmarks` (phase 3; wording decided, see Decisions) | F8, F9 |
| R14 | **Discoverability**: with no case chooser, a player who has not solved Blackwood cannot find case two, and a winner might miss it | Medium / medium | Decided unlock flow (3.8): a "NEXT CASE" button on the win screen and a "Next case" button on the title once unlocked | F11 |
| R19 | **The client-side unlock is lost or spoofed**: cleared storage, another device or private mode locks a returning player out; devtools or a direct API call bypasses it | High (lockout) / low (no stakes) | Accepted trade-off (3.8): the lock is for pacing, not security. A friendly locked screen that sends the player to Blackwood; in-memory fallback when storage is blocked; escape hatch is Q17 | 3.8 |
| R15 | **Scope creep**: the framework becomes bigger than the game | Medium / medium | Only two modules built; any third mechanic is a ticket reviewed against "can data do this?" | principle 3 |
| R16 | **Validator false positives** after moving the story checks (V11 to V15) block good cases | Medium / medium | Introduce them as W first, promote to E after Tallyho passes; per-case `lint` allowances; fixtures with one broken copy per check | 6.5 |
| R17 | **Simulator state explosion** with 6 suspects and a confront move | Medium / low | Exchange counts already capped by `exchangeCap`; budget error handling; measure in phase 8 | 3.7 |
| R18 | **Order landmarks as author-written regexes** can be wrong or slow | Low-medium / medium | Compile at load with length limits; validator requires a match in the case's own facts; default list unchanged for Blackwood | 4.4 |

### 10.2 Open questions (for George and the PM)

Q1, Q2, Q4, Q5 and Q6 were decided and moved to "Decisions made" near the top; their numbers are not reused. Q7 is narrowed to theme scope.

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| Q3 | **Do confrontation exchanges count towards the talk gate?** Today they do (F7). | Accept for now; the simulator reports both floors; revisit with playtest data | phase 8 |
| Q7 | **How far does per-case theming go?** (The `setting` block is decided; this is only `theme`.) Colours + logo + title art only, or fonts and layout too? | Colours, logo and title art only for now | phase 3 |
| Q8 | **Deflate, or trimming only,** for the token? | Both: deflate first, trimming as a safety net | phase 4 |
| Q9 | **`keyTestimonyGroups`** (S) and the pending-reveal fallback after N failures (M)? | Yes to both | phase 5 |
| Q10 | **Testimony-triggered reveals** (G4) and a `lieBrokenIds` atom (G8)? Not needed for Tallyho. | Defer both | |
| Q11 | **Length and balance**: is a 32-action floor (about 45 to 70 typical) right for a public game? | Playtest before deciding; the gate values are data | phase 11 |
| Q12 | **A "half right" loss line** (one culprit correct)? | Keep it off: it leaks (#22). The generic loss only | phase 5 |
| Q13 | **Analytics** (where players stall)? No dependency exists today. | Decide privacy stance; start with the soak script, not client telemetry | phase 11 |
| Q14 | **Namespace assets per case** or stay flat with collision checks? | Flat + checks now; namespace if a third case arrives | phase 3 |
| Q15 | **Validator strictness rollout** (R16): warnings first, then errors? Who owns the per-case `lint` allowances? | Warn first for one case cycle, then promote | phase 8 |
| Q16 | **`publish:case` as a script** vs a manual rename in the release PR (`CASE_AUTHORING.md` §7.3 today)? | Script, plus the CI gate | phase 8 |
| Q17 | **Escape hatch for the unlock?** Players who clear storage, switch device or use private mode must replay Blackwood. Options: none (as decided), a quiet "I already solved it" link on the locked screen (turns the lock into a speed bump), or a short copy-paste "unlock code" shown on the Blackwood win screen. | None for now, as decided; revisit if players complain | phase 10 |

---

## Appendix: how this plan was checked

- Fetched `origin/main` (`c71b0da`, which includes progression, Blackwood's progression data and the authoring guide) and rebased this branch on it; worked in a separate git worktree (`/workspace/whodunit-plan`), so the other engineer's checkout was not touched. No code was changed; this PR adds one doc.
- Read: `docs/cases/TALLYHO_DESIGN.md`, `docs/BLACKWOOD_PROGRESSION_PROPOSAL.md`, `docs/CASE_AUTHORING.md`, `docs/CASE_FORMAT.md`, `docs/MASTER_PLAN.md`, `docs/ART_BIBLE.md`, `docs/ARCHITECTURE.md`, and the engine, AI, component, lib, app, script, case and test code named above, including the progression diff from `09e4962` to `c71b0da`.
- Confirmed against code before writing: progression exists (`engine/progress.ts`, `engine/progression-validation.ts`, `engine/route-progress.ts`); there is no `accompliceId` anywhere outside docs (`rg accomplice engine ai components lib app scripts tests`); the story checks live only in Blackwood's tests; `ERA_RULE`, five `LANDMARKS`, the three global beds and `REFERENCE = "reginald"` are hard-coded; `Evidence.image` is `IdSchema` while `Notebook.tsx` uses it as a raw `src`; there is no `theme`; `_`-prefixed folders are never served (`PUBLIC_CASE_ID_RE`).
- **Revision 3 verification:** rebased on `main` at `5cdc9d4` (new commits since revision 2 touched phone framing, the end screen listing cited confessions, lead handling and confrontation hygiene; none changes a claim here). Before writing the unlock section I read `app/page.tsx`, `app/case/[caseId]/page.tsx`, `lib/render-case.tsx`, `components/game/TitleScreen.tsx`, `components/ending/EndScreen.tsx`, `components/game/Game.tsx` (`setResult`, `playAgain`), `lib/game-session.ts` and `components/effects/audio.ts` to confirm that the only browser storage is `sessionStorage` (game) and `localStorage` (mute), and that no win is stored across sessions. For the vocabulary rule I read `ai/canon-check.ts` (`MODERN_WORDS`, `findModernWord`), `ai/perform-turn.ts` (its caller) and `ai/prompts/interrogation.ts` (`ERA_RULE`). The `orderLandmarks` entries and the purser are Agatha's decisions; the purser, the 1936 date and the vocabulary lists are **not yet in `TALLYHO_DESIGN.md`**, which still states no year, so that doc needs a matching update.
- **Corrected from revision 1:** I had proposed a `status: draft` field and a `POST /api/progress` route. The `_` prefix already hides drafts (F11), and progress is derived server-side and saved with the session (F16), so both are dropped. I had also described the design's "fastest path = 32" as what the simulator computes; `fastestPath` does not model confrontations (F7), which is now an explicit phase 8 item.
- **Measured** at the earlier base `09e4962` (throw-away scripts using Blackwood and a synthetic full state; not committed): state-token size (typical 17.5K chars for 4 suspects, worst case 53.8K, so about 26K and about 81K projected at 6 against the 60,000 cap) and system-prompt size (9.3K to 12.5K chars, 26 to 39 known facts per character). Progression added no token fields.
- **Not measured:** live model latency, real-transcript compression ratios, how often real replies hit the schema maxima, how often a confrontation call times out, the simulator's state-space growth at 6 suspects. They are listed as risks (R1, R2, R17) and as outputs of the soak script (8.5), not as facts.
- Numbers quoted from the Tallyho design (32-action floor, 161 timeline rows, 12 leads) are the design's own claims; the simulator (phase 8) is what re-checks them.
