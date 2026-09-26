# Case file format

A case lives in `cases/<caseId>/`, and the loader validates it against the Zod schemas in `engine/types.ts`, `engine/case-schema.ts` and `engine/solution.ts`. Check your work with:

```bash
npm run validate:case -- blackwood
# or a folder outside cases/:
npm run validate:case -- fixture-manor --cases-dir tests/fixtures/cases
```

The validator lists every problem it finds as `file -> path: message` and exits non-zero if there are any.

Working examples:

- `tests/fixtures/cases/fixture-manor/`: a tiny test case.
- `cases/_placeholder/`: the stand-in case the running game uses. Switch cases by changing `ACTIVE_CASE_ID` in `engine/active-case.ts`.

## Layout

```
cases/<caseId>/
  case.json              meta, victim, locations, facts, timeline, evidence
  characters/<id>.json   one file per interrogable character (the file name must equal the id)
  solution.json          murderer / weapon / location / time. SERVER-ONLY.
```

## Conventions

- **Ids** (characters, locations, facts, evidence, timeline entries, beliefs, secrets) use lowercase kebab or snake case, e.g. `lady-blackwood` or `muddy_boots`. Pattern: `^[a-z0-9]+([-_][a-z0-9]+)*$`, max 64 characters.
  - Character ids should match the art ids (`reginald`, `victoria`, `archibald`, `gregory`). The portrait is loaded from `assets/characters/<portrait ?? id>/<pose>.webp`.
  - Ids must be unique within their kind. The victim's id must not match any character's id.
- **Case id** = the folder name. `meta.id` must equal it. A leading `_` marks internal cases.
- **Times** use a 24-hour `"HH:MM"` clock.
  - A case covers one "game day" that starts at `meta.dayStartsAt` (default `"12:00"`).
  - Any time earlier than `dayStartsAt` counts as after midnight, so `"23:50"` → `"00:20"` stays in order.
- **Strict keys:** misspelled or unknown keys are errors. Fields marked optional can be left out. List fields that default to `[]` can be left out too.
- **Emotions** (`emotion` fields) must be one of: `calm nervous defensive angry sad scared smug amused flustered suspicious shocked panicked relieved`.

## case.json

```jsonc
{
  "meta": {
    "id": "blackwood",                 // = folder name
    "title": "…", "tagline": "…",
    "intro": "Paragraph one.\n\nParagraph two.",   // shown before suspect selection
    "dayStartsAt": "12:00"             // optional
  },
  "victim": {                          // not interrogable; everything here is PUBLIC
    "id": "lord-blackwood", "name": "…", "description": "…",
    "foundAtLocationId": "library",    // where the body was found (can differ from the murder location)
    "foundAt": "22:10",
    "causeOfDeath": "…"                // what the player is told
  },
  "locations": [ { "id": "library", "name": "The Library", "description": "…" } ],
  "facts": [                           // objective truths the engine owns
    {
      "id": "reginald-in-pantry",
      "statement": "Reginald was polishing silver in the pantry.",
      "category": "timeline | location | relationship | object | motive | alibi | background",
      "time": "21:00",                 // optional
      "locationId": "pantry",          // optional
      "involvesCharacterIds": ["reginald"]   // optional; characters or the victim
    }
  ],
  "timeline": [                        // ground-truth whereabouts (never shown to the player or the AI)
    { "id": "t1", "characterId": "reginald", "locationId": "pantry",
      "from": "20:30", "to": "21:15", "factId": "reginald-in-pantry" }   // factId is optional
  ],
  "evidence": [
    {
      "id": "muddy-boots", "name": "Muddy Boots", "description": "…",
      "kind": "physical | document | testimony | observation",
      "locationId": "garden",          // optional
      "relatedFactIds": ["…"],         // optional; engine use only
      "initiallyAvailable": false,     // true = the player starts with it
      "image": "muddy-boots"           // optional asset key
    }
  ]
}
```

## characters/&lt;id&gt;.json

```jsonc
{
  "id": "reginald", "name": "Reginald", "role": "The Butler",
  "bio": "Public bio shown on the suspect card.",
  "personality": {
    "traits": ["proper", "nervous"],   // at least 1
    "speechStyle": "…",
    "catchphrases": [], "quirks": [], "tells": []   // optional
  },
  "goals": ["Protect the family's reputation"],     // at least 1
  "knownFactIds": ["reginald-in-pantry"],           // facts THIS character knows are true
  "beliefs": [                                      // what they believe; may be wrong
    { "id": "b1", "statement": "…", "aboutFactId": "…", "isAccurate": false, "confidence": 0.7 }
  ],
  "secrets": [
    { "id": "s1", "description": "…", "severity": "embarrassing | serious | damning",
      "pressuredByEvidenceIds": ["muddy-boots"],    // evidence that puts pressure on this secret
      "relatedFactIds": [] }
  ],
  "relationships": [                                // one-directional; a character or the victim
    { "characterId": "victoria", "kind": "employer", "sentiment": 0.4, "description": "…" }
  ],
  "initialEmotion": { "emotion": "calm", "intensity": 0.3, "composure": 0.9 },
  "portrait": "reginald"                            // optional; defaults to id
}
```

The AI only ever sees one character at a time: their persona, their own facts, beliefs, secrets, goals and relationships, plus the evidence the player has shown them.

- **Truth labels are hidden:** the AI never sees `isAccurate` or `pressuredByEvidenceIds`.
- **Guilty knowledge comes from facts:** there is no murderer flag. The murderer "knows" they did it only because their `knownFactIds` include the facts that say so.

## solution.json (server-only)

```json
{ "murdererId": "…", "weaponId": "<evidence id>", "locationId": "<location id>", "time": "21:45" }
```

## Checks `validate:case` runs

1. Every file parses as JSON and passes its schema (strict keys, valid ids and times, value ranges).
2. The folder name matches `meta.id`, each character's `id` matches its file name, and there are at least 2 characters.
3. No duplicate ids.
4. Every reference resolves:
   - locations used by the victim, facts, timeline and evidence;
   - characters used by facts, the timeline and relationships (the victim's id is allowed in facts and relationships);
   - facts used by `knownFactIds`, beliefs, secrets, evidence and timeline `factId`;
   - evidence used by secrets.
5. Timeline entries have `from ≤ to`, in game-day order.
6. The solution resolves: the murderer is a character, the weapon is an evidence id, and the location exists.
7. **Opportunity rule:** at least one timeline entry must place the murderer at `solution.locationId`, and that entry's window, extended by 15 minutes on each side (`OPPORTUNITY_WINDOW_MINUTES` in `engine/case-validation.ts`), must include `solution.time`.
   - Example: a murder at 21:45 in the library passes with `{ "characterId": "<murderer>", "locationId": "library", "from": "21:00", "to": "21:30" }`, because 21:30 + 15 minutes = 21:45.
8. Every innocent character has at least one secret.
