# Case file format (contract v2)

The case-file contract is the single source of truth for authored cases. It is defined in `engine/case-schema.ts`, `engine/types.ts` and `engine/solution.ts`. Check your work with:

```bash
npm run validate:case -- blackwood
npm run validate:case -- fixture-manor --cases-dir tests/fixtures/cases   # a folder outside cases/
```

The validator lists every problem as `file -> path: message` and exits non-zero if there are any.

Working examples:

- `tests/fixtures/cases/fixture-manor/`: shows every feature, including point and window timeline entries, lies and reveal conditions.
- `cases/_placeholder/`: a small stand-in case kept for development. The running game uses `blackwood`; switch cases by changing `ACTIVE_CASE_ID` in `engine/active-case.ts`.

## Layout

```
cases/<caseId>/
  case.json              envelope: id, title, tagline, intro, victim, locations, facts, motives
  timeline.json          TimelineEntry[]  (point-in-time or window facts that place people)
  evidence.json          Evidence[]
  characters/<id>.json   one per interrogable character (file name == id)
  solution.json          murderer / weapon / location / time / motive / key evidence. SERVER-ONLY.
  docs/…                 optional, ignored by the loader
```

## Conventions

- **Ids** use lowercase kebab or snake case: `^[a-z0-9]+([-_][a-z0-9]+)*$`, max 64 characters.
  - Ids must be unique within their kind.
  - Facts (`case.json` `facts`) and timeline entries share one id namespace, so characters can list either in `knownFactIds`.
  - Character ids should match the art ids (`reginald`, `victoria`, `archibald`, `gregory`). The portrait is loaded from `assets/characters/<portrait ?? id>/<pose>.webp`.
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
  "victim": {                           // PUBLIC
    "id": "lord-blackwood", "name": "…", "description": "…",
    "foundAtLocationId": "library", "foundAt": "22:10", "causeOfDeath": "…"
  },
  "locations": [ { "id": "library", "name": "The Library", "description": "…" } ],
  "facts": [ /* Fact[]: world truths not pinned to the timeline (see Fact) */ ],
  "motives": [                          // PUBLIC multiple-choice options for the accusation (≥ 2; include red herrings)
    { "id": "inheritance", "label": "The new will", "description": "optional" }
  ]
}
```

### Fact

```jsonc
{
  "id": "f-library-single-key",
  "statement": "The library door has a single key.",
  "category": "timeline | location | relationship | object | motive | alibi | background",
  "time": "21:00",                      // optional
  "locationId": "library",              // optional
  "involvesCharacterIds": ["…"],        // optional; characters or the victim
  "source": "witnessed | heard | told | inferred | canonical",   // optional, default "canonical"
  "confidence": 0.8                     // optional 0–1, default 1
}
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
    "locationId": "library",            // optional
    "relatedFactIds": ["…"],            // optional; facts or timeline ids (engine use only)
    "relatedCharacters": ["victoria"],  // optional; characters or the victim (engine use only)
    "initiallyAvailable": true,         // true = the player starts with it
    "image": "silver-candlestick"       // optional asset key
  }
]
```

## characters/&lt;id&gt;.json

```jsonc
{
  "id": "reginald", "name": "Reginald", "role": "The Butler", "bio": "Public card text.",
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
        "evidenceIds": ["burned-letter"],              // …evidence shown to this character
        "mode": "any",                                 // "any" (default) or "all" of the listed conditions
        "afterSecretIds": []                           // own secrets that must be revealed first (ordering)
      },
      "relatedFactIds": []
    }
  ],
  "intendedLies": [                                    // optional authored cover stories
    { "id": "l-reginald-pantry", "topic": "whereabouts 21:10–21:20", "aboutFactId": "loc-reginald-2115",
      "claim": "I never left the pantry.", "brokenByEvidenceIds": ["…"] }   // needs topic and/or aboutFactId
  ],
  "relationships": [                                   // directional; target = a character or the victim
    { "targetCharacterId": "lord-blackwood", "trust": 30, "fear": 60, "affection": 10,
      "resentment": 55, "suspicion": 20, "kind": "employer", "description": "optional flavour" }
  ],
  "initialEmotion": { "emotion": "calm", "intensity": 0.3, "composure": 0.9 },
  "portrait": "reginald"                               // optional; defaults to id
}
```

The engine (`engine/secrets.ts` `shouldRevealSecret`) evaluates reveal conditions against the character's runtime state (stress, evidence shown, secrets already revealed). The model never decides a reveal.

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

## What the AI and the player can see

- **The player** (`getPublicCaseView`) sees:
  - the case id, title, tagline and intro;
  - the victim;
  - the locations;
  - the motive **options**;
  - each suspect's name, role, bio, portrait and starting emotion;
  - the evidence discovered so far (name, description, kind, location, image).

  Everything else is stripped.
- **The AI** (`buildCharacterContext`) sees one character at a time:
  - their persona (including personality scores), goals and relationships;
  - their own known facts, with source and confidence;
  - their beliefs, without `isAccurate`;
  - their secrets, without reveal conditions;
  - their own intended lies (topic and claim only);
  - their stress and trust, memory and statements;
  - the discovered evidence the player has shown them.

  The AI never sees the solution, the motive, the timeline as a whole, other characters' private data, or undiscovered evidence. A murderer knows their guilt only through their own `knownFactIds`.

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
   - `motiveId` → `motives`.
5. Windows have `from ≤ to` in game-day order.
6. The solution resolves: the murderer is a character, the weapon is evidence, the location exists, the motive exists, and every key evidence id exists.
7. **Opportunity rule** (`OPPORTUNITY_WINDOW_MINUTES = 15`): at least one timeline entry must have `locationId == solution.locationId` and list the murderer in `involvesCharacterIds`, placing them there within 15 minutes of `solution.time`.
   - Point entries: `|time − murder time| ≤ 15`.
   - Window entries: `from − 15 ≤ murder time ≤ to + 15`.
8. Every innocent character has at least one secret.
