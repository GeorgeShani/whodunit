# Case file format (contract v2)

The case-file contract is the single source of truth for authored cases. It is defined in `engine/case-schema.ts`, `engine/types.ts` and `engine/solution.ts`. Check your work with:

```bash
npm run validate:case -- blackwood
npm run validate:case -- fixture-manor --cases-dir tests/fixtures/cases   # a folder outside cases/
```

The validator lists every problem as `file -> path: message` and exits non-zero if there are any.

Working examples:

- `tests/fixtures/cases/fixture-manor/`: shows every feature, including point and window timeline entries, lies and reveal conditions.
- `tests/fixtures/cases/harbor-light/`: a minimal second case (3 characters, one clue per mechanic, endings, art fields) used by the end-to-end test.
- `cases/_placeholder/`: a small stand-in case kept for development.

Every folder in `cases/` whose name is a plain id (no leading `_`) and that contains a `case.json` is served at `/case/<caseId>`; `/` plays the default case (`DEFAULT_CASE_ID` in `lib/cases.ts`, currently `blackwood`). Folders starting with `_` (templates) and test fixtures are never routable.

## Layout

```
cases/<caseId>/
  case.json              envelope: id, title, tagline, intro, victim, locations, facts, motives
  timeline.json          TimelineEntry[]  (point-in-time or window facts that place people)
  evidence.json          Evidence[]
  characters/<id>.json   one per interrogable character (file name == id)
  solution.json          murderer / weapon / location / time / motive / key evidence. SERVER-ONLY.
  endings.json           authored ending cut-scenes. SERVER-ONLY. Optional for now (validated when present).
  docs/…                 optional, ignored by the loader
```

## Conventions

- **Ids** use lowercase kebab or snake case: `^[a-z0-9]+([-_][a-z0-9]+)*$`, max 64 characters.
  - Ids must be unique within their kind.
  - Facts (`case.json` `facts`) and timeline entries share one id namespace, so characters can list either in `knownFactIds`.
  - Character ids should match the art folder ids under `assets/characters/` (for Blackwood: `reginald`, `victoria`, `archibald`, `gregory`), or set `portrait` to the folder name. The portrait is loaded from `assets/characters/<portrait ?? id>/<pose>.webp`.
  - The victim's id must differ from every character id. It may be used wherever a "person" is expected: facts, timeline, relationships, `relatedCharacters`.
- **Case id** = the folder name. `case.json` `id` must equal it.
- **Times** use a 24-hour `"HH:MM"` clock.
  - A case covers one "game day" starting at `dayStartsAt` (default `"12:00"`).
  - Any time earlier than `dayStartsAt` counts as after midnight.
- **Strict keys:** unknown or misspelled keys are errors. Optional fields and fields that default to `[]` can be left out.
- **Number ranges:**
  - Personality scores and fact `confidence` are **0–1**.
  - Relationship axes, `stressThreshold`, and runtime stress and trust are **0–100**.
- **Emotions:** `calm nervous defensive angry sad scared smug amused flustered suspicious shocked panicked relieved`.

## case.json

```jsonc
{
  "id": "blackwood",
  "title": "Murder at Blackwood Manor",
  "tagline": "…",                       // title-screen line
  "intro": "Para one.\n\nPara two.",     // intro screen
  "dayStartsAt": "12:00",               // optional
  "knowledgeGate": "proximity",         // optional: "proximity" (default) | "explicit"; see "Knowledge gate" below
  "victim": {                           // PUBLIC
    "id": "lord-blackwood", "name": "…", "description": "…",
    "aliases": ["his lordship"],        // optional; how people refer to them (canon check subject matching)
    "foundAtLocationId": "library", "foundAt": "22:10", "causeOfDeath": "…"
  },
  "locations": [
    {
      "id": "library", "name": "The Library", "description": "…",
      "searchFlavor": {                 // optional, PUBLIC (Investigate screen)
        "lines": ["One or two lines shown when the player searches here."],   // 1–2 items
        "emptyLine": "Shown when a search finds nothing new."                // optional
      }
    }
  ],
  "facts": [ /* Fact[]: world truths not pinned to the timeline (see Fact) */ ],
  "motives": [                          // PUBLIC multiple-choice options for the accusation (≥ 2; include red herrings)
    { "id": "inheritance", "label": "The new will", "description": "optional" }
  ],
  "backdrops": {                        // optional, PUBLIC: per-screen scene art (asset paths)
    "title": "/assets/title/title_bg.webp",           // title screen
    "suspects": "/assets/backgrounds/manor.webp",     // suspect selection (ART_BIBLE §7.2)
    "interrogation": "/assets/backgrounds/….webp",   // interrogation scene
    "investigate": "/assets/backgrounds/….webp"      // Investigate screen behind the room cards
  }
}
```

