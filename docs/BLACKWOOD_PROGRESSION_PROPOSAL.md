# Blackwood progression: final proposal

**Status: FINAL, approved by George (see §6). Design only; no code in this PR.** Field names in §5 are exact and were checked against origin/main 9fc1fb0 (no collisions).

**Goal.** Today the fastest win is 4 actions (search 3 rooms, accuse), because every clue sits behind a free search and ACCUSE appears after one clue. This proposal makes the player talk, follow leads and crack people open first. The fastest legal path becomes **11 actions**, and a typical game 18-25.

**State today (origin/main 9fc1fb0).** Only the `hiddenUntil` / knowledge-gate machinery, `initiallyAvailable`, secret `revealConditions`, testimony cards and contradiction hints exist. There is no `requires` on locations or clues, no leads, and no accuse gate: the ACCUSE button shows when `evidence.length > 0`, and `/api/accuse` only checks that the cited clues were discovered. The win rule today needs one key clue (`engine/accusation.ts`). One accusation per game is already enforced (#22). Progress needs **no new GameState fields**: `discoveredEvidenceIds`, `searchedLocationIds`, `revealedSecretIds` and `characters[id].interrogationCount` already sit in the signed token, and every condition below only ever goes from false to true.

## 1. Investigation flow (real ids)

An *exchange* is the existing `characters[id].interrogationCount`, which `commitTurn` bumps on every committed turn (interrogation, presenting a clue, confrontation, and fallback replies), so a model outage can never lock the game. Conditions are checked against the state **before** the action, so one search can't chain two unlocks.

1. **Library** is open. Search finds `silver-candlestick`. *Dining room* stays shut until then ("Crime scene first, detective! Procedure!"). It also lines up with `f-weapon-origin`, the matching pair on the dining table.
2. **Talk.** Two exchanges with a suspect opens a lead card (see §3). The card text is authored and deterministic. It does not depend on what the model says.
   - Reginald (2): the empty keyhole at 21:30 (`ev-reginald-scream`), and the letter that lay open on the desk at 21:12 and had vanished by 21:32.
   - Archibald (2): he burst the lock at 21:31 and no key was in it (`ev-door-forced`).
   - Victoria (2): her tell, glancing at the dining-room fireplace.
   - Gregory (2): his tell, staring at his hobnailed boots.
3. **Dining room, search 1** finds `library-key` (coal scuttle). It needs the empty-keyhole lead (Reginald or Archibald) **or** the fireplace lead (Victoria). The first search also shows a nag: "The hearth is still holding out on you."
4. **Dining room, search 2** finds `burned-letter` (grate). It needs `library-key` already found **and** Reginald's missing-letter lead. A comic locked line plays until then.
5. **Garden** (search) gives a lead, not a clue: a snuffed storm lantern abandoned by the garden door (Gregory's lantern died at 21:14, and he came in by that door at 21:16). **Hall:** `muddy-footprint` needs the lantern lead **or** Gregory's boots lead.
6. **Kitchen** (search) gives a lead: the servants' telephone sits crooked on its hook, with a soggy shred of cigar on the mouthpiece. Archibald phoned at 21:15-21:20 and chews an unlit cigar.
7. **Crack them.** Present clues. `burned-letter` to Reginald reveals `s-reginald-theft`. `library-key` to Archibald reveals `s-archibald-false-alibi`. Footprint then key to Gregory reveals `s-gregory-in-hall`, then `s-gregory-saw-victoria`. These cards can then be put to Victoria and Archibald to break the "together" alibi.
8. **Accuse** (§2).

**Canon check.**
- Every lead is something the speaker witnessed, or a tell already authored in the character file. Nothing in the leads is a secret.
- Gregory can't nudge the dining room: all he knows about it (Victoria walking there) sits behind `s-gregory-saw-victoria`. So the dining-room nudges come from Reginald, Archibald and Victoria's tell instead.
- One tiny **new canon fact** is needed: `f-letter-gone` (21:32, library, Reginald witnessed, 0.8). The letter was burned at 21:20, so it fits the timeline. Only Reginald knows it.

## 2. When ACCUSE unlocks

All of: **>= 3 clues found**, **>= 3 suspects questioned with >= 2 exchanges each**, **>= 2 secrets revealed**, and the lead `lead-alibi` closed (an alibi-breaking secret revealed).
- **While locked:** the button stays visible but is stamped "CASE NOT READY". Tapping it shows a playful hint for the first unmet item plus counts ("Clues 2/3 · Suspects 1/3 · Cracks 0/2"). Counts are shown, but never which clue, who, or why.
  - Clues: "A hunch and a hat don't close a case, detective. Keep looking."
  - Suspects: "You've barely spoken to the household! Everyone has something to say, and somebody is fibbing."
  - Cracks: "Plenty of chatter, no cracks. Somebody here is sitting on a story. Lean on them with what's in your notebook."
  - Alibi: "One of tonight's stories hasn't been put to the test yet."
- **Win rule (server-side):** the right murderer, weapon and motive, plus **both** key clues and **at least one** key testimony cited (`minKeyEvidence: 2`, `minKeyTestimony: 1`). Citing a revealed secret is a mandatory picker on the accuse form.

## 3. Case-progress tracker ("Leads" tab in the Notebook)

Each lead is an open question. Open leads show the hint; closed leads are struck through with a stamp. The Investigate screen shows locked rooms with a padlock and their `lockedLine`. Opening a lead plays a "NEW LEAD!" sting (driven by `progress.newLeadIds`). The suspect cards show "questioned 2/2 ✓". Nothing here names a culprit.

| Lead | Opens when | Closes when | Unlocks |
|---|---|---|---|
| `lead-weapon` "What struck his lordship down?" | start | `silver-candlestick` found | dining room |
| `lead-motive` "Who gains from his death?" | start | `burned-letter` found | (tracking only) |
| `lead-keyhole` "Where does a key go when it leaves a locked room?" | Reginald >= 2 or Archibald >= 2 | `library-key` found | `library-key` |
| `lead-fireplace` "Her ladyship keeps eyeing the dining-room fireplace." | Victoria >= 2 | `library-key` found | `library-key` |
| `lead-letter` "Reginald saw a letter on the desk at 21:12. By 21:32 it was gone." | Reginald >= 2 | `burned-letter` found | `burned-letter` (with the key) |
| `lead-lantern` "A snuffed lantern by the garden door. Who came in out of the dark?" | garden searched | `muddy-footprint` found | `muddy-footprint` |
| `lead-boots` "The gardener never looks up from his boots." | Gregory >= 2 | `muddy-footprint` found | `muddy-footprint` |
| `lead-alibi` "Who was really with whom during the blackout?" | kitchen searched, or Victoria >= 2, or Archibald >= 2 | `s-reginald-theft`, `s-archibald-false-alibi` or `s-gregory-saw-victoria` revealed | ACCUSE |
| `lead-eyewitness` "Did anyone see who stood at the library door?" | hall searched | `s-gregory-saw-victoria` revealed | (bonus) |

A lead counts as closed as soon as its `closesWhen` holds, even if it never opened.

## 4. Fairness sketch

- **Reachability.** Interrogation and presenting are never gated. Every condition is monotone (counters and sets only grow), so no order of play can undo an unlock, and every order reaches the same fixed point. The unlock graph is a DAG: talk -> leads -> key -> letter -> secrets (secrets need clues, never the reverse). No clue or secret needs stress; only Victoria's optional `s-victoria-left-dining` has a stress route.
- **Redundancy.** The key has 3 routes (Reginald, Archibald or Victoria). The footprint has 2 (garden or Gregory). `lead-alibi` closes on any of 3 secrets, each cracked by a different clue. One flaky model reply can't dead-end the game. The one single point is Reginald for the letter: he is mandatory, but deterministic (2 exchanges).
- **Skipping or reordering.** Searching everything first: the player gets library, dining room, then padlocks with nag lines, then talks. Talking first: leads open, the dining room still needs the library search. Presenting a clue not yet found: impossible. Skipping Gregory, the garden and the kitchen: allowed, since the proof doesn't need them.
- **Provable from evidence alone.** Both key clues are reachable with zero stress.
  - WHO and HOW: `library-key` and `burned-letter` in Victoria's dining room, plus the candlestick.
  - The alibi breaks via the clue-gated testimony (`s-archibald-false-alibi`, `s-reginald-theft`).
  - WHY: the letter, with Reginald's 20:54 testimony as a backup.
  - WHEN: the candle burn.
  - No confession is needed (SOLUTION_PROOF §5).
- **No lucky guess.** ACCUSE is locked until the gate is met. Winning needs both key clues and a real revealed secret in the citations, all re-checked against the signed token. After the gate, the only residual luck is murderer x weapon x motive, about 1 in 48 (3 clues, 4 suspects, 4 motives), and a player at that point holds the proof anyway. With one accusation per game (#22) a wrong guess is final.
- **Fastest legal path, 11 actions:**

| # | Action |
|---|---|
| 1 | Search library (candlestick) |
| 2-3 | Two exchanges with Reginald (opens keyhole and letter leads) |
| 4 | Search dining room (key) |
| 5 | Search dining room again (letter) |
| 6 | Present letter to Reginald (`s-reginald-theft` revealed; his 3rd exchange) |
| 7 | Present key to Archibald (`s-archibald-false-alibi`) |
| 8 | One more Archibald exchange |
| 9-10 | Two exchanges with Victoria |
| 11 | Accuse: Victoria, candlestick, inheritance, cite key + letter + the Archibald testimony |

Gate check: 3 clues, 3 suspects with >= 2 exchanges, 2 secrets, alibi lead closed. A game with the garden, kitchen, hall and Gregory takes about 20 actions.

## 5. Engine and schema changes for Dexter (all new unless marked)

All names below are final. Collision check against origin/main 9fc1fb0: none of `Condition`, `requires`, `lockedLine`, `leads`, `Lead`, `opensWhen`, `closesWhen`, `accuseGate`, `closedLeadIds`, `minKeyEvidence`, `keyTestimonyIds`, `minKeyTestimony`, `hasKeyTestimony`, `progress`, `newLeadIds` exists anywhere in `engine/`, `ai/`, `app/`, `components/` or `docs/CASE_FORMAT.md`. All schemas are strict (`z.strictObject`), and every new field is optional, so existing cases and tokens still load.

**5.1 Shared type `Condition`** (strict, at least one atom, `mode` default `"all"`):
```ts
Condition = { mode?: "any"|"all",
  interrogated?: { characterId: Id, minExchanges?: int>=1 /*default 1*/ }[],  // characters[id].interrogationCount >= n (exists)
  evidenceIds?: Id[],         // all/any in discoveredEvidenceIds (exists)
  secretIds?: Id[],           // in the case-wide revealed set (exists)
  searchedLocationIds?: Id[], // in searchedLocationIds (exists)
  leadIds?: Id[] }            // lead state is "open" OR "closed" (a closed lead counts as open)
```
**5.2 Gated rooms and clues.** `requires?: Condition` and `lockedLine?: string (<=160)` on `Location` (`engine/types.ts` `LocationSchema`) and on `Evidence`. `lockedLine` is public. `requires` is never public: `PublicCaseView.locations` becomes a `PublicLocation` type (Location minus `requires`), and `toPublicEvidence` already picks fields, so it needs no change. Evaluated against the state **before** the action. A locked location returns its `lockedLine` and finds nothing. Locked evidence stays hidden and its `lockedLine` is appended to the search lines.
```json
{ "id": "burned-letter", "locationId": "dining-room", "lockedLine": "The hearth is still holding out on you.",
  "requires": { "mode": "all", "evidenceIds": ["library-key"], "leadIds": ["lead-letter"] } }
{ "id": "dining-room", "lockedLine": "Crime scene first, detective! Procedure!", "requires": { "evidenceIds": ["silver-candlestick"] } }
```
**5.3 `leads?: Lead[]` in case.json.** `Lead = { id, title (<=70, public), hint (<=240, public), opensWhen?: Condition /*omit = open at start*/, closesWhen: Condition /*required*/, closedLine?: string (<=160, public) }`. State is `hidden | open | closed`, derived on demand by a pure `leadStates(caseData, game)` in new `engine/progress.ts`. Closed wins over open.
```json
{ "id": "lead-lantern", "title": "A snuffed lantern by the garden door", "hint": "Who was out in the dark, and where did they come in?",
  "opensWhen": { "searchedLocationIds": ["garden"] }, "closesWhen": { "evidenceIds": ["muddy-footprint"] } }
```
**5.4 `accuseGate?: AccuseGate` in case.json** (omit = today's behaviour).
```json
{ "minEvidence": 3, "minSuspectsQuestioned": { "count": 3, "minExchanges": 2 }, "minRevealedSecrets": 2, "closedLeadIds": ["lead-alibi"],
  "lockedLines": { "evidence": "...", "suspects": "...", "secrets": "...", "leads": "...", "default": "..." } }
```
Types: `minEvidence` int>=1, `minSuspectsQuestioned.{count,minExchanges}` int>=1, `minRevealedSecrets` int>=0, `closedLeadIds` Id[], `lockedLines.*` string (<=160), `default` required. `/api/accuse` recomputes the gate from the token and returns **403 `accuse_locked`** with the line of the first unmet item (order: evidence, suspects, secrets, leads). The state token is unchanged by a refusal.

**5.5 Win rule.**
- `solution.json` (`CaseSolutionSchema`): `minKeyEvidence?: int>=1` (default 1; Blackwood 2), `keyTestimonyIds?: Id[]` and `minKeyTestimony?: int>=0` (default 0; **Blackwood 1**). Blackwood `keyTestimonyIds`: `s-reginald-theft`, `s-archibald-false-alibi`, `s-gregory-saw-victoria`.
- `Accusation` (`engine/types.ts`): `keyTestimonyIds?: Id[]` (default `[]`, max 3). Also stored in the signed token, so `state-token.ts` must accept it and check each id is a real secret.
- `/api/accuse`: every cited testimony id must be revealed in the token (else `testimony_not_revealed`, same shape as `evidence_not_discovered`).
- `gradeAccusation`: win needs the right murderer, weapon, motive, `keyEvidenceCited.length >= minKeyEvidence` and `keyTestimonyCited.length >= minKeyTestimony`. `AccusationGrade` gains `keyTestimonyCited` and `hasKeyTestimony`; `AccuseVerdict` gains `hasKeyTestimony` (still win-only, per #22).
- When `minKeyTestimony >= 1` the accuse form must not submit without a cited testimony: new "cite a confession" picker reusing the notebook testimony cards.

**5.6 `progress` object** returned by every route that returns a `stateToken` (`/api/investigate`, `/api/interrogate`, `/api/confront`, `/api/hint`, `/api/accuse`) and, for the starting state, on `PublicCaseView`:
```ts
progress: {
  leads: { id, title, state: "open"|"closed", hint?: string /*open*/, closedLine?: string /*closed*/ }[],  // hidden leads omitted
  newLeadIds: string[],          // leads that became open or closed in THIS action (state before vs after, stateless)
  lockedLocationIds: string[],   // rooms whose `requires` is unmet now
  accuse: { unlocked: boolean,
            checklist: { clues: {have,need}, suspects: {have,need}, secrets: {have,need} },
            line?: string }      // first unmet item's lockedLine, only while locked
}
```
Counts only: it never says which clue, who or why. `requires`, `opensWhen`, `closesWhen`, `accuseGate` stay private. UI: Notebook "Leads" tab, padlocked room cards, CASE NOT READY stamp, NEW LEAD sting, suspect "questioned n/2" badge.

**5.7 Validator** (`validate:case`, `engine/case-validation.ts`):
- **Errors:**
  - Every id in a Condition, lead, `accuseGate`, `keyTestimonyIds` and `requires` must resolve (character, evidence, secret, location, lead).
  - Empty Condition; duplicate lead ids; `closesWhen` missing; `lockedLines.default` missing.
  - A location or clue that requires itself; a cycle through `leadIds` (lead opens/closes on itself) or through `requires`.
  - `requires` on evidence with no `locationId` or with `initiallyAvailable: true`.
  - `keyTestimonyIds` that are not secrets with a `testimonySummary`; `minKeyTestimony > keyTestimonyIds.length`; `minKeyEvidence > keyEvidenceIds.length`.
  - **Reachability simulation** from an empty state. Every suspect can be questioned without limit, and any held clue can be shown to anyone. Secrets reveal by evidence and `afterSecretIds` only; stress-only conditions count as unreachable. Iterate to a fixed point. Fail if any location, clue, lead, the `accuseGate`, `keyEvidenceIds` (at least `minKeyEvidence`) or `keyTestimonyIds` (at least `minKeyTestimony`) is unreachable.
- **Warnings:** a lead that never opens or never closes; `accuseGate.minEvidence < 2`; locked evidence with no `lockedLine`; a gated location with no `lockedLine`.
- **Info line:** "fastest legal path: N actions" from a greedy count of the simulation (Blackwood should report 11).

**5.8 Exists vs new.** Exists: the state fields above, `initiallyAvailable`, reveal conditions, testimony cards, `hiddenUntil`, the `/api/accuse` evidence check, one accusation per game (**#22 is fixed on main, a254d96, so there is no remaining dependency**). New: 5.1-5.7. Not needed: any new `GameState` or token field apart from the optional `Accusation.keyTestimonyIds`.

## 6. Decisions (George, answered)
1. **Gate strength: 3 clues.** ACCUSE unlocks at the gate as written in §2: >= 3 clues, >= 3 suspects questioned >= 2 exchanges each, >= 2 secrets revealed, `lead-alibi` closed.
2. **Cite a confession: mandatory.** The accuse form must make the player cite revealed testimony: `minKeyTestimony: 1`, not optional.
3. **Canon addition: yes.** `f-letter-gone`: Reginald noticed the letter missing at 21:32.

## 7. Build order for Dexter
1. `Condition` type plus `engine/progress.ts` (`evaluateCondition`, `leadStates`, `accuseProgress`), with unit tests and no behaviour change.
2. Schema: `requires`/`lockedLine` on Location and Evidence, `leads`, `accuseGate`, solution `minKeyEvidence`/`keyTestimonyIds`/`minKeyTestimony`, `Accusation.keyTestimonyIds` and the token check. `PublicLocation` strips `requires`.
3. Validator: reference checks, cycles, reachability simulation, warnings, fastest-path info line. Add a fixture-manor and a harbor-light example for each field.
4. `searchLocation` gating (pre-action state) and the `progress` object on every route that returns a token.
5. `/api/accuse`: the 403 `accuse_locked` gate, cited-testimony check, `gradeAccusation` and the verdict field.
6. UI: Leads tab, padlocks, CASE NOT READY stamp with counts, NEW LEAD sting, "questioned n/2" badge, the mandatory testimony picker on AccuseScreen.
7. Tell Agatha when merged.

## 8. What Agatha does after (Blackwood data migration)
1. Add `f-letter-gone` to `case.json` (21:32, library, Reginald witnessed, confidence 0.8) and to Reginald's `knownFactIds` only; add it to the timeline tests' knowledge-boundary lists.
2. Add `requires` and `lockedLine` to `dining-room`, `library-key`, `burned-letter`, `muddy-footprint`; add the nine leads of §3 with their hints; garden and kitchen get the lantern and telephone lead lines (authored search flavour, no secrets).
3. Add `accuseGate` as in §5.4 with four playful lines; add `minKeyEvidence: 2`, `keyTestimonyIds` and `minKeyTestimony: 1` to `solution.json`.
4. Run `validate:case` (zero warnings, fastest path = 11) and update `SOLUTION_PROOF.md`: new fastest path, leads table, gate, provable-from-evidence section, and the no-stress reachability.
5. Update the case tests that expect both dining-room clues from a single search; add tests for every lead, the gate, the 403, and the cited-testimony win rule. Full tests, typecheck, lint green, then one PR, not merged.

## 9. Implementation notes (after the backend and the Blackwood migration)
- The validator's exact fastest legal path for Blackwood is **10 actions**, not the 11 counted by hand in §4: showing a clue to Victoria is also an exchange that cracks one of her secrets (`library-key` → `s-victoria-left-dining`, `burned-letter` → `s-victoria-new-will`), so she supplies both a second suspect-exchange and the second revealed secret. See `cases/blackwood/docs/SOLUTION_PROOF.md` §12.4 for the path. Raising `minSuspectsQuestioned.minExchanges` to 3 or `minRevealedSecrets` to 3 would restore 11; that is George's call.
- Schema differences from §5, all minor: `accuseGate.minSuspectsQuestioned`, `minRevealedSecrets`, `closedLeadIds` and `lockedLines` are optional (`lockedLines.default` is required only when `lockedLines` is given); `progress.leads[].state` is `open|closed` only (hidden leads are omitted); `progress.accuse` also carries `citeTestimony`; the exchange counts are capped at the largest threshold used.
- Blackwood's jabs and touchy subjects use the relationship `jabs` / `defensiveOn` fields from #27.
