# Case authoring guide

How to write a WHODUNIT?! case so the work is mostly storytelling and the machines do the checking. This guide is **practical, not normative**: the contract is `docs/CASE_FORMAT.md` (source of truth: `engine/case-schema.ts`, `engine/types.ts`, `engine/solution.ts`). Every field named here exists on `main`. Things that are **planned but not built** are marked **PLANNED** and must not go into case JSON yet (unknown keys are errors).

WHODUNIT?! is live for public players. A new case ships complete: fair, funny, provable, and clean under the validator.

Source tags used below: **[CF]** `docs/CASE_FORMAT.md` · **[PP]** `docs/BLACKWOOD_PROGRESSION_PROPOSAL.md` · **[SP]** `cases/blackwood/docs/SOLUTION_PROOF.md` · **[TD]** `docs/cases/TALLYHO_DESIGN.md` · **[MP]** `docs/MASTER_PLAN.md` · **[R2]** the Blackwood round-2 QA notes (#26/#27, commits `3a3fa3d`, `8eecb81`, `dc91bce`, `29a2b9c`).

---

## 1. Folder layout

```
cases/<caseId>/                 folder name == case.json "id" (lowercase kebab/snake, <= 64 chars, no leading "_")
  case.json                     REQUIRED  envelope: title, tagline, intro, victim, locations, facts, motives, + optional leads, accuseGate, backdrops, knowledgeGate
  timeline.json                 REQUIRED  point/window entries that place people (the engine trusts these for "who was where")
  evidence.json                 REQUIRED  clues: where found, what they relate to, discovery line
  characters/<id>.json          REQUIRED  >= 2; one per suspect; file name == id (persona, knowledge, secrets, lies, relationships)
  solution.json                 REQUIRED  SERVER-ONLY. murderer, weapon, location, time, motive, key evidence/testimony, win thresholds
  endings.json                  OPTIONAL  SERVER-ONLY. authored confession, recap and per-suspect wrong endings. Always ship it for a public case
  docs/SOLUTION_PROOF.md        OPTIONAL  ignored by the loader. Ship it: it is the fairness proof (see §2, step 8)
```

- **Server-only: `solution.json` and `endings.json`.** They spell out the answer. They never reach the public view, the character context, or the model. Never paste their contents into `case.json`, intro text, lead hints, or discovery lines. [CF "What the AI and the player can see"]
- Everything else in `case.json` / `evidence.json` marked PUBLIC in [CF] (victim, location text, `searchFlavor`, `discoveryLine`, motive options, lead titles/hints, `lockedLine`s, `testimonySummary` once revealed) is read by players. `requires`, `opensWhen`, `closesWhen`, `accuseGate` stay private.
- `_`-prefixed folders are templates and never served; every other folder with a `case.json` is live at `/case/<caseId>`. [CF intro] **Do not push a half-finished case under a plain id to `main`.** Build it under `_<caseId>` or on a branch, and rename it for the release PR.
- Optional art fields: `locations[].background`, `case.json backdrops.{title,suspects,interrogation,investigate}`, character `portrait`. Paths look like `/assets/<folder>/<file>.webp`. The validator warns if one is missing. [CF "Art fields"]
- Working references: `tests/fixtures/cases/fixture-manor` (every feature), `tests/fixtures/cases/harbor-light` (minimal), **`tests/fixtures/progression/progress-light` (every progression field)**, `cases/blackwood` (the shipped case; its progression migration is **not yet on `main`**: it has no `leads`/`accuseGate` today, see [PP §8]).

---

## 2. The authoring workflow (ordered checklist)

Do these in order. Skipping the design document is the single most expensive mistake: every Blackwood QA round was a contradiction a written timeline would have caught. **Model: `docs/cases/TALLYHO_DESIGN.md`** (pitch page without spoilers, then cast, locations, minute-level timeline, solution, motives, clues, secrets/lies/knowledge matrix, progression, fairness proof, art needs, schema gaps, mechanical consistency checks, fact registry).

1. **Pitch (spoiler-free page).** Setting, victim, cast in one line each, what makes it hard, target length. [TD §0]
2. **Design document** `docs/cases/<NAME>_DESIGN.md`, in this order:
   1. **Cast and locations.** Each suspect: role, voice (register, not catchphrases), what they want, what they hide.
   2. **True timeline.** Minute-level. A location grid (one place per person per checkpoint, nobody in transit, travel times respected). [TD §3.2-3.4]
   3. **Solution.** Who, how, where, when, why, and what each key clue proves. Staged or false facts get their own layer. [TD §4]
   4. **Clue chain.** Every clue: where found, what it proves, what it unlocks, which lie it breaks. Each red herring has a harmless explanation and a clue or secret that resolves it. [TD §6, §12]
   5. **Secrets and lies per character.** For each: the truth, who can ever know it, what reveals it (clue/testimony, never only stress), what the testimony card may say. Add the knowledge-boundary matrix. [TD §7]
   6. **Progression.** Leads, gated rooms/clues, accuse gate, key clues and testimony, as a dependency graph with no cycles. [TD §8, PP §1-5]
   7. **Fairness proof** (see §5): reachability, no soft-locks, provable from evidence alone, fastest and typical path. [TD §9]
   8. **Art needs** for Toon (see §6). [TD §10]
   9. **Schema gaps.** Anything the story needs that the engine cannot express. Raise it *before* writing JSON. [TD §11]
3. **Review gate.** George (or the reviewing agent) signs off on the design. Do not start JSON on an unreviewed design.
4. **Write the JSON** in this order, because later files reference earlier ids: `case.json` (locations, facts, motives) → `timeline.json` → `evidence.json` → `characters/*.json` → `solution.json` → `endings.json` → progression fields (`requires`/`lockedLine`, `leads`, `accuseGate`, `minKeyEvidence`/`keyTestimonyIds`/`minKeyTestimony`).
5. **Run the validator** until it prints no warnings (§3, §7):
   ```bash
   npm run validate:case -- <caseId>
   npm run validate:case -- <caseId> --cases-dir <dir>      # a folder outside cases/
   ```
6. **Write the case tests** `tests/cases/<caseId>*.test.ts` (§7 template). The validator checks structure and reachability; **tests check the story** (who knew what, no giveaway wording, clue locations, endings).
7. **Playtest the fastest path by hand** (or via the engine routes) and check it against the number the validator prints.
8. **Write `cases/<caseId>/docs/SOLUTION_PROOF.md`**: the answer, the canonical timeline, the clue table, reveal rules, lies and what breaks them, the WHEN/HOW/WHO/WHY deduction chain, "proof without any confession", knowledge sources, gate and path tables. Model: `cases/blackwood/docs/SOLUTION_PROOF.md`. Keep it in sync with the data; the tests should assert the facts it states.
9. **Run everything** (`npm run validate:case -- <caseId>`, `npm test`, `npm run typecheck`, `npm run lint`), open a PR (not merged by you), hand art/sound needs to Toon.

---

## 3. Writing for the validator

`validate:case` prints each problem as `file -> path: message` and exits non-zero on **errors**. **Warnings** do not fail the run, but **a public case ships at zero warnings** (Blackwood does). It also prints the progression summary and `fastest legal path: N actions`. [CF "Checks"]

### 3.1 Errors (the case will not load)

| What it errors on | How to avoid it |
|---|---|
| Schema: unknown/misspelled keys, bad ids, times not `HH:MM`, numbers out of range (personality and `confidence` 0-1; relationship axes, `stressThreshold` 0-100), `searchFlavor.lines` not 1-2 items | Copy shapes from [CF]; never invent a key. |
| Duplicate ids (locations, motives, evidence, characters, each character's beliefs/secrets/lies; **facts and timeline entries share one namespace**; lie ids must be unique case-wide) | Prefix: `loc-<who>-<hhmm>`, `ev-…`, `f-…`, `s-<who>-…`, `l-<who>-…`, `b-<who>-…`, `lead-…`. |
| A reference that does not resolve (location, person, fact, evidence, secret, lie, motive) | Write files in the §2 order; validate often. |
| Victim id equals a character id; character file name != id; fewer than 2 characters | |
| Window with `to` before `from` in game-day order; a fact with both `time` and `from/to`; a timeline entry with neither | A case covers one day from `dayStartsAt` (default 12:00); earlier times count as after midnight. |
| Solution does not resolve (murderer is not a character, weapon not evidence, location/motive missing, key evidence missing) | |
| **Opportunity rule:** no timeline entry places the murderer at `solution.locationId` within 15 min of `solution.time` (`OPPORTUNITY_WINDOW_MINUTES`) | Add a located entry: `|time − t| ≤ 15` for a point, `from − 15 ≤ t ≤ to + 15` for a window. |
| **Every non-murderer needs ≥ 1 secret** | Red herrings are the fun; give each innocent one. |
| `endings.json`: unknown `speaker` (use a character id or `"narrator"`), unknown `evidenceIds`, a `wrong` key that is not a suspect, **`wrong` missing any suspect, including the murderer** | Write all N entries; see §4 on what a loss may show. |
| `supersededBySecretIds` naming another character's secret | Only the lie owner's *own* secrets. For someone else's testimony use `breaksOnSecretIds`. |
| `hiddenUntil.lieIds` that does not exist or is not unique | |

**Progression errors** (only if you use the fields) [CF "Progression", PP §5.7]:

- any unresolved id in a `Condition`, lead, `accuseGate`, `keyTestimonyIds`; an empty `Condition` (needs ≥ 1 atom); duplicate lead ids;
- a room or clue that `requires` itself; a lead cycle through `leadIds`;
- `requires` on a clue with no `locationId` (nothing ever searches it) or with `initiallyAvailable: true` (it is already in the notebook);
- `keyTestimonyIds` that are not secrets with a `testimonySummary`; `minKeyTestimony` > `keyTestimonyIds`; `minKeyEvidence` > `keyEvidenceIds`; gate counts above what the case has;
- **Reachability simulation** (below). *Any room, clue, the accuse gate, enough key clues, or enough key testimony that can never be reached is an error.*

**How the reachability simulation thinks** (so you can design to pass it): a generous player questions everyone without limit, can show any held clue to anyone, secrets reveal by evidence and `afterSecretIds` only, and **stress-only conditions count as unreachable**. Consequences:

- Never make a key clue, a key testimony, or a gate item depend on stress alone.
- A clue gated by a room that is gated by that clue is a cycle. Draw the dependency graph in the design doc first (`mermaid` in [TD §8.2]).
- Conditions are checked against the state **before** an action, so one search never chains two unlocks. Design "search A, then search B", not "search A unlocks B in one go".
- An "exchange" is one committed turn with a suspect (a question, a clue or testimony shown, a confrontation, or a fallback reply); a model outage still counts, so it cannot lock the game. [PP §1]

### 3.2 Warnings (fix them anyway)

| Warning | Fix |
|---|---|
| Evidence with no `locationId` and not `initiallyAvailable` (unfindable) | Give it a room, or make it `initiallyAvailable`. |
| Lie that can never break (all conditions unreachable) | Give it a reachable `brokenByEvidenceIds`, or a `breaksOnSecretIds` whose secret is revealable by a findable clue. |
| Self-referential testimony: a lie that breaks on its owner's own secret, or on a fact only the owner's secrets carry | Point `breaksOnSecretIds`/`breaksOnFactIds` at **another** character's secret. To retire a lie on your own confession use `supersededBySecretIds`. |
| Reveal-order cycle in `afterSecretIds` | Order secrets as a chain, never a loop. |
| Secret used as testimony (`breaksOnSecretIds` / `breaksOnFactIds`) with no `testimonySummary` | Add a summary (≤ 240 chars). |
| `hiddenUntil` on a fact nobody knows, or on a secret that can never be revealed | Add the fact to someone's `knownFactIds`, or fix the key. |
| `knowledgeGate: "explicit"` with no `hiddenUntil` anywhere | Use `hiddenUntil`, or drop back to the default `proximity`. |
| Lead never opens / never closes | Fix `opensWhen` / `closesWhen`. |
| `accuseGate.minEvidence < 2` | A single clue unlocking ACCUSE is the easy mode the gate exists to stop. |
| A gated clue or room without `lockedLine` | Always write one (≤ 160 chars, public, funny, no spoilers). |

### 3.3 Progression conditions, `lockedLine`, leads, gate

```jsonc
// Condition: >= 1 atom; mode "all" (default) or "any"; atoms only ever go false -> true
{ "mode": "any",
  "interrogated": [{ "characterId": "boris", "minExchanges": 2 }],   // exchanges = interrogationCount, default 1
  "evidenceIds": ["smashed-watch"],        // discovered
  "secretIds": ["s-ottilie-bridge-visits"],// revealed anywhere in the case
  "searchedLocationIds": ["engine-room"],
  "leadIds": ["lead-tilt"] }               // lead is open OR closed
```

- **Gated room:** `locations[].requires` + `lockedLine` (public hint, ≤ 160). A locked room finds nothing and is not marked searched.
- **Gated clue:** `evidence[].requires` + `lockedLine`. The clue stays hidden; the line is appended to the search lines. It needs a `locationId` and must not be `initiallyAvailable`.
- **Leads** (`case.json leads[]`): `title` ≤ 70, `hint` ≤ 240 (shown while open), optional `opensWhen` (omit = open at start), **required** `closesWhen`, optional `closedLine` ≤ 160. Closed wins over open. Titles and hints are open *questions*, never answers, and never name a culprit. Use a lead to *tell the player* a door has opened, so no gate is a silent wall. [TD §8.1]
- **Accuse gate** (`accuseGate`): `minEvidence`, `minSuspectsQuestioned: {count, minExchanges}`, `minRevealedSecrets`, `closedLeadIds`, `lockedLines` (`default` required; others optional; each ≤ 160). The refusal line is for the **first unmet** item in the order clues → suspects → secrets → leads, so write each line to nudge, not to explain. The UI shows counts, never which clue or who. [PP §2, §5.4]
- **Win rule** (`solution.json`): `minKeyEvidence` (default 1), `keyTestimonyIds` (secrets with a `testimonySummary`), `minKeyTestimony` (default 0). A win needs the right murderer, weapon and motive, plus that many cited key clues and key testimony. Choose key testimony that *describes something the owner perceived*, not confessions. [TD §8.3]
- **Fastest-path info:** the validator prints `fastest legal path: N actions`, exact (breadth-first over searches, exchanges and clue-cracks; accusing counts 1; counts capped at the largest threshold used). Write that number in the design doc and the proof, and add a test that pins it. Blackwood's migration target is 11 [PP]; Tallyho's is 32 [TD §9.5]. If the printed number differs from your design, one of them is wrong; find out which before shipping.

### 3.4 Knowledge rules: what a character can know

These are enforced partly by the engine (the context builder withholds), partly by **your tests**. The validator does not check that nobody knows something they did not witness. That is on you. [SP §7, TD §7.0, TD §12]

1. **Nobody knows what they did not witness.** A located timeline entry lists in `involvesCharacterIds` only people who are at that location for the **whole** point/window. Give a character (in `knownFactIds`) only entries they were present for, or a fact with `source: heard | told` that says how they learned it.
2. **Perception is authored per perceiver.** No omniscient "everyone saw it". One entry per witness, located where *they* stand, with `source` (`witnessed | heard | told | inferred | canonical`) and `confidence` (0-1). Shared world truths stay `canonical`. [SP §7]
3. **If they were near but saw nothing, say so.** A witness who stood close and saw no one gets an explicit negative **fact** (`case.json`, not a timeline window, which would be withheld along with their other windows), plus a matching accurate belief. Without it the model fills the gap with an invented sighting. [SP §7.1 "Reginald saw no one", QA #6]
4. **Hide the truth behind a secret or lie.** While a secret is locked or a lie is unbroken, the engine withholds what is *linked*. Link everything that would give the game away: `aboutFactId` on the lie, `relatedFactIds` on the secret. Unlinked facts reach the model verbatim. [CF "Knowledge gate"]
5. **`hiddenUntil`** (on a fact): withheld until any listed `secretIds` is unlocked for that knower or any `lieIds` is broken for its owner. A fact with `hiddenUntil` follows only that rule. `hiddenUntil` applies to **every** character who knows that fact, including one who has no reason to hide it and needs it. In that case link it per character (`relatedFactIds` / `aboutFactId`) instead. [SP §7.2 `ev-victoria-passes-reginald`]
6. **`relatedFactIds`** on evidence/secrets: engine-use links. On a *secret* they are what its testimony carries (`breaksOnFactIds`) and what the gate withholds.
7. **`knowledgeGate`**: `proximity` (default) also withholds the character's own time-bound facts near a protected time, which over-hides in a dense timeline. Dense, minute-level cases (Blackwood, Tallyho) use **`"explicit"`** and review every fact the heuristic would have hidden. [SP §7.2, TD §7.0]
8. **Lies** (`intendedLies`): `claim` + `topic`/`aboutFactId` (a fact the liar actually knows). Break them with:
   - `brokenByEvidenceIds` (clue shown to them); list **only the lies the clue actually contradicts**, because evidence breaks a lie whether or not it has been told yet. [SP §11.4]
   - `breaksOnSecretIds` (someone else's revealed secret, presented to them) / `breaksOnFactIds` (a presented secret whose `relatedFactIds` include the fact); `breakMode: "any"` (default) or `"all"`.
   - `supersededBySecretIds`: the owner's **own** secrets; confessing one retires the lie in the same turn (prompt lists it under DROPPED STORIES). Use it whenever a confession literally contradicts the claim. [CF, SP §11.2]
   - Every lie should have an **evidence path**; testimony is a second route, never the only one. [SP §4.1]
9. **Secrets**: `severity`, `revealConditions` (`evidenceIds`, `stressThreshold`, `mode`, `afterSecretIds` for order). Stress shortcuts belong only on harmless red-herring secrets. A key-chain secret never reveals on stress alone. [TD §7.0]
10. **Testimony summaries** (≤ 240 chars, public once revealed): say only what the owner personally saw, heard or did, using clock times from the **owner's own** knowledge. Never name the culprit. **Give no summary to a secret that would name the killer by itself** (Blackwood's `s-victoria-locked-door` and `s-victoria-murder`; Tallyho's two culprit confessions) and never list those in anyone's `breaksOnSecretIds`. [SP §4.1, TD §7.0]
11. **Beliefs** (`isAccurate: false` red herrings) must point at a fact the believer can see, or the gate swallows them, and must not contradict anything the believer witnessed. [SP §7.1]

---

## 4. Writing rules learned from Blackwood QA

The model reads your free text verbatim and turns it into speech. Each rule below was a live bug.

1. **Explicit clock times and order of events** (#26). Say "21:13, two minutes after the candles were lit", not "after the lights went out until the candles". Anchor lies, beliefs, secrets and summaries to *events* (candles, the scream) and give clock times. Never describe a span relative to a landmark the character does not know. Write the order once in the design doc and have a test assert every statement uses it. [SP §11.1, R2]
   - The engine's order check recognises a few landmarks by phrasing: the lights going out, the candles being lit, the scream, the body being found, the lights coming back. Phrase facts for those the same way. Other landmarks are not checked yet. [R2, `ai/order-check.ts`]
   - `from 21:13 to 21:22` is read as a clock range (fixed in `dc91bce`). Use ranges freely.
2. **No catchphrases, no stock phrases.** The model repeats any quotable hook ("Darling, I simply couldn't.", "Must we dwell on unpleasantness?"). Blackwood ships `catchphrases: []`; `speechStyle` describes **register and behaviour** (how they talk, what they do when cornered), never a line to repeat. Also keep "darling"-style address out of lie `claim`s. Scripted lines in `endings.json` may keep flavour, because they are fixed text. [SP §11.3, R2] Running gags belong in register ("speaks of himself in the third person", "every sentence is a pun"), not in a fixed sentence. [TD §1]
3. **Cover-story goals and persona text.** `goals`, `traits`, `speechStyle` and relationship `description`s reach the model verbatim, so they must read as the character's *cover story* and must be **true both before and after the confession** (there is no supersession field for them). A goal like "keep quiet about the telephone call" tells the model the truth. Blackwood's test greps this free text for giveaway words (alibi, secret, theft, telephone, new will, …). Copy it. [SP §7.1, §11.2, QA #7, `tests/cases/blackwood.test.ts` "free text tells no secrets"]
4. **Pair material that is funny and knowledge-safe** (#27). `relationships[].description` is always in the prompt: write tone and what the speaker would say, never a fact that needs gating. Optional barbs, authored per ordered pair and used only for **that** pair:
   - `jabs: [{ text, aboutFactId?, when: "confrontation" | "any" }]`: one barb; with `aboutFactId` it is used only while the speaker knows that fact.
   - `defensiveOn: [{ topic, text }]`: what touches a nerve and how they bristle.
   - The prompt uses only the speaker's *own* relationship to the partner. Rules: a note uses only what the speaker knows; no note puts the murderer at the scene or accuses anyone outright; each of the N×(N−1) ordered pairs gets a distinct, substantial note. [SP §11.5, R2, CF]
   - Status: Blackwood authors `description` for all 12 pairs; `jabs`/`defensiveOn` are supported and validated (`aboutFactId` must resolve) but **no shipped case uses them yet**.
5. **`emptyLine`s.** Every location has `searchFlavor` (1-2 public lines) and an `emptyLine` for a repeat search that finds nothing. Search flavour and `discoveryLine`s are public: they name no suspect and do not mention the will, the telephone, the time, or any hidden fact. A clueless room is allowed and good (Blackwood's garden and kitchen carry only lead flavour). [SP §10, QA #19, `tests/cases/blackwood-content.test.ts`]
6. **Aliases.** Give the victim and every character the names people actually use (`aliases: ["his lordship"]`, `["the butler"]`). The canon check uses them to know who a sentence is about. A missing alias is a missed canon error. [CF]
7. **Era and vocabulary.** The system prompt tells every character they live in "an English country house in the 1920s" and forbids modern words (`ERA_RULE` in `ai/prompts/interrogation.ts`; the telephone is explicitly fine as an ordinary period fitting). Keep your own text period-correct, and if your setting differs (a yacht, say), note it in the design doc's schema gaps: per-case era text is **PLANNED** (§8). [R2 `3a3fa3d`]
8. **Lowercase location names in authored recaps.** `locations[].name` is capitalised ("The Library") because it titles cards and appears in prompts. Write the recap prose as "in the library". Only the engine's fallback recap line prints "in The Library". [SP §11.6]
9. **Endings never confirm a loss** (#22). A loss shows no solution and no per-field verdict. The `wrong` entry for the real murderer is never played; in an innocent's entry, lines spoken by the real murderer are dropped. Write each innocent's entry so it works with **no cameo from the killer**. The player then sees `escapedLine` and "The case went unsolved." Still write the murderer's entry. [CF "A loss must not confirm anything"]
10. **Blackwood ending conventions** (tested there, good defaults): confession 4-7 lines, mostly the culprit, citing the weapon and key clues in `evidenceIds`; recap is narrator prose whose time and place match `solution.json` and cites the proof. [`tests/cases/blackwood-content.test.ts`]
11. **Clues that mislead honestly.** A red herring points at a real person with a real, harmless explanation that some clue or secret resolves. No loose threads. [TD §6.3, §12]
12. **Tone.** Cartoon, no gore, no real people, no names or plots lifted from existing mysteries (Tallyho's design records an originality check). [TD §11.3, §12]

---

## 5. The fairness bar

A case is not done until the design doc *and* the proof prove all of these. Pin each with a test.

1. **Every clue is reachable.** Run the fixed-point reasoning from an empty state; the validator's simulation backs it up. List the cheapest chain per clue (actions). [TD §9.1]
2. **No soft-locks.** State only grows (exchanges, clues, secrets, searched rooms). Every gate has an exit that depends on talking or searching, never on the model saying a magic phrase. A wasted action (wrong clue shown) costs an exchange, never a door. Put redundancy (two routes) where a single flaky reply could matter. [TD §9.2]
3. **Provable from evidence alone.** Write the WHEN / HOW / WHO / WHY chain using only clues and *witness* testimony. **No step may need a confession.** State the one thing the player must infer and point at the concrete clue that anchors it (no hidden knowledge, no arithmetic). [SP §5, TD §9.3]
4. **No lucky guess.** The gate needs real work (many exchanges, secrets, closed leads). The win needs murderer + weapon + motive + cited key clues + cited key testimony, so a blind accusation fails even if the names are right. Put the odds in the proof. [TD §9.4]
5. **Alibi shape.** At the true time exactly the culprit(s) are unaccompanied; red herrings are unaccompanied at the *wrong* times. Each innocent has an alibi that is plausible but imperfect. [TD §12 #10]
6. **Path targets.** Document and pin both:
   - **Fastest legal path** = the validator's number (Blackwood target 11, Tallyho 32). Include the action-by-action table. [PP, TD §9.5]
   - **Typical path** = fastest plus real-world detours; Blackwood target 18-25 actions, Tallyho 45-70. As a rule of thumb both land at about 2× the fastest. [PP, TD §9.6]
   - Long forced-talk gates need *productive* actions (a clue shown, a secret revealed), not idle chat: in Tallyho 12 of the 24 forced exchanges are productive presentations. [TD §11.3]

---

## 6. What art and sound a new case needs (hand to Toon)

Check what the repo does today before asking. Put the list in the design doc (model: [TD §10]).

**Wired today (just supply files):**
- **Backgrounds, one per location:** `assets/backgrounds/<locationId>.webp`, 1920×1080. Auto-picked by id (or set `locations[].background`). Optional, same folder: `<room>_lightning.webp` (flash frame) and `<room>_window_mask.webp` (rain-on-window mask); the shared `assets/effects/rain_tile.webp` is reused. These conventions apply to the **interrogation** room (`backdrops.interrogation`, else the room where the body was found). Location ids share a global folder, so name them uniquely across cases (`boat-deck`, not `library`).
- **Screen backdrops** (`case.json backdrops`): `title`, `suspects` (the hub), `interrogation`, `investigate`. Optional; each falls back to the default look.
- **Suspect sprites, per suspect:** `assets/characters/<portrait ?? id>/<pose>.webp`, poses `neutral talking angry nervous shocked smug sad`, **784×1224**, face LEFT, feet on y=1200 centred. **Each suspect also needs an entry in `assets/characters/anchors.json`** (per-pose anchor points): the poses the game offers are read from it, so sprites without an entry show a silhouette. Optional `effectScale` entry in `assets/effects/effects.json` (default 1). Victim: no sprite needed unless the story uses one (notebook/recap).
- **Style and prompts:** `docs/ART_BIBLE.md` (locked style prompt, negative list, sprite spec).

**Clue art, supplied but NOT wired yet:** `evidence.json image` is declared, but the notebook renders it as a raw `<img src>` while the schema only accepts an id-style string. **Leave `image` out** until it has a resolver (Blackwood sets none; clues show a kind icon). Still have Toon draw the art, filed as `assets/clues/<clueId>.webp` (**PLANNED path**, not read by anything today).

**Sound today is global, not per case:** the 42-cue kit in `assets/audio/` and the screen→bed map (`bed_manor` / `bed_library` / `rain_loop`) are shared by every case. A new case needs no sound to ship. Case-specific beds or stingers (a ship's engine hum, a storm at sea) are **PLANNED** (needs a per-case audio hook). `docs/SOUND_NOTES.md` has the cue style and loudness policy.

**Ask list per case:** N location backgrounds (+ variants the recap needs), N suspect sprite sets (7 poses each) + anchors, title/suspects backdrops if different from default, the victim portrait, one illustration per clue (for later), 1-2 signature stickers/overlays if the story has a recurring gag (Tallyho's BONK/hic).

---

## 7. New-case skeleton and definition of done

### 7.1 Scaffold by hand (**PLANNED:** there is no `scaffold` command yet)

```bash
git fetch origin && git worktree add ../whodunit-<name> -b <you>/case-<id> origin/main
cd ../whodunit-<name>
cp -r cases/_placeholder cases/_<caseId>        # leading "_" keeps it unroutable while you write
# edit "id" to _<caseId> (the id must equal the folder name), rename characters, then:
npm run validate:case -- _<caseId>
```

Checklist of files to create (tick as you go):

- [ ] `docs/cases/<NAME>_DESIGN.md` (reviewed)
- [ ] `case.json`: `id`, `title`, `tagline`, `intro` (spoiler-free), `victim` (+`aliases`), `locations[]` (+`searchFlavor` with `emptyLine`, `lockedLine`/`requires` where gated), `facts[]`, `motives[]` (≥ 2, true one + red herrings), `knowledgeGate`, `leads[]`, `accuseGate`, `backdrops`
- [ ] `timeline.json` (placed people; opportunity entry for the murderer)
- [ ] `evidence.json` (`locationId`, `discoveryLine`, `relatedFactIds`, `relatedCharacters`, `requires`+`lockedLine`)
- [ ] `characters/<id>.json` ×N (persona with no catchphrases, `aliases`, `knownFactIds`, ≥ 1 secret each non-murderer with `testimonySummary` where used as testimony, `intendedLies` with break paths, `relationships` for every other suspect and the victim)
- [ ] `solution.json` (+ `minKeyEvidence`, `keyTestimonyIds`, `minKeyTestimony`, `explanation`)
- [ ] `endings.json` (confession, recap, `wrong` for every suspect, `escapedLine`)
- [ ] `docs/SOLUTION_PROOF.md`
- [ ] `tests/cases/<caseId>.test.ts` (+ `<caseId>-content.test.ts`)

### 7.2 Test template (copy from `tests/cases/blackwood*.test.ts`)

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { validateCase, loadCase } from "@/engine/case-loader";
import { checkCaseWarnings } from "@/engine/case-validation";
import { fastestPath } from "@/engine/progression-validation";

let c: Awaited<ReturnType<typeof loadCase>>;
beforeAll(async () => { c = await loadCase("<caseId>"); });

describe("<caseId> loads", () => {
  it("validates with no issues and no design warnings", async () => {
    expect((await validateCase("<caseId>")).issues).toEqual([]);
    expect(checkCaseWarnings(c)).toEqual([]);
  });
  it("fastest legal path matches the design doc", () => { expect(fastestPath(c)).toBe(/* N */ 0); });
});
// Then, per Blackwood: timeline consistency (one place per suspect per checkpoint; located entries only
// involve people present throughout), knowledge boundaries (nobody knows a located entry they were not at;
// perception facts only known by perceivers), every sensitive fact linked to the knower's own secret/lie,
// free text has no giveaway words, testimony summaries <= 240 and use the owner's own clock times,
// clue locations, every location has an emptyLine, public text names no suspect, endings cite the proof,
// the solution is provable from the key clues + witness testimony with no confession.
```

Run with `npx vitest run tests/cases/<caseId>*.test.ts`. The Blackwood files show the exact assertions; `tests/e2e/second-case.test.ts` shows the case-agnostic route flow on a second case.

### 7.3 Definition of done

- [ ] Design document reviewed and merged (or in the PR).
- [ ] `npm run validate:case -- <caseId>` prints ✅ with **zero warnings** and `fastest legal path` equal to the design's number.
- [ ] Every character, location and clue has the public fields players read (`bio`, `searchFlavor`+`emptyLine`, `discoveryLine`).
- [ ] No giveaway wording in free text; no catchphrases; lowercase locations in the recap; clock times and order consistent everywhere.
- [ ] `endings.json` complete (all suspects, murderer included).
- [ ] Case tests written and green; `npm test`, `npm run typecheck`, `npm run lint` green.
- [ ] `docs/SOLUTION_PROOF.md` in sync with the data (answer, timeline, clue table, lies, deduction chain, proof without a confession, fastest and typical path).
- [ ] Art/sound ask delivered to Toon (assets can land after the case, but the case must degrade gracefully: icon cards, silhouettes, default backdrops).
- [ ] Rename `_<caseId>` to `<caseId>` in the release PR only; PR opened (not merged by the author), docs-only changes kept in a separate PR from engine changes.
- [ ] Do not touch `engine/` in a content PR. Anything the story needs from the engine goes to Dexter as a request (§8).

---

## 8. Planned, not built (do not put these in JSON)

From [TD §11]; all absent from `engine/` on `main`:

- **A second culprit:** `solution.accompliceId`, `Accusation.accompliceId`, an always-visible optional "did anyone help?" picker, strict role grading, both culprits' lines dropped from loss endings, an accomplice opportunity check (`accompliceAct`). Needed for Tallyho (doer + stager). **PLANNED.**
- `revealConditions.testimonyIds` (testimony-triggered secret reveals), `keyTestimonyGroups`, `lieBrokenIds` in a `Condition`, `solution.stagedTime`/`staging`. **PLANNED / nice-to-have.**
- Per-case theme, per-case sound beds, a clue-art resolver, a case scaffold command, case-defined order landmarks, per-case era text in prompts. **PLANNED**; nothing in the data format yet.

If your story needs one of these, file it in the design doc's "schema gaps" section with the smallest proposed change, the way Tallyho does.
