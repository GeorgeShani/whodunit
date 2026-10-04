# Case two (S.S. Tallyho): implementation plan

| | |
|---|---|
| **Status** | **Plan for George to approve. Nothing here is implemented.** Docs-only PR. |
| **Branch** | `docs/case-two-plan` (base `main` at `09e4962`) |
| **Inputs** | `docs/cases/TALLYHO_DESIGN.md` (PR #33), `docs/BLACKWOOD_PROGRESSION_PROPOSAL.md` (PR #32, approved, **not built**), `docs/CASE_FORMAT.md`, `docs/MASTER_PLAN.md`, `docs/ART_BIBLE.md`, `docs/SOUND_NOTES.md`, and the code under `engine/`, `ai/`, `components/`, `lib/`, `app/`, `scripts/`, `cases/`, `tests/` |
| **Direction** | WHODUNIT?! is a real public game. Favour robustness and polish over demo shortcuts. Case two ships only on George's signal. |
| **Spoilers** | This plan names Tallyho *mechanics* (a staged watch, a recording, a ship that changes its list) because the work depends on them. It does not name the culprits; it says "doer" and "stager". The full solution stays in `docs/cases/TALLYHO_DESIGN.md`. |

**Evidence base.** Every claim below cites a file and function I read on `origin/main` (`09e4962`). Two numbers I measured with throw-away scripts (not committed): token size and prompt size (F5, F14). Where something is a recommendation or an unmeasured estimate, it says so.

---

## 0. Summary for George (read this first)

**What case two needs from the engine.** Five things the engine cannot express today: a second culprit in grading, multi-step progression (gates, leads, accuse gate, key testimony), a way to police "the clock lies" without the model stating a staged time as fact, a ship-list proof panel, and a 6-suspect UI. On top of that, three **robustness problems that would hurt case two specifically**: (1) the signed state token can overflow its own 60,000-character cap with 6 suspects in a worst case, and the game silently resets; (2) the in-world wording is hard-wired to "an English country house in the 1920s"; (3) any folder with a `case.json` is instantly public, so there is no safe way to land a case before it is ready.

**Key decisions (recommended; each is reversible until its PR merges)**

| # | Decision | Why |
|---|---|---|
| D1 | **Progression is a hard prerequisite and ships first, on Blackwood**, exactly as approved in PR #32. | It is not on `main` (`rg "requires\|accuseGate\|keyTestimony\|accompliceId\|leadStates" engine ai app components lib` returns nothing). Tallyho cannot be built without it. |
| D2 | **Two-culprit grading is strict, via one optional field**: `solution.accompliceId` and `Accusation.accompliceId`. Absent means "no one helped". A win needs doer **and** stager correct. | Smallest change; every existing case is unchanged (G1 in the design). |
| D3 | **The "Did anyone help?" picker is always shown and has no preselected answer.** "No one helped" is an explicit button. | Hides whether a case has an accomplice, and a pre-selected default would be a silent way to lose a one-shot accusation (#22). |
| D4 | **Data first, code only when data cannot express it.** Optional fields (accomplice, progression, setting, confrontation limits, art/audio mapping) need no declaration. Code lives in **feature modules** that a case opts into with `"features": [...]` in `case.json`. Two modules for case two: `time-misdirection`, `ship-list`. | A future case is storytelling, art, animation and sound, not engineering (section 4). |
| D5 | **A case is published only if `validate:case --strict` passes**, including a solvability simulation and a scripted smoke playthrough. New `case.json` field `status: "draft" \| "published"` (default `published`) keeps a draft off the public site. | Fail loudly before players see it; land the case safely on preview first. |
| D6 | **State token goes to `v2`** (dual-read first, then dual-write), with a per-case size budget that trims instead of resetting. | 6 suspects break the v1 cap in the worst case. |
| D7 | **Confrontation limits become per-case data** (defaults stay 6 per pair / 12 total, so Blackwood is unchanged). Tallyho proposal: 4 per pair, 16 total. | Cost is bounded by the *total*, not by the 15 pairs; the pair count is a UX problem, not a cost problem. |

**Rough size.** About 60 to 85 engineering commits across 10 phases (section 9), then Tallyho content, art, animation and sound on top. The engineering is front-loaded: after phases 1 to 8 a new case should need no engineering.

**Open questions that block or shape the build** (full list in section 10): Q1 strict vs lenient roles; Q2 explicit vs preselected "no one"; Q3 whether confrontation exchanges count towards the talk gate (they do today, which shortens the fastest path); Q4 confrontation caps and the model-call budget; Q5 how players reach case two (no case chooser exists); Q6 Tallyho's era and voice; Q7 go-ahead to change live Blackwood (fastest win 4 to 11 actions).

---

## 1. What `main` does today (grounded)

### 1.1 Facts that drive the plan

| # | Fact (file / function) | Consequence for case two |
|---|---|---|
| F1 | No progression code exists. `engine/types.ts` has no `requires`, `lockedLine`, `leads`; `LocationSchema` has only `id/name/description/searchFlavor/background`. `components/game/Game.tsx` shows ACCUSE when `evidence.length > 0` (`{...(evidence.length > 0 ? { onAccuse: ... } : {})}`). `engine/investigation.ts` `searchLocation` returns **every** clue at the location at once. | Progression (PR #32) is phase 3, before anything Tallyho-specific. |
| F2 | Grading: `engine/accusation.ts` `gradeAccusation`: `won = murdererCorrect && weaponCorrect && motiveCorrect && hasKeyEvidence` (any one cited key clue). `AccusationSchema` (`engine/types.ts`) has one `murdererId` and `keyEvidenceIds` 1 to 5. `CaseSolutionSchema` (`engine/solution.ts`) has one `murdererId`. | Two culprits, `minKeyEvidence`, key testimony all need schema and grading changes. |
| F3 | Loss endings: `engine/ending-payload.ts` `lossBeats` uses `endings.wrong[accusedId]` unless the accused **is** `solution.murdererId`, and drops lines whose speaker is the real murderer. `buildEnding`'s default confession is spoken by `solution.murdererId`. | With two culprits both rules must cover both ids, or a loss ending leaks who is guilty (#22). |
| F4 | Validator: `engine/case-validation.ts` `checkCaseReferences`: the 15-minute opportunity rule (`wasPresent`, `OPPORTUNITY_WINDOW_MINUTES`) applies to `murdererId` only; "every innocent needs a secret" is `ch.id !== s.murdererId`; `endings.wrong` must cover every suspect. `checkCaseWarnings` runs a reachability fixpoint **for secrets and lies only**; "findable" means `locationId` or `initiallyAvailable`. `scripts/validate-case.ts` prints missing art as a warning ("the screen falls back"). | The validator needs a second culprit, progression reachability, asset existence as an *error* for published cases, features, a leak scan and a simulation. |
| F5 | Token: `engine/state-token.ts`: `TOKEN_VERSION = "v1"`; `verifiedPayload` rejects any other version; `TokenPayloadSchema` is `z.strictObject`; `STATE_LIMITS.tokenChars = 60_000`; a token over the cap is `malformed`, so `restoreSession` **resets the game**. **Measured** (throw-away script: Blackwood with synthetic full state): 4 suspects, typical (8 memory entries of 160 chars, 4 statements) = 17.5K chars, about 4.4K per suspect, so about 26K at 6; worst case (12 memory entries and 8 statements at 400 chars, 6 claims at 160) = 53.8K at 4, about 13.5K per suspect, so **about 81K at 6, above the 60K cap**. Real replies are usually shorter than 400 chars, so the worst case is synthetic, but a determined player can approach it and the failure is a silent reset. | Token v2 plus a per-case budget (phase 2). |
| F6 | Confrontation: `engine/constants.ts` `MAX_CONFRONTATION_TURNS = 6` (per pair), `MAX_CONFRONTATION_TOTAL = 12` (whole game). `ai/confront-handler.ts` makes **two sequential model calls** per exchange; `ai/grok.ts` `GROK_TIMEOUT_MS = 12_000` with one retry; `app/api/confront/route.ts` `maxDuration = 60`. The constants are baked into schemas: `ConfrontationStateSchema.turnsUsed`, `GameStateSchema.pairTurns`, `TokenPayloadSchema.pairTurns` (all `.max(MAX_CONFRONTATION_TURNS)`). The token allows `confrontedPairs` up to 20 (15 pairs fit). | 6 suspects give 15 pairs, but total cost is already capped at 12 exchanges = 24 model calls. Per-case limits need the schema ceilings loosened. |
| F7 | `engine/interrogation.ts` `commitTurn` bumps `characters[id].interrogationCount` for **every** committed turn, including both sides of a confrontation exchange (`ai/confront-handler.ts` runs `performTurn` for A and B). A reveal is committed only if a *validated model reply performed it* (`revealed = plan.revealSecretId !== null && out.performed`); on a fallback it stays pending and is offered again next turn. At most one reveal per exchange (`planTurn`). | (a) The "6 suspects x 4 exchanges" gate can be partly met through confrontations (Q3). (b) A required secret can be delayed indefinitely if the model keeps failing the canon check for that scene (R6). |
| F8 | In-world wording is hard-coded: `ai/prompts/interrogation.ts` `ERA_RULE` ("an English country house in the 1920s") and `Others in the house:`; `engine/session.ts` `CASE_CLOSED_LINE` / `CASE_CLOSED_SEARCH_LINE` ("constable", "house"); `engine/accuse-handler.ts` `ACCUSE_LINES`; `engine/investigate-handler.ts`; `ai/confront-handler.ts` `CONFRONT_LINES`; `engine/hints.ts` `NO_HINT_LINE`; `components/ending/EndScreen.tsx`; `components/evidence/Notebook.tsx` ("Investigate the house!"). | A yacht needs a `setting` block (phase 1). |
| F9 | Other Blackwood leaks in shared code: `lib/case-art.ts` `ART_DEFAULTS.blackwood`; `lib/cases.ts` `DEFAULT_CASE_ID`; `components/effects/audio-scenes.ts` `bedForScreen` and `components/effects/audio.ts` `BedName = "rain_loop" \| "bed_manor" \| "bed_library"`; `components/stage/layout.ts` `REFERENCE = "reginald"`. `tests/engine/case-agnostic.test.ts` scans **only** `engine/` and `ai/`, so these slip through. | Move to data; widen the scan (phase 1). |
| F10 | Publishing: `engine/case-registry.ts` `listPublicCaseIds` lists every folder under `cases/` whose name matches `PUBLIC_CASE_ID_RE` and that contains `case.json`; `app/sitemap.ts` and `app/case/[caseId]/page.tsx` (`generateStaticParams`) use it. There is no draft state and **no case chooser UI** (`components/game/TitleScreen.tsx` has none; `/` is `DEFAULT_CASE_ID`). | Landing `cases/tallyho/` publishes it. Add `status` (D5). Q5 asks how players find case two. |
| F11 | `Evidence.image` is `IdSchema` ("asset key") in `engine/types.ts`, but `components/evidence/Notebook.tsx` renders `<img src={e.image}>` directly. No shipped or fixture case sets `image` (0 hits), so this path has never run. | Tallyho wants 10 clue illustrations, including a diagram. Fix the type to `AssetPathSchema` first (phase 1). |
| F12 | `engine/public-view.ts` `getPublicCaseView` spreads each location (`locations: c.locations.map((l) => ({ ...l }))`). Adding `requires` to `Location` would leak the gate to the client. | Introduce `PublicLocation` (PR #32 section 5.2 already says so). |
| F13 | Layout: `components/characters/SuspectSelect.tsx` grid is `grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-4` (6 suspects = 4 + 2 orphans on desktop; one column of tall `h-40` cards on a phone). `components/accuse/AccuseScreen.tsx` "Who did it?" grid is `grid-cols-2 sm:grid-cols-4`. `components/stage/layout.ts` places one actor or a pair only. `components/ending/sequence.ts` `castAt` shows at most two actors (fine for two culprits). | 6-suspect UI work (phase 7). |
| F14 | Prompt size is roughly constant per call: **measured** at Blackwood's initial state, system prompts are 9.3K to 12.5K chars (about 2.3K to 3.1K tokens) for 26 to 39 known facts per character (151 timeline entries total). `buildCharacterContext` (implemented in `engine/context-builder.ts`, re-exported by `ai/context-builder.ts`) adds only `{ id, name, role, aliases }` per other suspect. | More suspects barely change per-call prompt size; cost scales with the number of *calls*, which the caps bound. |
| F15 | `next.config.ts` `outputFileTracingIncludes` ships `./cases/**/*.json` only. | New per-case data must be `.json` under `cases/<id>/` or it is missing on Vercel. Feature config therefore lives in `case.json`. |
| F16 | Client resume: `lib/game-session.ts` (`SESSION_VERSION = 1`, sessionStorage) restores `stateToken` and UI state. Progress (locks, leads) is derived from the token server-side and is returned only on action responses. | A resumed game has no `progress` until the next action: add a tiny `POST /api/progress` (phase 3). |

### 1.2 What already helps (do not rebuild)

- Progression inputs already exist in the token: `discoveredEvidenceIds`, `searchedLocationIds`, `revealedSecretIds`, `characters[id].interrogationCount`. Progression needs **no new token state** (PR #32 section 1).
- The knowledge firewall (`engine/knowledge-gate.ts` `hiddenUntil`, explicit mode), testimony (`engine/testimony.ts`), reveal rules (`engine/secrets.ts` `shouldRevealSecret`), the time-provenance canon check (`ai/canon-check.ts` `canonTimes` / `checkTimes`) and the confrontation engine (`engine/confrontation.ts` `openConfrontation` / `spendExchange` / `testimonyToThrow`) are case-agnostic and already handle arbitrary pairs.
- `tests/helpers/leak-scan.ts` (`forbiddenPromptStrings`, `SOLUTION_KEYS`) is the right base for a spoiler check; it only needs promoting out of `tests/` so `validate:case` can run it (phase 8).
- `tests/fixtures/cases/harbor-light`, `fixture-manor` and `tests/e2e/second-case.test.ts` already prove the engine runs a second case end to end. We add a third fixture for two culprits plus progression.

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

**Data.** `solution.json` gains `accompliceId?: Id`, the progression fields from PR #32 (`minKeyEvidence?`, `keyTestimonyIds?`, `minKeyTestimony?`), and `keyTestimonyGroups?: Id[][]` (design G5: cite at least one id from each group, so two doer-side testimonies cannot stand in for one witness of each half). Optional `accompliceAct?: { locationId, time }` (design G3) lets the validator run the opportunity rule for the stager's act.

**Accusation.** `AccusationSchema` (`engine/types.ts`) gains `accompliceId?: Id` and `keyTestimonyIds?: Id[]` (max 3). Absent `accompliceId` means "I say no one helped".

**Grading** (`engine/accusation.ts` `gradeAccusation`):

```ts
const accompliceCorrect = (accusation.accompliceId ?? null) === (solution.accompliceId ?? null);
won = murdererCorrect && accompliceCorrect && weaponCorrect && motiveCorrect
      && keyEvidenceCited.length >= (solution.minKeyEvidence ?? 1)
      && keyTestimonyCited.length >= (solution.minKeyTestimony ?? 0)
      && groupsSatisfied(solution.keyTestimonyGroups, keyTestimonyCited);
```

**Strict** means the doer must be named as murderer and the stager as accomplice; swapping them loses. A lenient mode (`culpritGrading: "either-order"`) is Q1; I recommend strict because the roles are provable from different clues.

**Server checks** (`engine/accuse-handler.ts` `handleAccuse`), same shape as the existing rejections: unknown `accompliceId` (`unknown_suspect`), `accompliceId === murdererId` (new `accomplice_is_murderer`), every cited testimony id revealed in the token (`testimony_not_revealed`). `state-token.ts` `decodeStateToken` already validates a stored accusation against the case; extend it for the new ids.

**Verdict and reveal** (win only, per #22): `AccuseVerdict` gains `accompliceCorrect`; `SolutionReveal` gains `accomplice?`; `components/ending/summary.ts` `summaryRows` gains an "Accomplice" row (the `SummaryRow.field` union grows).

**Endings must not leak the second culprit** (F3):
- `lossBeats`: use the authored `wrong[accusedId]` only if the accused is **neither** culprit; drop lines spoken by **either** culprit from every loss ending.
- A named-but-innocent accomplice adds at most one generic engine line, never an authored line for a culprit.
- Win: `correct.confession` already allows any speakers; `components/ending/sequence.ts` `castAt` already shows two actors. The `escaped` beat shows the doer alone (acceptable; revisit if art wants both).
- `case-validation.ts`: "missing wrong ending" applies to the accomplice too; the "innocent needs a secret" rule excludes both culprits.

### 3.2 The always-visible "Did anyone help?" picker

`components/accuse/AccuseScreen.tsx` gets a new section between "Who did it?" and "With what?":

- Title **"Did anyone help?"**, hint "Name one helper, or tell us no one did."
- A button row: **No one helped** (explicit), then every suspect except the one chosen as murderer (that chip is disabled and labelled, not hidden, so the layout does not jump).
- **No preselected answer** (D3, Q2). `validateAccusationDraft` (`engine/accuse-schema.ts`) fails with "Say whether anyone helped." until one is chosen.
- Shown for **every** case, including single-culprit ones, so its presence reveals nothing. Blackwood players get one extra tap; the API treats a missing `accompliceId` as "no one", so old clients and old tests keep working.
- `ConfirmDialog` repeats the full accusation (murderer, helper, weapon, motive) before "This ends the case."
- On phones the helper picker uses name-only chips (no portraits) to save height; the sticky submit bar is unchanged.

### 3.3 Time-misdirection (a watch and a recording)

**What is data-only today.** The staged watch and the recorded cheer are ordinary timeline entries, clues and secrets (`TALLYHO_DESIGN.md` Appendix A). The knowledge firewall already hides who staged what (`hiddenUntil`), and `ai/canon-check.ts` already forces every spoken clock time to come from the speaker's own knowledge.

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
| `SuspectSelect` | `lg:grid-cols-4`; 6 cards = 4+2 orphan; one tall card per row on phones | A pure helper `suspectLayout(n)` returns the column classes. **n = 6: 3 columns at `lg`, 2 at `min-[560px]`.** **Phones under 560px, n >= 5: a 2-column compact card** (head-and-shoulders crop about 112px high, name, role, emotion badge, stress pip), so six cards take about three rows instead of six. n <= 4 keeps today's layout (Blackwood unchanged). |
| `AccuseScreen` | `grid-cols-2 sm:grid-cols-4` | `sm:grid-cols-3` when n = 6; new "Did anyone help?" chip row; sticky submit bar unchanged; confirm dialog stays scrollable. |
| `InterrogationScreen` "Ask about" and "Confront" menus | `otherSuspects` buttons, flex-wrap | Works for 5 others. Add per-pair status chips and the game-wide counter (3.6). |
| `Notebook` | Evidence + testimony list | Tallyho has 10 clues, up to about 13 testimony cards, plus leads. Add a segmented control **Clues / Testimony / Leads**, group clues by location, a key/new badge. Targets at least 44px. |
| `InvestigateScreen` | 3-column grid (6 rooms = 3x2 already) | Padlocked cards with `lockedLine` (progression); tilt via `locationTilt`. |
| Stage and endings | 1 or 2 actors | No change; `components/stage/layout.ts` `REFERENCE` is replaced by a data-derived reference. |
| Landscape phone (740x360, 844x390) | `short:` variants | Verify compact cards and picker rows scroll without horizontal overflow; the `screen-scroll` pattern already allows vertical scroll. |

**Accessibility:** radio-group semantics for pickers (already used), 44px targets, no information by colour alone (the disabled-murderer chip carries text), reduced motion for the tilt toggle.

### 3.6 Confrontations among 15 pairs (cap, cost, UX)

**Cost model (from code).** One exchange = 2 sequential model calls. Total exchanges are capped by `MAX_CONFRONTATION_TOTAL` regardless of pair count, so 15 pairs do not change the maximum cost: Blackwood (6 pairs) and Tallyho (15 pairs) both stop at the total cap (12 exchanges = 24 calls today, 16 = 32 calls at the Tallyho proposal). Worst-case wall time per exchange is `2 calls x (1 try + 1 retry) x 12 s = 48 s`, under `maxDuration = 60` with thin margin; typical latency is **not measured** (R2).

**Cap proposal.** Per-case, optional, defaulting to today's constants:

```jsonc
"confrontation": { "maxPerPair": 4, "maxTotal": 16, "requires": { "interrogated": [ ... ] } }
```

- Code: `openConfrontation` / `spendExchange` read the case values. `ConfrontationStateSchema`, `GameStateSchema.pairTurns` and `TokenPayloadSchema.pairTurns` keep a hard ceiling (for example 10) as a schema bound while the case value is the rule. `Game.tsx` stops importing `MAX_CONFRONTATION_TURNS` and uses the `max` already returned in `ConfrontResponseBody.confrontation`.
- Blackwood stays at 6 / 12. Tallyho proposal 4 / 16: with 15 pairs and about 4 productive ones, 16 lets a thorough player try each productive pair at its cap and probe a few others. **Needs George's cost approval (Q4).**
- Optional `confrontation.requires` (a `Condition`, the same type as progression) opens a pair only after both suspects have been questioned at least twice, so the limited budget is not wasted on strangers.

**UX.**
- The pair picker is already the "Confront..." menu on a suspect's screen (5 choices, not 15). Add **per-pair chips** ("2/4 used", "finished", disabled) from `confrontStatus` in `Game.tsx`, and a **game-wide counter** ("Face-offs left: 9 of 16") in the menu and on `ConfrontScreen` (today it shows only the pair's count).
- **No "productive pair" hints** in the UI (a spoiler). The existing contradiction hint (`engine/hints.ts` `takeHint`) stays the only nudge.
- Phones: menu chips wrap; targets at least 44px (`ConfrontScreen` already uses `min-h-12`).

### 3.7 Multi-step progression: requires, leads, accuseGate, keyTestimony

**Build exactly what PR #32 specifies**: `Condition`; `engine/progress.ts` with `evaluateCondition` / `leadStates` / `accuseProgress`; `requires` + `lockedLine` on `Location` and `Evidence`; `leads`; `accuseGate`; `minKeyEvidence`, `keyTestimonyIds`, `minKeyTestimony`; the `progress` object on every token-returning route; the 403 `accuse_locked`; the Leads tab, padlocks and "CASE NOT READY". I checked every Tallyho gate in `TALLYHO_DESIGN.md` sections 8.1 to 8.4 against the proposal's `Condition` shape: **every Tallyho condition is single-mode** (all-of or any-of, never nested), so no new condition atoms are required.

**How Tallyho extends it** (additions to the approved proposal):

| Extension | Detail |
|---|---|
| Scale | 12 leads, 3 of them gate leads; `accuseGate` = 8 clues, 6 suspects x 4 exchanges, 10 secrets, 3 closed leads (design 8.3). `lockedLines` are authored data. |
| `keyTestimonyGroups` | See 3.1. Small (S) and recommended (Q9). |
| Mixed-atom `requires` | One `mode: "all"` mixes `interrogated`, `evidenceIds`, `secretIds`, `searchedLocationIds`, `leadIds`. Already covered. |
| `lieBrokenIds` atom (design G8) | Not needed; Tallyho closes `lead-stager` on a revealed testimony. Left out. |
| Testimony-triggered reveal (design G4) | `RevealConditionsSchema.testimonyIds?` plus `testimonyShownIds` in `RevealState` (`engine/secrets.ts` `shouldRevealSecret`). Not needed for Tallyho; **optional (M)**, lets a good detective crack a culprit with another's testimony (Q10). |
| Confrontation vs the talk gate | `interrogationCount` rises on both sides of a confrontation (F7). With 16 total exchanges a player could meet most of "6 x 4" through confrontations (about 12 actions instead of 24). **Not a fairness bug** (real engagement, real stress and reveals) but it makes the design's "fastest legal path = 32" wrong. Options: (a) accept, and have the simulator model it so `validate:case` reports the true floor; (b) add an optional per-character `soloExchanges` counter (token field, default 0) and gate on that. Recommend (a) now (Q3). |
| Search semantics | `searchLocation` returns every *eligible* clue and appends `lockedLine`s for ineligible ones (design G10); the "Search again" button already exists. Conditions use the pre-action state, so one search never chains two unlocks. |
| Resume | `POST /api/progress` (token in, `progress` out) so a reloaded game (F16) shows locks and leads before its first action. |

---

## 4. The case-agnostic architecture

### 4.1 Rule: data first, modules second, the engine never names a case

| Layer | Lives in | Declared how | Examples |
|---|---|---|---|
| **Core data** (optional fields, defaults = today) | `cases/<id>/*.json` | not declared; presence is the signal | `solution.accompliceId`, `requires`, `leads`, `accuseGate`, `keyTestimonyGroups`, `confrontation`, `setting`, `art`, `audio`, `endings` |
| **Feature module** (code for a *mechanic*) | `engine/features/<name>/` (server) and `components/features/<name>/` (client) | `case.json` `"features": ["time-misdirection", ...]` plus `"featureConfig"` | `time-misdirection`, `ship-list` |
| **Never allowed** | | | a case name, character id, clue id or location id in `engine/`, `ai/`, `components/`, `lib/`, `app/` |

**Loader contract** (`engine/case-loader.ts`, `engine/features/registry.ts`):
1. Every name in `features` must be a registered module, and every registered module a case uses must be declared. Unknown or undeclared means **load error**, never silently ignored.
2. `featureConfig[name]` must parse against the module's own Zod `configSchema`. A feature with no config, or config with no declaration, is an error.
3. `featureConfig` is **never sent to the client** wholesale. Only `module.publicConfig(config, state)` is returned in the public view, and the validator checks it holds no solution ids (section 6, V19). The ship-list diagram frames are public art by design; the staged-claim table is server-only.
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
| **E1** | **Grading rules** | `gradeAccusation` | `engine/accusation.ts`; module `grade()` returns extra terms ANDed into `won` | optional core fields (`accompliceId`, `minKeyEvidence`, ...) or a module |
| **E2** | **Progression** | not built | `engine/progress.ts` `evaluateCondition` / `leadStates` / `accuseProgress` | `requires`, `leads`, `accuseGate` data |
| **E3** | **Context-builder sections** | `engine/context-builder.ts` `buildCharacterContext` (re-exported by `ai/context-builder.ts`), `ai/prompts/interrogation.ts` | module `contextSections()` appended after the standard sections; each section passes the leak scan | module |
| **E4** | **Canon checks** | `ai/canon-check.ts` (`checkTimes`, `MODERN_WORDS`, ...), run via `ai/perform-turn.ts` | module `canonChecks()` joins the validator list; same retry-then-fallback behaviour | module; era words from `setting` |
| **E5** | **Validator rules** | `engine/case-validation.ts` (`checkCaseReferences`, `checkCaseWarnings`) | module `validate()` / `warn()` / `simulate()` | module |
| **E6** | **UI panels** | fixed screens | the five client slots in 4.2 | module |
| **E7** | **Setting and voice** | hard-coded (F8) | new `setting` block read by prompts, handlers and screens (4.4) | data |
| **E8** | **Art mapping** | `lib/case-art.ts` (`resolveCaseArt`, `resolveStageArt`, `ART_DEFAULTS`); sprites `assets/characters/<id>/<pose>.webp` with anchors in the single shared `assets/characters/anchors.json` (statically imported by `components/characters/sprite-meta.ts`); backgrounds by convention `assets/backgrounds/<locationId>.webp` (+ `_lightning`, `_window_mask`) | `case.json` `backdrops` / `location.background` already win; the Blackwood default moves into `case.json`; the validator checks collisions in the **flat, shared** asset namespace (R10) | data |
| **E9** | **Sound mapping** | `components/effects/audio-scenes.ts` `bedForScreen`, `audio.ts` `BedName` | `case.json` `audio: { beds: { title, investigate, interrogate, accuse, ending }, stings }` with names validated against a list generated by `scripts/audio/` | data (+ new audio files) |
| **E10** | **Endings** | `engine/ending-payload.ts` `buildEnding`, `lossBeats` | data (`endings.correct`, `endings.wrong[id]`, optional `endings.accompliceWrong`), engine rules for leak safety; module `ending.recap` for a bespoke recap | data / module |
| **E11** | **Confrontation rules** | `engine/constants.ts` | `case.json` `confrontation` (caps, `requires`) | data |
| **E12** | **Publish gate** | `listPublicCaseIds` | `case.json` `status`, `npm run validate:case -- --strict` in CI | data |

### 4.4 `setting` block (replaces hard-coded wording)

```jsonc
"setting": {
  "era": "a luxury sea voyage between the wars",        // replaces ERA_RULE's "English country house in the 1920s"
  "place": "the ship",                                   // "the house" in Blackwood-style strings
  "venue": "the Tallyho",
  "authority": "the Captain",                            // replaces "the constable"
  "roster": "Others aboard:",                            // replaces "Others in the house:"
  "modernWords": []                                      // extra words banned by canon-check (era-specific)
}
```

Defaults equal today's strings, so Blackwood needs no edit. `ERA_RULE`, `CASE_CLOSED_LINE`, `CASE_CLOSED_SEARCH_LINE`, `ACCUSE_LINES`, `CONFRONT_LINES`, `NO_HINT_LINE`, the roster line and the Notebook empty state read these. **Tallyho's era is Q6.** The design never states one (no year in the document), so I use no year here.

### 4.5 What a future case then needs

| Need | Who | Engineering? |
|---|---|---|
| `case.json`, `solution.json`, `timeline.json`, `characters.json` (+ `leads`, `accuseGate`, `setting`, `audio`, `confrontation`) | Story | **No** (validated by `validate:case`) |
| Backgrounds (with variants), clue art, 7 poses per suspect + `anchors.json`, victim portrait, title and ending art | Art | **No** (asset-existence check) |
| Ambient beds, stings, music | Sound | **No** (add file; register name in the generated list) |
| Animation timings per suspect | Art | **No** if the existing pose set and `docs/toonMotion.ts` keys suffice |
| A *new mechanic* (a new kind of proof, grading term or panel) | Engineering | **Yes**, as one feature module (typically S to M) |

**Success test for D4:** after phases 1 to 8, building a third case must not touch `engine/`, `ai/`, `components/` or `lib/` unless the case declares a *new* module. `tests/engine/case-agnostic.test.ts` (widened) and a CI check ("a PR that only adds `cases/<id>/` and new files under `assets/` (and `assets/characters/anchors.json` entries) changes no source file") defend this.

---

## 5. Files that change

Sizes: S = under an hour of focused work, M = a few hours, L = a day or more. "(new)" = new file.

### 5.1 Engine (`engine/`, `app/api/`, `lib/`)

| File | Change | Size |
|---|---|---|
| `engine/types.ts` | `Condition`, `requires`, `lockedLine` on `Location` and `Evidence`; `Lead`; `accuseGate`; `PublicLocation`; `Accusation.accompliceId` / `keyTestimonyIds`; `setting`, `confrontation`, `features`, `featureConfig`, `status`, `audio` on the case; `Evidence.image` becomes `AssetPathSchema` (F11) | M |
| `engine/solution.ts` | `accompliceId?`, `accompliceAct?`, `minKeyEvidence?`, `keyTestimonyIds?`, `minKeyTestimony?`, `keyTestimonyGroups?` | S |
| `engine/progress.ts` (new) | `evaluateCondition`, `leadStates`, `accuseProgress` (PR #32) | M |
| `engine/investigation.ts` | `searchLocation` honours `requires`; returns `lockedLine`s | M |
| `engine/investigate-handler.ts` | locked location returns its line; `progress` in response | S |
| `engine/accusation.ts` | `gradeAccusation` per 3.1; `AccuseVerdict.accompliceCorrect` | M |
| `engine/accuse-handler.ts` | `accuse_locked` 403; accomplice and testimony validation; reads `setting` | M |
| `engine/accuse-schema.ts` | `validateAccusationDraft` requires the helper answer | S |
| `engine/ending-payload.ts` | `lossBeats` and `buildEnding` cover both culprits; `SolutionReveal.accomplice` | M |
| `engine/public-view.ts` | `PublicLocation` (no `requires`); `leads` titles and hints only; `publicConfig` of modules | M |
| `engine/confrontation.ts`, `engine/constants.ts` | per-case limits, schema ceiling; defaults 6/12 | S |
| `engine/state-token.ts` | `TOKEN_VERSION` v2 (dual-read, then dual-write), deflate compression (Q8), size budget and trimming, `TokenPayloadSchema` extension for any new fields | L |
| `engine/state.ts` / `engine/session.ts` | `restoreSession` keeps trimmed state instead of resetting on size; closed-case lines from `setting` | M |
| `engine/interrogation.ts` | optional `pendingRevealFailures` counter and the pending-reveal fallback that speaks `testimonySummary` after N consecutive failures (R6, Q9) | M |
| `engine/hints.ts` | `NO_HINT_LINE` from `setting` | S |
| `engine/case-loader.ts`, `engine/case-registry.ts` | validate `features` / `featureConfig` / `status`; `listPublicCaseIds` skips drafts (D5) | M |
| `engine/features/types.ts`, `registry.ts` (new) | the module interface and registry (4.2) | M |
| `engine/features/time-misdirection/*` (new) | config schema, validator, canon checks (3.3) | M |
| `engine/features/ship-list/*` (new) | config schema, validator (3.4) | S |
| `engine/simulate.ts` (new) | solvability simulation (6.3) | L |
| `engine/leak-scan.ts` (new, from `tests/helpers/leak-scan.ts`) | spoiler scan reusable by `validate:case` | M |
| `app/api/progress/route.ts` (new) | token in, `progress` out (F16) | S |
| `app/api/{investigate,interrogate,confront,accuse,hint}/route.ts` | return `progress`; map new error codes | S each |
| `lib/cases.ts`, `lib/case-art.ts` | drop `ART_DEFAULTS.blackwood` hard-coding into data; asset-path checks reuse | S |
| `next.config.ts` | none expected (F15); verify | S |

### 5.2 AI and prompts (`ai/`)

| File | Change | Size |
|---|---|---|
| `ai/prompts/interrogation.ts` | `ERA_RULE` and the roster line from `setting`; module `contextSections` appended | S |
| `engine/context-builder.ts` (the implementation; `ai/context-builder.ts` only re-exports it) | call `contextSections`; pass `setting`; keep the leak scan green with 6 suspects | M |
| `ai/canon-check.ts` | `MODERN_WORDS` + `setting.modernWords`; run module `canonChecks` | S |
| `ai/perform-turn.ts` | pass module checks into `validate`; count consecutive canon failures for R6 | M |
| `ai/confront-handler.ts` | `CONFRONT_LINES` from `setting`; per-case caps | S |
| `ai/grok.ts` | none (a timeout/budget review is part of Q4) | |
| `engine/knowledge-gate.ts` | none; covered by new tests with 6 suspects | |

### 5.3 Schema and validator

| File | Change | Size |
|---|---|---|
| `engine/case-validation.ts` | split into `checkStructure`, `checkSolution`, `checkProgression`, `checkFeatures`, `checkAssets`, `checkLeaks`; accomplice rules; unreachable clues/locations/secrets as **errors** for published cases | L |
| `scripts/validate-case.ts` | `--strict`, `--sim`, `--json`, `--smoke`; asset check as an error when `status: published`; machine-readable output for CI | M |
| `scripts/smoke-playthrough.ts` (new) | scripted solve using the real handlers and the Grok mock (6.4) | L |
| `docs/CASE_FORMAT.md` | every new field, the `features` contract, the authoring checklist | M |
| `engine/schema-export.ts` (new, optional) | emit JSON Schema for editors | S |

### 5.4 UI (`components/`, `app/`)

| File | Change | Size |
|---|---|---|
| `components/accuse/AccuseScreen.tsx` | "Did anyone help?" section, 3-column suspect grid, richer confirm dialog, `accuse_locked` state | M |
| `components/characters/SuspectSelect.tsx` + `suspect-layout.ts` (new) | 6-suspect grid and compact phone cards (3.5) | M |
| `components/dialogue/InterrogationScreen.tsx`, `components/confront/*` | per-pair chips, global counter, per-case max | M |
| `components/game/Game.tsx` | drop the `evidence.length > 0` ACCUSE rule for `progress`; remove the `MAX_CONFRONTATION_TURNS` import; call `/api/progress` on resume | M |
| `components/evidence/Notebook.tsx` | Clues / Testimony / Leads segments; correct `image` use; empty-state from `setting` | M |
| `components/investigate/InvestigateScreen.tsx` | padlocked rooms with `lockedLine` | S |
| `components/ending/summary.ts`, `EndScreen.tsx`, `ending/sequence.ts` | accomplice row; copy from `setting`; two-culprit recap | M |
| `components/effects/audio-scenes.ts`, `audio.ts` | beds from `case.audio`; `BedName` becomes a string validated against a list | M |
| `components/stage/layout.ts` | `REFERENCE` derived from the case's first suspect | S |
| `components/features/registry.ts`, `time-misdirection/`, `ship-list/` (new) | client slots; ship-list panel and tilt | M |
| `lib/game-session.ts` | bump `SESSION_VERSION`; tolerate old shape | S |
| `app/case/[caseId]/page.tsx`, `app/sitemap.ts` | skip drafts via `listPublicCaseIds`; a chooser page is Q5 | S to M |

### 5.5 Tests and docs

See section 8 for tests. Docs: `docs/CASE_FORMAT.md`, a new `docs/CASE_AUTHORING_CHECKLIST.md` (or a section of it), `docs/ARCHITECTURE.md` (feature modules, token v2), `docs/MASTER_PLAN.md` status, this plan, and the Blackwood progression doc marked "built" when phase 4 lands.

### 5.6 Assets and scripts

| Path | Change |
|---|---|
| `assets/characters/<suspectId>/{neutral,talking,angry,nervous,sad,shocked,smug}.webp`, entries in `assets/characters/anchors.json`, `assets/backgrounds/<locationId>.webp` (+ variants), clue art, title art | Tallyho art in the layout that exists today, which is **flat and shared across cases**. Two cases that both use e.g. a `library` location id or a `neutral` pose for the same character id would overwrite each other, and `anchors.json` is one file everyone edits. Plan: the validator fails on any collision with another case's ids (R10); optional later move to `assets/cases/<id>/` paths named explicitly in `case.json` (Q14). |
| `scripts/audio/make_noir.py`, `master_all.py` | new beds (ship hull, engine hum, saloon) and stings; the validator's bed list is generated here |
| `scripts/gen-timeline.ts` (new, optional) | generate the roughly 161 checkpoint timeline rows (R12) from a compact movement grid; reviewed output is checked in as JSON |
| `scripts/check-overflow.ts` | add a 6-suspect case and the new screens to the set it visits |
| `scripts/playtest.ts` (new, manual) | live-model soak (8.5), not run in CI |

---

## 6. Adding a new case: checklist and a validator that fails loudly

### 6.1 Authoring checklist (what a story/art/sound person does)

1. Copy `tests/fixtures/cases/fixture-manor` (the feature-complete fixture) to `cases/<id>/`; set `status: "draft"`.
2. Write `case.json` (meta, `setting`, victim, locations, evidence, facts, motives, weapons, endings, `backdrops`, `audio`), `solution.json`, `timeline.json`, `characters.json`. Follow `docs/CASE_FORMAT.md`.
3. Give every suspect at least one secret (innocent suspects included), a reveal condition that is reachable, and a `testimonySummary` for any secret that should be quotable.
4. Author progression: `requires` / `lockedLine` on locations and clues, `leads`, `accuseGate`, `minKeyEvidence`, `keyTestimonyIds`.
5. Decide whether the case needs a *new mechanic*. If it fits an existing module, add it to `features` and fill `featureConfig`. If not, open an engineering ticket for a new module **before** writing the dependent story beats.
6. Add art: 7 poses per suspect plus anchors, a background per location, clue art for every clue with an `image`, title and ending art as needed.
7. Add sound: choose beds from the registered list or add files plus a list entry.
8. Run `npm run validate:case -- <id> --strict --sim`. Fix every ERROR; read every WARN.
9. Run `npm run validate:case -- <id> --smoke` (scripted playthrough with the model mocked).
10. Run the live soak (8.5) with a real model once, read the transcripts for spoilers and tone.
11. Flip `status` to `"published"`; CI runs the strict validator and refuses to build otherwise.

### 6.2 Checks (severity: **E** = fails the build / refuses to publish, **W** = warns, **I** = info)

| # | Check | Sev | Notes |
|---|---|---|---|
| V1 | `case.json` / `solution.json` / `timeline.json` / `characters.json` parse against the Zod schemas (strict objects) | E | |
| V2 | Ids: unique per namespace, `IdSchema`-valid, the folder name equals `meta.id`; facts and timeline share one namespace (as today); **ids do not collide with another case's asset-backed ids** (locations, characters) | E | extends today's checks; R10 |
| V3 | Every reference resolves (`knownFactIds`, `relatedFactIds`, `involvesCharacterIds`, reveal conditions, lies, endings) | E | exists in `checkCaseReferences` |
| V4 | Murderer, accomplice, weapon, location, motive, key evidence, key testimony all exist; `accompliceId !== murdererId`; the victim is not a suspect | E | |
| V5 | Opportunity rule for the murderer (`wasPresent` within `OPPORTUNITY_WINDOW_MINUTES`) and, if `accompliceAct` is set, for the accomplice | E | extends today's rule |
| V6 | Every non-culprit suspect has a secret; every suspect has an `endings.wrong` entry | E | exists; now excludes both culprits |
| V7 | **Reachability** (exact fixpoint over the full progression graph, see 6.3): every location, clue, secret and lead can be reached; no cycles in `requires`; every `Condition` atom refers to something that exists and can happen | E for clues/locations/leads, W for optional secrets | today only secrets/lies |
| V8 | **Solvability**: from an empty state the accuse gate can open, the solution is fully provable from reachable evidence (the key evidence and key testimony all reachable), and `minKeyEvidence` / `minKeyTestimony` are satisfiable without any single clue that is itself gated behind the accuse gate | E | |
| V9 | **Soft-lock freedom**: for every reachable state there is at least one action that makes progress or the gate is open; required secrets have a fallback path (R6), and the model-outage run (6.3) still reaches the gate | E | |
| V10 | **No lucky guess**: with `accuseGate` closed, no accusation can be submitted; the number of cheapest paths and the lower-bound action count are reported (the design says 32 for Tallyho; the simulator must reproduce the true number, F7) | E / I | |
| V11 | **Leak: public strings.** Titles, hints, `lockedLine`s, discovery lines, location text, motive labels, `endings.wrong` and the intro never contain a culprit's name, the weapon id/name where hidden, the true time, the staged-claim explanation, or `solution.explanation` text | E | uses `engine/leak-scan.ts` |
| V12 | **Leak: gating strings.** A `lockedLine` or lead hint must not name something the player has not yet found (token-level match against undiscovered clue names and secret text) | E | |
| V13 | **Leak: prompt scan.** For each suspect, build `buildCharacterContext` for a set of states (empty, mid-game, all revealed) and scan the system prompt: no solution keys, no other suspects' secrets, no unrevealed reveal-condition text, no `hiddenUntil` fact text | E | reuses `forbiddenPromptStrings` / `SOLUTION_KEYS` |
| V14 | **Leak: API bodies.** Run the public view and every handler response in the smoke run through the same scan; `progress` carries ids and counts, never the solution | E | |
| V15 | **Leak: loss endings.** For every wrong accusation (each single suspect, each pair of roles), the full ending payload contains no line spoken by a culprit and no culprit-only phrasing; the "half right" case (one culprit right, one wrong) gets only the generic loss | E | closes F3 |
| V16 | Knowledge boundaries: every fact a suspect lists in `knownFactIds` is one they could plausibly know (present at the located entry or told), `hiddenUntil` keys exist and are owned by the knower; no character knows a located event they were not at | W (E for located entries) | the design ran these checks by script (section 12); this makes them permanent |
| V17 | `features` declared <=> registered <=> configured; `featureConfig` parses; each module's `validate` / `warn` pass | E | |
| V18 | `time-misdirection`: staged times at least 15 minutes from the true time; proof-of-when; alibi shape | E / W | 3.3 |
| V19 | `publicConfig` of every module holds no solution ids or staged-claim table | E | |
| V20 | `ship-list`: flip lies between the true and staged times; diagram clues gated behind the flip clue; frames exist | E | 3.4 |
| V21 | **Assets exist** (as errors when `status: published`, warnings for drafts): every `location.background`, `backdrops.*`, `evidence.image`, module frame, and for each suspect all 7 poses (`neutral, talking, angry, nervous, sad, shocked, smug`) plus an entry in `assets/characters/anchors.json` with the 7 anchor fields | E / W | `assetExists` in `lib/case-art.ts`; today missing art is only a warning |
| V22 | Audio: every bed/sting name in `case.audio` exists as `.mp3` and `.ogg` in `assets/audio/` | E | |
| V23 | Text limits: `testimonySummary` <= 240, lead titles <= 70 and hints <= 240, discovery lines, `lockedLine` length; no empty strings | E | the same limits the design lint checked |
| V24 | Token budget: simulate a "max chat" state for the case (all suspects, all pairs, caps reached, replies at the schema max) and fail if the encoded token exceeds the budget after trimming (the loss behaviour is trimming, not reset) | E | R1 |
| V25 | Prompt budget: report the longest system prompt in characters/tokens; warn above a threshold (Blackwood is 9.3K to 12.5K chars) | W | F14 |
| V26 | Era/voice: no `modernWords` in authored text; `setting` fields all present when a non-default setting is used | W | |
| V27 | Confrontation: `maxPerPair * (pairs that can open)` vs `maxTotal` is sane; every pair has at least one shared fact or testimony that can be thrown (otherwise the pair is a dead end and is reported) | W / I | 3.6 |
| V28 | Publishing: `status` present; a `published` case has passed V1 to V27 | E | D5 |
| V29 | **Smoke playthrough** (6.4) passes | E | |
| V30 | Docs: `CASE_FORMAT.md` lists every top-level field the schema accepts (a drift test) | W | |

### 6.3 The solvability simulation (`engine/simulate.ts`)

A small deterministic model of the player, **not** a model of the AI. State = the same fields progression already reads from the token: `discoveredEvidenceIds`, `searchedLocationIds`, `revealedSecretIds`, `interrogationCount` per character, `confrontationTotal`.

- **Actions:** `search(locationId)`, `talk(characterId)`, `present(characterId, evidenceId)`, `confront(a, b)`, `accuse(...)`.
- **Transition rules are the real functions:** `evaluateCondition` for gates, `shouldRevealSecret` (`engine/secrets.ts`) for reveals, `searchLocation` for finds, `commitTurn` for counters (so a confrontation increments both sides, F7).
- **Exact fixpoint** (everything obtainable with unlimited actions) gives V7, V8 and unreachable lists.
- **Lower and upper path bounds** by BFS over a coarse state, reported as "fastest legal win = N actions", compared to the design's claim.
- **Model-outage run:** the same search with `out.performed = false` for every reveal, using the pending-reveal fallback rule. If the gate cannot open, V9 fails.
- **Module hooks:** `simulate()` lets a module add or remove edges (rare).
- Cost: the state space is small (about 6 suspects x counters x subsets of 10 clues); a BFS with memoisation is well within a CI step.

### 6.4 The smoke playthrough (`scripts/smoke-playthrough.ts`)

Drives the **real handlers** (`handleInvestigate`, `handleInterrogate`, `handleConfront`, `handleAccuse`) with `tests/helpers/grok-mock.ts` standing in for the model, following the simulator's cheapest winning path. Asserts:

1. each unlock occurs at the step the design says and **not earlier** (a locked door stays locked; a gated clue stays hidden);
2. the winning accusation wins;
3. every single-field mutation of the winning accusation (murderer, accomplice, weapon, motive, each key evidence, each key testimony group, wrong "no one helped") **loses**;
4. every loss body passes the leak scan (V15);
5. the token stays under the cap and round-trips through v1/v2 decode (section 7);
6. replaying the same token after the verdict returns the original verdict (`engine/accuse-handler.ts` already treats a concluded token as final).

---

## 7. Blackwood migration and token versioning

### 7.1 No-breakage rules

1. **Golden snapshots first (phase 0):** commit snapshot tests for Blackwood's current behaviour before touching anything: its public view, a fixed list of search results, the context for every suspect at fixed states, the grading result for a set of accusations, and the ending payload for each of its endings. Phase 1 to 3 PRs must leave these unchanged.
2. **Every new field is optional with a default that reproduces today.** Blackwood's data does not change until the progression content PR.
3. **Phase A (engine) is invisible to Blackwood.** Progression with no `requires`/`leads`/`accuseGate` in the data behaves exactly as today (accuse opens with at least one clue, as in `Game.tsx`). A contract test asserts it.
4. **Phase B (Blackwood data) is a separate content PR** (Agatha, per PR #32 section 8), merged only on George's go-ahead (Q7) because it changes live play: the fastest win goes from 4 to 11 actions.
5. **The "Did anyone help?" picker ships for Blackwood in Phase A5** (it is shown for every case, D3). Blackwood's answer is "No one helped". Old clients that omit `accompliceId` grade as "no one" (3.1), so a stale tab still works.

### 7.2 Token versioning (`engine/state-token.ts`)

Facts: `TOKEN_VERSION = "v1"`; `verifiedPayload` rejects any other version; `TokenPayloadSchema` is strict; a bad token is `malformed` and resets the game (F5). Progression adds **no** token state, so in-flight Blackwood tokens stay valid through phase 3. The two-culprit change touches only the stored `accusation` (new optional `accompliceId`, `keyTestimonyIds`), which is a strict-schema extension and therefore needs the version bump rules below.

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
- `lib/game-session.ts`: a `SESSION_VERSION = 1` blob (sessionStorage) is accepted or cleanly discarded; resume calls `/api/progress`.

---

## 8. Test plan

Existing: Vitest (`npm test`), `tests/engine`, `tests/cases`, `tests/components`, `tests/lib`, `tests/e2e/second-case.test.ts`, `tests/helpers/{fixture,grok-mock,leak-scan}.ts`, fixtures `fixture-manor` and `harbor-light`. New work extends these rather than inventing a second harness.

### 8.1 Unit tests by area

| Area | Tests |
|---|---|
| Grading | Table-driven: win; wrong murderer; wrong or missing accomplice; accomplice named in a one-culprit case; roles swapped; swapped weapon/motive; `minKeyEvidence`; `keyTestimonyGroups`; unrevealed testimony id rejected; `accomplice_is_murderer`. |
| Endings | `lossBeats` for every wrong accusation: no culprit lines; `wrong[accusedId]` never used for a culprit; two-actor win sequence; `summaryRows` accomplice row. |
| Progression (`engine/progress.ts`) | Every `Condition` mode and atom; ordering (pre-action state); closed leads; accuse gate; `accuse_locked` 403; `lockedLine` appended on search; "search again". |
| Token | v1 and v2 decode; compression round trip; tamper; budget trimming; 6-suspect size with the max-chat fixture. |
| Confrontation | Per-case caps; 15 pairs open and close; total cap across pairs; both-sides `interrogationCount` (F7); schema ceiling. |
| Context/prompt | 6-suspect contexts: leak scan clean; roster has 5 others; `setting` strings used; module `contextSections` leak-scanned. |
| Canon | `time-misdirection` accept/reject golden sets; skip for a maintained lie; `setting.modernWords`. |
| Registry | `features` declared <=> registered <=> configured; drafts excluded from `listPublicCaseIds` and the sitemap. |
| Agnosticism | `tests/engine/case-agnostic.test.ts` widened to `engine/`, `ai/`, `components/`, `lib/`, `app/` and to all case ids and character names found under `cases/`. |

### 8.2 Fixtures

Add `tests/fixtures/cases/two-hands` (small, 5 to 6 suspects, a second culprit, progression, both feature modules, a tiny set of 1x1 placeholder assets) so engine tests do not depend on Tallyho's content or art. Tallyho itself gets `tests/cases/tallyho.test.ts` (content assertions like `blackwood-content.test.ts`).

### 8.3 Case tests

`tests/cases/tallyho.test.ts`: loads, validates `--strict`, simulation lower bound equals the documented number, smoke playthrough passes, spoiler scan clean. Blackwood's existing `tests/cases/blackwood*.test.ts` keep passing at every phase; after phase 4 they are updated with the new gates.

### 8.4 UI and layout

- `npm run check:overflow` at all 8 viewports (360x740, 390x844, 430x932, 740x360, 844x390, 768x1024, 1024x768, 1280x800) on: suspect select (6), accuse (picker + 6), notebook (Clues/Testimony/Leads), investigate (padlocks), confront (counter), end screen (two culprits). Save screenshots (`--shots`) in the PR.
- Component tests for `suspectLayout(n)`, `summaryRows`, `notebook-model.ts`, and the audio scene mapping with data beds (`tests/components`).
- Optional (not in the open questions; a tooling call for Dexter): one Playwright smoke test of the happy path on a phone viewport.

### 8.5 Live-model soak (manual, not CI): `scripts/playtest.ts`

Scripted conversations with a real model against Tallyho, logging: canon-check rejection rate per character, fallback rate, any reply that contains a solution string, mean/p95 latency per interrogation and per confrontation exchange, and the staged-time assertion rate (R3). Run before each content freeze and after any prompt change. Output is the evidence for Q4 (latency/cost) and R2/R3.

---

## 9. Build order (numbered, with sizes)

Owners follow the studio roles in `docs/MASTER_PLAN.md`: Dexter (engineering), Agatha (story/data), Toon (art/sound). Sizes: S = about 1 to 3 commits, M = 4 to 8, L = 9+. Commit counts are ballpark.

| # | Phase | Contents | Size | Commits | Depends on |
|---|---|---|---|---|---|
| 0 | **Decisions and golden snapshots** | George answers Q1 to Q7; add Blackwood golden snapshot tests and the max-chat token fixture; add the "no source change for a new case" CI check | S | 2 | |
| 1 | **Case-agnostic hardening** | `setting` block + defaults; move `ART_DEFAULTS.blackwood`, `DEFAULT_CASE_ID`-dependent strings, `REFERENCE`, bed names to data; `Evidence.image` -> `AssetPathSchema`; `PublicLocation`; widen the case-agnostic test; `status` + draft filter | M | 5 to 7 | 0 |
| 2 | **Token v2** | Release A (decode v1+v2, encode v1), Release B (encode v2, compression, budget trimming), tests; plan Release C | M | 4 to 6 | 0 |
| 3 | **Progression engine** (PR #32 build order steps 1 to 7) | `Condition`, `engine/progress.ts`, `requires`/`lockedLine`, `leads`, `accuseGate`, `progress` on routes, `accuse_locked`, Notebook Leads tab, padlocks, `POST /api/progress`, `keyTestimonyGroups`; behaves as today when data has none | L | 10 to 14 | 1 |
| 4 | **Blackwood progression data** (Agatha) | PR #32 section 8 migration; updated Blackwood tests; **only on George's go-ahead (Q7)** | M | 4 to 6 | 3 |
| 5 | **Two-culprit grading and the picker** | `accompliceId` in solution/accusation/token; `gradeAccusation`; ending/leak rules; summary row; picker UI; validator rules; fixture `two-hands` | M | 6 to 8 | 1, 2 |
| 6 | **Feature framework and the two modules** | `engine/features/*` registry and interface; `time-misdirection`; `ship-list`; client slots; module tests | M | 6 to 9 | 5 |
| 7 | **6-suspect UI and confrontation** | `suspectLayout`, compact cards, accuse grid, Notebook segments, per-case confrontation limits, per-pair chips and global counter, `check:overflow` updated | M | 7 to 10 | 3, 5 |
| 8 | **Validator v2, simulator, smoke playthrough** | split `case-validation.ts`; V1 to V30; `engine/simulate.ts`; `engine/leak-scan.ts`; `scripts/smoke-playthrough.ts`; CI wiring; `CASE_FORMAT.md` and the authoring checklist | L | 9 to 13 | 3, 5, 6 |
| 9 | **Tallyho content, art and sound** | JSON (Agatha), art and anchors (Toon), beds and stings (Toon), timeline generator, `status: draft` until phase 10 | L | 12 to 20 (mostly JSON) | 8 for validation; art can start earlier |
| 10 | **Release hardening** | live soak and fixes, `check:overflow` screenshots reviewed, accessibility pass, flip to `published`, chooser/entry point (Q5), analytics decision (Q13) | S to M | 3 to 5 | 9 |

**Totals:** engineering about 60 to 85 commits (phases 0 to 8 and 10). **Critical path:** 1 -> 3 -> 5 -> 6 -> 8 -> 9 -> 10. Phases 2, 4 and 7 run in parallel with it. Art (phase 9) can start as soon as the design is approved, since it depends only on `docs/ART_BIBLE.md` and the asset list in `TALLYHO_DESIGN.md` section 10.

**Ordering rationale:** hardening and progression first because they make Blackwood better and are needed by everything; token v2 before the 6-suspect UI because 6 suspects are what stress it; the validator and simulator before Tallyho content, so content is written against a checker rather than checked afterwards; Tallyho stays `draft` until phase 10 so the repo can merge content continuously without exposing it.

---

## 10. Risks and open questions

### 10.1 Risks

| # | Risk | Likelihood / impact | Mitigation | Evidence |
|---|---|---|---|---|
| R1 | **Token overflow with 6 suspects** silently resets the game | Low-medium / **high** (a lost game) | Token v2 (deflate), budget with trimming, `restoreSession` stops resetting on size, V24 in the validator, platform request-size check | F5: typical about 26K, synthetic worst case about 81K vs the 60K cap |
| R2 | **Prompt cost and latency**: 15 pairs, 2 calls per exchange | Medium / medium | Caps bound the total (4 per pair, 16 total = 32 calls); `maxDuration = 60` margin is thin (worst 48 s); consider one call per exchange or a lower timeout; soak-test p95 | F6, F14; typical latency **not measured** |
| R3 | **LLM drift on time-misdirection**: the model states the staged time as fact | **High** / high (false canon) | `time-misdirection` canon check, authored lies carry the staging, adversarial test set, live soak counting rejection rates | 3.3 |
| R4 | **Mobile UI density** with 6 suspects, a 10-clue notebook, a 6-pair picker | Medium / medium | Compact cards, segmented notebook, 44px targets, `check:overflow --shots` at 8 viewports | 3.5 |
| R5 | **Balance / grind**: 24 forced exchanges, 32-action floor, long total | Medium / medium | The simulator reports the true floor; every locked door carries a nudge; consider reducing the talk gate (Q11); playtest | design 9.5; F7 |
| R6 | **Required-secret soft-lock**: repeated canon failures keep a gate-critical reveal pending | Low / **high** | Pending-reveal fallback after N failures (speaks `testimonySummary`, commits), validator outage run (V9), telemetry counter in the soak | F7 |
| R7 | **Spoiler leaks** via prompts, public strings, API bodies, loss endings, `lockedLine`, `featureConfig` | Medium / **high** | V11 to V15, V19; public types separate from internal; scan in smoke run; `featureConfig` never shipped | F3, F12 |
| R8 | **The new accusation flow** confuses players (a half-right loss) | Medium / medium | Always-visible explicit picker, confirm dialog repeats the choice, generic loss only (Q12) | design 11.3 |
| R9 | **Publishing accident**: dropping `cases/tallyho/` makes it public | Medium / medium | `status: draft` default for new cases, CI strict gate, sitemap skips drafts | F10 |
| R10 | **Asset collisions**: assets are a flat, shared namespace, and `anchors.json` is one shared file | Medium / medium | V2/V21 collision checks; reviewer rule for `anchors.json`; possible namespacing (Q14) | `lib/case-art.ts`, `components/characters/sprite-meta.ts` |
| R11 | **Token rollback** after v2 is live | Low / high | Release A before B; B is not deployed until A has run in production | 7.2 |
| R12 | **Authoring burden**: about 161 checkpoint rows, 12 leads, 15 secrets | High / medium | `scripts/gen-timeline.ts`, validator from day one, fixtures as templates | design 12 |
| R13 | **Era/voice mismatch**: hard-coded "1920s English country house" in prompts and UI | High (if unfixed) / medium | `setting` block (phase 1), Q6 | F8 |
| R14 | **Discoverability**: no case chooser, so nobody finds case two | Certain (if unaddressed) / medium | Q5; chooser or link in the title/ending screen | F10 |
| R15 | **Scope creep**: the framework becomes bigger than the game | Medium / medium | Only two modules built; any third mechanic is a ticket reviewed against "can data do this?" | principle 3 |

### 10.2 Open questions (for George and the PM)

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| Q1 | **Strict or lenient roles** for two culprits (doer must be "murderer", stager "accomplice")? | Strict (design G1b), because each role is provable from different clues | phase 5 |
| Q2 | **Explicit vs preselected "No one helped"** in the picker? | Explicit, no preselection (one-shot accusation, #22) | phase 5 |
| Q3 | **Do confrontation exchanges count towards the talk gate?** Today they do (F7), cutting the fastest path. | Accept for now and have the simulator report the true floor; revisit with playtest data | phase 3 |
| Q4 | **Confrontation caps and a model-call budget**: 4 per pair / 16 total (32 calls) for Tallyho vs 6 / 12 today? Cost per game ceiling? | 4 / 16 pending the soak's latency and cost numbers | phase 7 |
| Q5 | **How do players reach case two?** There is no chooser; `/` is Blackwood. | A simple chooser or an end-of-game link; decide before phase 10 | phase 10 |
| Q6 | **Tallyho's era, voice and authority noun** ("the Captain"?). The design states no year. | Decide; feeds `setting` | phase 1 data |
| Q7 | **Go-ahead to change live Blackwood** (progression data: fastest win 4 -> 11 actions). | Yes, after phase 3 is merged and reviewed | phase 4 |
| Q8 | **Deflate, or trimming only,** for the token? | Both: deflate first, trimming as a safety net | phase 2 |
| Q9 | **`keyTestimonyGroups`** (S) and the pending-reveal fallback after N failures (M)? | Yes to both | phase 3, 5 |
| Q10 | **Testimony-triggered reveals** (design G4)? Not needed for Tallyho. | Defer | |
| Q11 | **Length and balance**: is a 32-action floor (about 45 to 70 typical) right for a public game? | Playtest before deciding; the gate values are data, so tuning is cheap | phase 10 |
| Q12 | **A "half right" loss line** (one culprit correct)? | Keep it off: it leaks (#22). The generic loss only | phase 5 |
| Q13 | **Analytics** (where players stall)? No dependency exists today. | Decide privacy stance; start with the soak script, not client telemetry | phase 10 |
| Q14 | **Namespace assets per case** (`assets/cases/<id>/`) or stay flat with collision checks? | Flat + checks now; namespace if a third case arrives | phase 1 |

---

## Appendix: how this plan was checked

- Fetched `origin/main` (`09e4962`, includes PR #33) and worked in a separate git worktree (`/workspace/whodunit-plan`), so the other engineer's checkout was not touched. No code was changed; this PR adds one doc.
- Read: `docs/cases/TALLYHO_DESIGN.md`, `docs/BLACKWOOD_PROGRESSION_PROPOSAL.md`, `docs/MASTER_PLAN.md`, `docs/CASE_FORMAT.md`, `docs/ART_BIBLE.md`, `docs/ARCHITECTURE.md`, and the engine, AI, component, lib, app, script, case and test code named above.
- Confirmed progression is absent: `rg "requires|accuseGate|keyTestimony|accompliceId|leadStates" engine ai app components lib` returns nothing.
- **Measured** (throw-away scripts using Blackwood and a synthetic full state; not committed): state-token size (typical 17.5K chars for 4 suspects, worst case 53.8K, so about 26K and about 81K projected at 6 against the 60,000 cap) and system-prompt size (9.3K to 12.5K chars, 26 to 39 known facts per character).
- **Not measured:** live model latency, real-transcript compression ratios, how often real replies hit the schema maxima, how often a confrontation call times out. They are listed as risks (R1, R2) and as outputs of the soak script (8.5), not as facts.
- Numbers quoted from the Tallyho design (32-action floor, 161 timeline rows, 12 leads) are the design's own claims; the simulator (phase 8) is what re-checks them.