### Art fields (optional, additive)

- **Asset paths** look like `/assets/<folder>/<file>.webp` (png/jpg/svg also allowed). They must live under `assets/` (copied to `public/assets/` by `sync:assets`); no `..`, no URLs, no query strings.
- **`locations[].background`**: the room's picture, used on its Investigate card.
  - Fallback 1: `assets/backgrounds/<locationId>.webp` if that file exists.
  - Fallback 2: an icon.
- **`backdrops.title | suspects | interrogation | investigate`**: whole-screen backdrops.
  - Each falls back to the screen's built-in look.
  - `lib/case-art.ts` `ART_DEFAULTS` can hold a stopgap per case; case data always wins.
- `validate:case` warns (it doesn't fail) when an art path doesn't exist under `assets/`.
- Sprites need no field: they resolve from `assets/characters/<portrait ?? characterId>/`.

### Fact

```jsonc
{
  "id": "f-library-single-key",
  "statement": "The library door has a single key.",
  "category": "timeline | location | relationship | object | motive | alibi | background",
  "time": "21:00",                      // optional point in time, OR…
  "from": "21:13", "to": "21:30",       // …an optional window (inclusive; from ≤ to in game-day order). Never both.
  "locationId": "library",              // optional
  "involvesCharacterIds": ["…"],        // optional; characters or the victim
  "source": "witnessed | heard | told | inferred | canonical",   // optional, default "canonical"
  "confidence": 0.8,                    // optional 0–1, default 1
  "hiddenUntil": {                      // optional explicit hiding (see "Knowledge gate")
    "secretIds": ["s-archibald-false-alibi"],   // any character's secret ids…
    "lieIds": ["l-archibald-together"]          // …and/or any character's lie ids (need to be unique case-wide)
  }
}
```

**Time ranges.** A ranged fact is tagged `[21:13-21:30, The Hall]` in the prompt, and for the canon check any minute inside the range counts as a time the character knows. Timeline entries have always accepted `from`/`to`; plain facts now can too.

**`hiddenUntil`.** The fact is withheld from everyone who knows it until ANY listed secret is unlocked *for that character* (they confessed it themselves, or the detective confronted them with it as testimony) or ANY listed lie is broken for its owner. A fact with `hiddenUntil` follows only this rule: the automatic links and the proximity heuristic skip it. At least one id is required.

```jsonc
// Archibald only "remembers" the phone call once he has admitted the false alibi, or his story has cracked.
{ "id": "ev-archibald-phone", "statement": "…", "category": "timeline", "from": "21:15", "to": "21:20",
  "locationId": "kitchen", "involvesCharacterIds": ["archibald"],
  "hiddenUntil": { "secretIds": ["s-archibald-false-alibi"], "lieIds": ["l-archibald-together"] } }
```

## timeline.json

This file is an array of **timeline entries**. A timeline entry is a Fact with either:

- a **point**: `"time": "20:30"`, or
- a **window**: `"from": "21:15", "to": "21:20"` (inclusive).

Every entry must have exactly one of the two.

When an entry has a `locationId`, **every id in `involvesCharacterIds` is present at that location** during that time. The engine relies on this. Entries without a `locationId` are allowed, but they don't place anyone anywhere.

```jsonc
[
  { "id": "loc-gregory-2030", "statement": "At 20:30 Gregory is in the kitchen.", "category": "location",
    "time": "20:30", "locationId": "kitchen", "involvesCharacterIds": ["gregory"] },
  { "id": "ev-phone-call", "statement": "…", "category": "timeline",
    "from": "21:15", "to": "21:20", "locationId": "servants-hall", "involvesCharacterIds": ["archibald"] }
]
```

## evidence.json

```jsonc
[
  {
    "id": "silver-candlestick", "name": "…", "description": "…",
    "kind": "physical | document | testimony | observation",
    "locationId": "library",            // where it is FOUND when the player searches this location (Investigate).
                                        // No locationId and not initiallyAvailable = unreachable.
    "discoveryLine": "Aha! …",          // optional, PUBLIC; shown in the discovery sting
    "relatedFactIds": ["…"],            // optional; facts or timeline ids (engine use only)
    "relatedCharacters": ["victoria"],  // optional; characters or the victim (engine use only)
    "initiallyAvailable": true,         // true = the player starts with it
    "icon": "🕯️",                       // optional emoji (1-8 chars, no plain letters) shown when there is no illustration
    "image": "silver-candlestick"       // optional legacy asset key (an illustration file name, see "Clue art")
  }
]
```

### Clue art

Every screen that shows a clue (notebook, "clue found" overlay, Present evidence, the accuse pickers, the end screen) uses the one
resolver `resolveClueArt` in `lib/clue-art.ts`, in this order:

1. **Illustration**: the first file that exists of `assets/evidence/<caseId>/<id>.webp`, `assets/evidence/<id>.webp`, then the legacy `image` key
   (`assets/evidence/<image>.webp`). `<id>` is the evidence `id` exactly. Drop the file in and it is picked up with no code or JSON change: the list
   of files is read when the app is built or started (a Vercel deploy does that; restart `npm run dev` after adding one).
2. **`icon`**: the item's own emoji.
3. **Generic fallback**: the shared `assets/evidence/_fallback.webp` (magnifier over a "?" tag) when present, else 🔍. The clue's `kind` is never used to guess a picture.

Illustration format: **WebP, square, 256x256 px** (it is shown at 64 px on cards and 96 px in the overlay, so 2-3x for sharp screens), a cartoon
object with the same black outline as the other art, on a transparent or flat warm background (the frame behind it is amber), ideally under 40 KB.
If an image fails to load the screen falls back to the icon. `npm run validate:case -- <caseId>` warns about a clue that has neither an icon nor a file.

## characters/&lt;id&gt;.json

```jsonc
{
  "id": "reginald", "name": "Reginald", "role": "The Butler", "bio": "Public card text.",
  "aliases": ["the butler"],                           // optional; other names for them (canon check subject matching)
  "personality": {
    "traits": ["proper"], "speechStyle": "…",          // descriptive (traits ≥ 1)
    "catchphrases": [], "quirks": [], "tells": [],     // optional
    "confidence": 0.4, "nervousness": 0.8, "arrogance": 0.3, "honesty": 0.4,
    "impulsiveness": 0.2, "empathy": 0.6, "aggression": 0.1   // all REQUIRED, 0–1
  },
  "goals": ["…"],                                      // ≥ 1
  "knownFactIds": ["loc-reginald-2030", "f-…"],       // facts or timeline ids THIS character knows
  "beliefs": [ { "id": "b1", "statement": "…", "aboutFactId": "…", "isAccurate": false, "confidence": 0.7 } ],
  "secrets": [
    {
      "id": "s-reginald-theft", "description": "…", "severity": "embarrassing | serious | damning",
      "revealConditions": {                            // optional; omit = never auto-revealed
        "stressThreshold": 70,                         // 0–100, and/or…
        "evidenceIds": ["burned-letter"],              // …evidence shown to this character, and/or…
        "testimonyIds": ["s-archibald-false-alibi"],   // …testimony cards (another character's secrets) presented to this character
        "mode": "any",                                 // "any" (default) or "all" of the listed conditions
        "afterSecretIds": []                           // own secrets that must be revealed first (ordering)
      },
      "relatedFactIds": [],
      "testimonySummary": "Reginald heard Mr Crane on the servants' telephone during the blackout.",
                                                       // optional, PUBLIC once revealed: the notebook's testimony card
      "coreGuilt": false                               // optional: true = the culprit's own guilt, NEVER revealed in interrogation (below)
    }
  ],
  "intendedLies": [                                    // optional authored cover stories
    { "id": "l-reginald-pantry", "topic": "whereabouts 21:10–21:20", "aboutFactId": "loc-reginald-2115",
      "claim": "I never left the pantry.",             // needs topic and/or aboutFactId
      "brokenByEvidenceIds": ["…"],                    // optional: clues that break it when shown to this character
      "breaksOnSecretIds": ["s-archibald-false-alibi"],// optional: testimony (anyone's revealed secret) presented to this character
      "breaksOnFactIds": ["ev-pantry-exchange"],       // optional: presenting a revealed secret whose relatedFactIds include this fact
      "breakMode": "any",                              // optional: "any" (default) one condition breaks it; "all" needs every listed one
      "supersededBySecretIds": ["s-reginald-cash"] }   // optional: this character's OWN secrets; confessing one retires the lie (same turn)
  ],
  "relationships": [                                   // directional; target = a character or the victim
    { "targetCharacterId": "lord-blackwood", "trust": 30, "fear": 60, "affection": 10,
      "resentment": 55, "suspicion": 20, "kind": "employer", "description": "optional flavour",
      "jabs": [ { "text": "one barb this character may throw at THIS person", "aboutFactId": "optional fact id the character must know", "when": "confrontation | any (default)" } ],  // optional
      "defensiveOn": [ { "topic": "what touches a nerve", "text": "how they bristle" } ] }                                                                                            // optional
  ],
  "initialEmotion": { "emotion": "calm", "intensity": 0.3, "composure": 0.9 },
  "portrait": "reginald"                               // optional; defaults to id
}
```

**Retiring a lie by confession (`supersededBySecretIds`).** A character who confesses a secret can't keep telling the story it contradicts (e.g. admitting "I was alone in the dining room" retires "Archibald and I were together"). List those secrets, which must be the lie owner's own (the validator rejects anyone else's), in `supersededBySecretIds`. When any of them is revealed, the lie counts as broken in that same turn, whatever the `breakMode`. The prompt then lists it under DROPPED STORIES and never as MAINTAIN THIS STORY, so the model is never told both to confess and to keep the lie. Retiring a lie adds no stress and doesn't trigger the contradiction beat, because no clue broke it.

**Core guilt (`coreGuilt: true`).** The culprit's own guilt (the killing, the weapon used on the victim, being at the scene at the murder minute, locking the door or taking the key) is never confessed before the accusation; a win needs evidence and testimony, and the confession lives only in `endings.json`. Mark those secrets `coreGuilt: true` and give them no `revealConditions` and no `testimonySummary` (the validator warns about either). The engine (`engine/core-guilt.ts`) also treats as core guilt, as defence in depth, any secret of the solution's murderer whose `relatedFactIds` include a fact covering the murder minute (`solution.time`) that involves the murderer or is at the murder scene. Core guilt is never in the revealable set (interrogation, evidence, testimony, confrontation, breakdown), never becomes a testimony card, and its `relatedFactIds` stay out of the owner's prompt even if another revealed secret lists them. A lie can still be broken by a clue or a card when its truth is core guilt: it shows as a contradiction, nothing is revealed, and the character stonewalls. Every reply is also checked after generation (`ai/guilt-check.ts`): a first-person admission of the killing (anyone), or from the culprit the weapon, the door/key or the scene at the murder minute, is rejected, retried once, then replaced by an in-character deflection. A bare motive admission ("I knew about the will and burned the letter") is not core guilt.

**One secret per exchange.** However many secrets are eligible, an exchange (a question, a presented clue or card, a breakdown, or both sides of a confrontation) reveals at most one: the lowest `severity` tier first (embarrassing, serious, damning), then authored order. The rest wait for later exchanges.

### Stress bands and breakdowns

Stress (0–100, engine-owned) falls into MASTER_PLAN §18 bands: calm 0–30, defensive 31–60, nervous 61–80, panicking 81–95, breakdown 96–100 (`engine/stress.ts`). The band is told to the model as behaviour, and it sets a floor on the pose: no serene faces when nervous, no composure when panicking. The first time a character's stress is 96 or more at the start of a turn, that turn is their **breakdown**, a scripted outburst. A breakdown is not a confession and unlocks nothing by itself; reveals still follow `revealConditions`. Once the breakdown has been performed, stress settles at 85.

The engine (`engine/secrets.ts` `shouldRevealSecret`) evaluates reveal conditions against the character's runtime state (stress, evidence shown, secrets already revealed). The model never decides a reveal.

### Testimony: lies broken by what others admit

When the engine reveals a secret, it joins the case-wide revealed set in the signed state and appears in the player's notebook as a **testimony card** (`testimonySummary`, or "<Name> admitted something under questioning." when it's missing). The player can **present** a card to any other suspect, exactly like a clue (`presentedTestimonyId`; the server checks that the secret is revealed in the signed state). Nobody learns of a confession by themselves: the player has to confront them with it.

Presenting testimony to a character breaks each of their lies whose conditions now hold (`engine/testimony.ts`):

- `brokenByEvidenceIds`: that clue has been shown to them;
- `breaksOnSecretIds`: that secret is revealed **and** has been presented to them;
- `breaksOnFactIds`: a presented testimony's secret lists that fact in its `relatedFactIds`.

With `breakMode: "any"` one condition is enough; with `"all"` every listed one must hold. Each newly broken lie adds the same stress as a lie-breaking clue (+15, capped at +30 per presentation); testimony that bears on a lie without breaking it yet adds +5; presenting it again adds +2. The model is told the lie is EXPOSED and hears only the public summary, never the other character's private secret text.

```jsonc
// characters/victoria.json: the "together all blackout" alibi cracks when Archibald's or Gregory's admission is put to her.
{ "id": "l-victoria-together", "topic": "whereabouts during the blackout", "aboutFactId": "ev-victoria-alone",
  "claim": "Archibald and I sat by the dining-room fire the whole blackout, darling.",
  "brokenByEvidenceIds": ["library-key", "burned-letter"],
  "breaksOnSecretIds": ["s-archibald-false-alibi", "s-gregory-saw-victoria"] }
```

### Knowledge gate

While a secret is locked or a lie unbroken, the character's context withholds the truth behind it (`engine/knowledge-gate.ts`), in three layers:

1. **Explicit** (`hiddenUntil` on a fact): withheld until a listed secret is unlocked for the knower or a listed lie is broken. Nothing else applies to that fact.
2. **Direct links** (both modes): an unbroken lie's `aboutFactId` and a locked own secret's `relatedFactIds`.
3. **Proximity heuristic** (`"knowledgeGate": "proximity"`, the default): the character's own time-bound facts that fall within a padded window around a protected time are withheld too. `"knowledgeGate": "explicit"` turns this off, so only layers 1 and 2 apply.

## solution.json (server-only)

```jsonc
{
  "murdererId": "victoria", "weaponId": "silver-candlestick", "locationId": "library", "time": "21:17",
  "motiveId": "inheritance",                        // one of case.json motives[].id
  "keyEvidenceIds": ["silver-candlestick", "…"],    // ≥ 1; the proof an accusation must cite
  "explanation": "optional reveal write-up"
}
```

The player's accusation is `{ murdererId, weaponId, motiveId, keyEvidenceIds }`.

## endings.json (server-only, optional for now)

```jsonc
{
  "correct": {
    "confession": [ Line, … ],        // the culprit cracks (≥ 1 line)
    "recap":      [ Line, … ]         // the detective / narrator explains (≥ 1 line)
  },
  "wrong": {                          // keyed by the ACCUSED suspect id; EVERY suspect needs an entry,
    "reginald": [ Line, … ],          // including the murderer ("right culprit, couldn't prove it")
    "victoria": [ Line, … ]
  },
  "escapedLine": "THE MURDERER ESCAPED!"
}
```

`Line = { "speaker": "<characterId>" | "narrator", "text": "…", "pauseMs"?: 0–5000, "emotion"?: Emotion, "evidenceIds"?: ["…"] }`

Endings spell out the solution, so they never reach the public view, the character context or the model.

**A loss must not confirm anything (one accusation per game).** The loss response carries no solution and no per-field right/wrong, so the engine plays a `wrong` ending only when it gives nothing away: the entry for the real murderer is never used (a generic "sent home for lack of proof" ending plays instead, so Victoria's "right lady, wrong story" is kept in the file but not shown), and in everyone else's `wrong` entry, lines **spoken by the real murderer** are dropped (a gloating killer cameo would name them). Write each innocent's entry so it works with no cameo from the killer, and note the player then sees `escapedLine` followed by "The case went unsolved."

## Progression (optional): gated rooms and clues, leads, the accuse gate

Every field below is optional and strict; a case that uses none of them plays exactly as before. Design: `docs/BLACKWOOD_PROGRESSION_PROPOSAL.md`. A worked example with every field is `tests/fixtures/progression/progress-light`.

**`Condition`** (anywhere a rule is needed; at least one atom; `mode` "all" by default): `interrogated: [{characterId, minExchanges?}]` (exchanges = `interrogationCount`, bumped by every committed turn, default 1), `evidenceIds` (discovered), `secretIds` (revealed anywhere in the case), `searchedLocationIds`, `leadIds` (the lead is open OR closed). Conditions only ever go false -> true and are checked against the state BEFORE an action, so one search never chains two unlocks.

```jsonc
// case.json: locations[]
{ "id": "dock", "requires": { "searchedLocationIds": ["galley"] }, "lockedLine": "The dock is roped off until you have seen the galley." }   // lockedLine <= 160, public; requires is private
// evidence.json (needs a locationId, not initiallyAvailable): hidden from searches until requires holds; lockedLine is appended to the search lines
{ "id": "wet-logbook", "locationId": "galley", "requires": { "leadIds": ["lead-galley"] }, "lockedLine": "Something in the galley is still hidden from you." }
// case.json
"leads": [ { "id": "lead-galley", "title": "<=70, public", "hint": "<=240, public, shown while open",
             "opensWhen": { "interrogated": [{ "characterId": "cook-marlow", "minExchanges": 2 }] },   // omit = open at start
             "closesWhen": { "evidenceIds": ["wet-logbook"] },                                          // required; closed wins over open
             "closedLine": "optional, <= 160" } ],
"accuseGate": { "minEvidence": 3, "minSuspectsQuestioned": { "count": 2, "minExchanges": 2 }, "minRevealedSecrets": 2, "closedLeadIds": ["lead-spyglass"],
                "lockedLines": { "evidence": "...", "suspects": "...", "secrets": "...", "leads": "...", "default": "required, <= 160 each" } }   // omit = a single clue is enough
// solution.json
{ "minKeyEvidence": 2, "keyTestimonyIds": ["marlow-saw-quill"], "minKeyTestimony": 1 }   // defaults 1, [], 0
```

Engine behaviour: a locked room answers with its `lockedLine` and is not marked searched; `/api/accuse` recomputes the gate from the signed token and answers **403 `accuse_locked`** with the line of the first unmet item (clues, suspects, secrets, leads; the token is unchanged, the one accusation is not spent); cited `keyTestimonyIds` must be revealed (`testimony_not_revealed`); a win needs the right murderer, weapon and motive plus `minKeyEvidence` key clues and `minKeyTestimony` key testimony. Every route that returns a `stateToken` also returns `progress` (`leads` that are open/closed, `newLeadIds` = changed in this action, `lockedLocationIds`, `accuse: {unlocked, checklist {clues,suspects,secrets: {have,need}}, line?, citeTestimony}`); counts only, never which clue, who or why. A lead whose `closesWhen` holds before its `opensWhen` ever did (e.g. a hall search finds the clue first) still counts as closed for the gate and for `leadIds` atoms, but is never shown or announced: it stays out of `progress.leads` until its `opensWhen` holds (then it appears already solved, without a toast), and `newLeadIds` only carries hidden→open and open→closed. `requires`, `opensWhen`, `closesWhen` and `accuseGate` never leave the server.

`validate:case` for these fields: errors for unresolved ids, an empty condition, duplicate lead ids, a room or clue that requires itself, a lead cycle, `requires` on a clue with no room or an initially available clue, key testimony that is not a secret with a `testimonySummary`, `minKeyTestimony`/`minKeyEvidence` above their lists, and the **reachability simulation** (everyone can be questioned without limit, any clue in hand can be shown to anyone, secrets reveal by clues, testimony cards held and `afterSecretIds` only, stress-only counts as unreachable, core guilt never reveals): any room, clue, the gate, the key clues or key testimony that can never be reached is an error. Warnings: a lead that never opens or closes, `accuseGate.minEvidence < 2`, a gated clue or room without a `lockedLine`. It prints the fastest legal path in actions (exact, breadth-first).

## What the AI and the player can see

- **The player** (`getPublicCaseView`) sees:
  - the case id, title, tagline and intro;
  - the victim;
  - the locations (including `searchFlavor` and `background`) and the case `backdrops`;
  - the motive **options**;
  - each suspect's name, role, bio, portrait and starting emotion;
  - the evidence discovered so far (name, description, kind, location, image, `discoveryLine`);
  - testimony cards for revealed secrets (who, plus `testimonySummary`), returned by `/api/interrogate`.

  Everything else (including `endings.json`) is stripped.
- **The AI** (`buildCharacterContext`) sees one character at a time:
  - their persona (including personality scores), goals and relationships;
  - their own known facts, with source and confidence;
  - their beliefs, without `isAccurate`;
  - only the secrets the engine has already revealed (truth plus permission to talk about them); locked secrets are withheld entirely;
  - their own intended lies (topic and claim, plus `maintain` / `exposed` status). While a lie is unbroken or a secret locked, the facts behind it, the character's own timeline entries in that time window and beliefs about them are withheld (`engine/knowledge-gate.ts`), so link every fact that would give the game away via `aboutFactId` / `relatedFactIds`;
  - their stress and trust, memory and statements;
  - the discovered evidence the player has shown them;
  - the public summaries of testimony the player has confronted them with.

  The AI never sees the solution, the endings, the motive, the timeline as a whole, other characters' private data, or undiscovered evidence. A murderer knows their guilt only through their own `knownFactIds`.

## Checks `validate:case` runs

1. Each file parses as JSON and matches its schema (strict keys, ids, times, ranges; each timeline entry is a point or a window).
2. The folder name matches `id`, each character id matches its file name, and there are at least 2 characters.
3. No duplicate ids: locations, motives, evidence, facts + timeline entries (shared namespace), characters, and each character's beliefs, secrets and lies.
4. References resolve:
   - locations used by the victim, facts, timeline and evidence;
   - people (characters or the victim) used by `involvesCharacterIds`, `relatedCharacters` and `targetCharacterId`;
   - facts used by `knownFactIds`, beliefs, secrets, lies and evidence;
   - evidence used by reveal conditions, `brokenByEvidenceIds` and `keyEvidenceIds`;
   - own secrets used by `afterSecretIds`;
   - any character's secrets used by `breaksOnSecretIds` and `hiddenUntil.secretIds`; facts used by `breaksOnFactIds`;
   - lies used by `hiddenUntil.lieIds` (must exist and be unique across characters);
   - `motiveId` → `motives`.
5. Windows (timeline entries and facts) have `from ≤ to` in game-day order.
6. The solution resolves: the murderer is a character, the weapon is evidence, the location exists, the motive exists, and every key evidence id exists.
7. **Opportunity rule** (`OPPORTUNITY_WINDOW_MINUTES = 15`): at least one timeline entry must have `locationId == solution.locationId` and list the murderer in `involvesCharacterIds`, placing them there within 15 minutes of `solution.time`.
   - Point entries: `|time − murder time| ≤ 15`.
   - Window entries: `from − 15 ≤ murder time ≤ to + 15`.
8. Every innocent character has at least one secret.
9. `endings.json` (if present): every `speaker` is a character id or `"narrator"`, every `evidenceIds` entry is evidence, every `wrong` key is a suspect, and `wrong` covers **every** suspect including the murderer.

`validate:case` also warns (without failing) about:

- evidence that has no `locationId` and is not `initiallyAvailable` (the player could never find it);
- lies that can never break (every condition unreachable: clues not findable, secrets with no reachable `revealConditions`, facts in no revealable secret's `relatedFactIds`);
- self-referential testimony (a lie that breaks on its owner's own secret, or on a fact that only the owner's secrets carry);
- reveal-order cycles in `afterSecretIds`;
- secrets used as testimony without a `testimonySummary`;
- `hiddenUntil` on a fact nobody knows, or pointing at a secret that can never be revealed;
- `"knowledgeGate": "explicit"` with no `hiddenUntil` anywhere.
