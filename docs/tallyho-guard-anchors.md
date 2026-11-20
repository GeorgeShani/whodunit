# Tallyho output-guard anchors

Author data for the optional server-only `guard` block on `case.json` (issues #90 and #91). The field shape is Dexter’s: an optional `guard` object with `aliveUntil` and `gatedTopics`, Zod-validated, never copied into the public case view.

**Status (this PR):** Dexter’s schema is on `origin/release/tallyho` (`276058d`). This PR fills `cases/tallyho/case.json` `guard` (`aliveUntil`, `gatedTopics`), adds a #90 `forbiddenPhrases` net on all six suspects, and keeps this document as the author map. Sidecar: `/workspace/tallyho-gen/guard.py` (wired in `gen.py`) and `timeline_guards()` in `chars_a.py`.

`until` is `22:14` (the Great Lurch, the public time-of-death proof). That is **at or after** `solution.time` (`21:52`, the true death), which is what the schema requires. The lurch is also listed as an `anchors` event.

## Reveal condition ids

| Role | Id | Notes |
| --- | --- | --- |
| True time of death | `solution.time` = `21:52` | Fact `ev-bonk`. Location `cabin-deck`. Murderer Zippelli; helper Bilge (bridge act at 22:38). |
| Public proof he was already dead | `22:14` port lurch | Facts `ev-great-lurch`, `ev-chart-flip`, `f-list-history`. The marmalade set towards the starboard wall, then the chest ran to port at the lurch and stopped on his coat-tail: he was already lying there. |
| Proof evidence | `marmalade-run`, `heel-chart` | `heel-chart` is `featureConfig.ship-list.flipShownBy`. |
| Time-misdirection proof | `featureProof.time-misdirection.provedBy` | `marmalade-run`, `cheer-cylinder`. Staged clocks: 22:38 (cheer / “alive”) and 22:41 (smashed watch / “death”). Evidence `smashed-watch`, `cheer-cylinder`. |
| Heel-chart discovery (gated topic) | evidence `heel-chart` | Lift `gatedTopics` when `discoveredEvidenceIds` includes `heel-chart`, or the card is shown / presented to the speaker. |
| Related, not the lift itself | secret `s-ottilie-bridge-visits` | `revealConditions.evidenceIds: ["heel-chart"]`. |
| Related, not the lift itself | lie `l-ottilie-engine` | `brokenByEvidenceIds: ["heel-chart"]` (Ottilie only). |

Ship-list canon (for anchors, not a speaking unlock): level 0° from 19:30, starboard 8° from 21:40, port 6° from 22:14.

## `guard.aliveUntil`

Maps 1:1 onto the schema.

| Field | Tallyho value |
| --- | --- |
| `victimId` | `commodore-brine` (must equal `victim.id`) |
| `aliases` | Spoken names beyond `victim.name` / `victim.aliases`. See the block below. Includes Bilge’s “Owner” and Percy’s “Uncle”. |
| `until` | `22:14` (the lurch; must be at or after `solution.time` `21:52`) |
| `anchors` | Events **at or after** `until`. Each row has an optional fact/timeline `id` plus `terms`. |
| `alivePhrases` | Alive or interaction vocabulary. **“heard him” / “heard his” are alive phrases, not appearance words.** Bare `heard` is not an appearance phrase: “I heard him after the lurch” is the leak. |
| `pronouns` | `he`, `him`, `his` — only when no other character’s name or alias is in the sentence. |
| `appearancePhrases` | Words that frame a time as what an object showed. Do **not** include bare `heard` (even though `time-misdirection.appearanceWords` currently does). The engine should prefer this list over a blanket “heard” exemption, or “I heard him after the lurch” will slip through. `time-misdirection.appearanceWords` are still consulted for staged-clock lines. |
| `afterPhrases` | Non-clock phrases meaning a time after `until`. |

### Anchor terms (vague time words that mean after 22:14 / after `until`)

Tied to ids where they exist:

- `ev-great-lurch`: the Great Lurch, the great lurch, the lurch, Great Lurch
- `f-list-history` / the 22:14 flip: listed to port, list to port, listed to port, rolled to port, heeled to port, leaned to port, went over to port, swung over, the list changed, the ship swung over, she rolled to port
- Clock wordings after the cutoff (engine `extractTimes` should already parse these against `until`; listed so the phrase layer and after-the-lurch checks stay aligned): after quarter past ten, after ten past ten, after twenty past ten, after half past ten, after half ten, after ten fifteen, after 10:15 / 10.15, after 22:14 and later clock forms

`afterPhrases` covers non-clock leftovers: later that night, later that evening, later in the night, afterwards that night.

### Victim names and nicknames

From `victim.name` / `victim.aliases` (engine already matches these): Commodore Barnabas "Barnacle" Brine; the Commodore; Barnacle; Barnabas; Uncle Barnabas; the Old Man; the Marmalade King.

Extra `aliases` to author: Commodore; Old Man; Uncle; the Owner; Owner; Commodore Brine; Commodore Barnabas; Barnabas Brine; the Marmalade King (if not already pulled from victim.aliases).

### Alive / interaction verbs

alive; still alive; was alive; were alive; been alive; living; living and breathing; still breathing; still with us; up and about; had a word; spoke; spoken; spoke to me; talked; talked to; talked with; called out; chatted; chatted with; conversed; saw; seen; spotted; met; ran into; bumped into; heard him; heard his; heard his voice; his voice; he told me; he said; cheered; bellowed; bellowing.

### Appearance (do not treat as placing him alive)

watch; clock; dial; hands; crown; read; reads; says (on a watch/clock); said (on a watch/clock); stopped; showed; programme; horn; horns; Voice-Horn; bellow; sounded; cylinder; Cheer-Box; trumpet (as the object carrying a recording). Not: bare `heard`, `heard him`, `I heard him myself`.

## `guard.gatedTopics`

One topic: the heel recorder / its chart, locked until `heel-chart` is found or shown.

| Field | Tallyho value |
| --- | --- |
| `unlockedBy` | `heel-chart` |
| `terms` | Literal instrument names and close hyphenation. Not a lone `heel` (that would catch “she heeled to starboard”). Everyday list / lurch talk stays open. |
| `patterns` | Optional regexes for the same vocabulary (spaces or hyphens). |

Ordinary list talk that must stay allowed before the chart is found (issue #91): “The ship listed to starboard after the squall, then to port after the lurch.”; “From 21:40 she leaned starboard, and at 22:14 she went over to port.”; “The Tallyho has been listing to port since the Great Lurch.”; “The list changed at 22:14, from starboard to port.”; “I reported the list to the Captain.”

## Beliefs and lines that must pass

Do not gag a line that matches a speaker’s current belief or knowledge, or a clearly appearance-framed staged clock.

| Speaker | Line | Why it must pass |
| --- | --- | --- |
| Bilge | “The Old Man's watch says 22:41, and a watch does not lie. That settles the hour.” | Belief `b-bilge-watch`. Appearance-framed watch reading, not an alive-after-the-lurch claim. |
| Percy | “Uncle was alive at 22:38. I heard him cheer the shark myself, so whoever it was came after.” | Belief `b-percy-alive`. Mistaken, but tied to the staged cheer. |
| Boris | “The galley horn cheered at the shark, so the Commodore was alive long after ten. Wasn't he?” | Belief `b-boris-alive`. Horn-framed misdirection. |
| Gherkina | “Barnabas was sulking behind his door, and the corridor horn simply carried his trumpet from wherever he was bellowing.” | Belief `b-gherkina-sulking`. Horn-framed; she does not claim she met him after the lurch. |
| Bilge (lie `l-bilge-owner-cheer`) | “The Commodore cheered the shark himself, from his stateroom trumpet, same as every Gala. I heard it with my own ears.” | Approved cover story for the 22:38 cheer, appearance-framed. |
| Zippelli (lie `l-zippelli-alive`) | “Zippelli left him alive and grumpy at ten to ten, then went straight back to the greenroom. He cheered at the shark, didn't he? Ask anyone.” | 21:50 is before `until`. The cheer clause is the staged misdirection. |
| Any | “The horn sounded at 22:38. I thought he was alive.” | Appearance-framed; “I thought” is not a fact claim. |
| Any | “The Voice-Horn bellowed his cheer at twenty-two minutes to eleven.” | Appearance-framed staged cheer. |
| Any | Plain talk about the lurch or the list, with no victim-alive/interaction claim (see list lines above). |

Innocents may voice the mistaken 22:38 belief **when it is clearly the horn, watch, or cheer**. They must not state as fact that he was alive after the lurch or after the ship listed to port: that undercuts the 22:14 proof, even if they sincerely believe the staging.

## Phrase layer also shipping in this PR

Per-character `forbiddenPhrases` on all six suspects, **#90 only** (always-on; no `unlessRevealed`, `unlessBroken`, or `unlessShown` — Tallyho retired shown-clue stand-ins, and `unlessRevealed` only names secrets).

- **#90:** a sentence that pairs a victim name/pronoun, an alive/interaction verb, and a post-lurch / late-clock anchor is forbidden, unless the sentence contains a staged-object word (`horn`, `Voice-Horn`, `watch`, `clock`, `cylinder`, `Cheer-Box`, `programme`). This stays always-on: the claim is never legitimate as fact. The engine `aliveUntil` check is the root net (clocks, after-phrases, anchors, beliefs).
- **#91:** not a `forbiddenPhrases` entry. Citing the heel recorder is `guard.gatedTopics`, unlocked by `heel-chart` when the clue is found or shown, so the line is allowed after the reveal. Everyday list / lurch talk stays open. Terms are specific (`heel recorder`, `heel chart`); never a lone `heel` (that would catch “she heeled to starboard”).

Sidecar: `/workspace/tallyho-gen/chars_a.py` (`timeline_guards()`) and `/workspace/tallyho-gen/guard.py` (wired in `gen.py`). The generator still writes `case.id` as `_tallyho` and must not be copied over `cases/tallyho/case.json` blindly.

## `case.json` block

This is the block now in `cases/tallyho/case.json` (and in `/workspace/tallyho-gen/guard.py`).

```json
{
  "guard": {
    "aliveUntil": {
      "victimId": "commodore-brine",
      "aliases": [
        "the Commodore",
        "Commodore",
        "Commodore Brine",
        "Commodore Barnabas",
        "Barnacle",
        "Barnabas",
        "Barnabas Brine",
        "Uncle Barnabas",
        "Uncle",
        "the Old Man",
        "Old Man",
        "the Marmalade King",
        "the Owner",
        "Owner"
      ],
      "until": "22:14",
      "anchors": [
        {
          "id": "ev-great-lurch",
          "terms": ["the Great Lurch", "the great lurch", "the lurch", "Great Lurch"]
        },
        {
          "id": "f-list-history",
          "terms": [
            "listed to port",
            "list to port",
            "rolled to port",
            "heeled to port",
            "leaned to port",
            "went over to port",
            "the ship swung over",
            "swung over",
            "the list changed",
            "she rolled to port"
          ]
        }
      ],
      "alivePhrases": [
        "alive",
        "still alive",
        "was alive",
        "were alive",
        "been alive",
        "living",
        "living and breathing",
        "still breathing",
        "still with us",
        "up and about",
        "had a word",
        "spoke",
        "spoken",
        "talked",
        "called out",
        "chatted",
        "conversed",
        "saw",
        "seen",
        "spotted",
        "met",
        "ran into",
        "bumped into",
        "heard him",
        "heard his",
        "heard his voice",
        "his voice",
        "he told me",
        "he said",
        "cheered",
        "bellowed",
        "bellowing"
      ],
      "pronouns": ["he", "him", "his"],
      "appearancePhrases": [
        "watch",
        "clock",
        "dial",
        "hands",
        "crown",
        "read",
        "reads",
        "programme",
        "horn",
        "horns",
        "Voice-Horn",
        "bellow",
        "sounded",
        "cylinder",
        "Cheer-Box",
        "trumpet"
      ],
      "afterPhrases": ["later that night", "later that evening", "later in the night", "afterwards that night"]
    },
    "gatedTopics": [
      {
        "unlockedBy": "heel-chart",
        "terms": [
          "heel recorder",
          "heel-recorder",
          "heel chart",
          "heel-chart",
          "heel log",
          "heel-log",
          "heel strip",
          "heel-strip",
          "inclinometer",
          "clinometer",
          "angle of heel",
          "angle-of-heel",
          "recorder reading"
        ],
        "patterns": [
          "heel[-\\s]?recorders?",
          "heel[-\\s]?charts?",
          "heel[-\\s]?(?:logs?|strips?)",
          "inclinometers?",
          "clinometers?",
          "angle[-\\s]of[-\\s]heel"
        ]
      }
    ]
  }
}
```

## Paraphrases the phrase mechanism still lets through (engine request)

These should be blocked by `aliveUntil` / `gatedTopics` once the engine ships. The current `forbiddenPhrases` regex does not catch them. Do not treat this as a pass to ship.

**#90 — still alive after the cutoff, in wording the phrase list misses:**

- Split across two sentences: “The ship lurched to port. He was still alive.”
- “Post-lurch, the Old Man was chatty.”
- “Following the roll I bumped into the Commodore.”
- “Once she'd gone over to port I chatted with Barnacle.”
- “He was fine when we took the port list.”
- “Still kicking after we heeled the other way.”
- “I toasted with him once the floor sloped port.”
- “Alive subsequent to the plunge of the deck.”
- “After downhill became the port side, I ran into him.”
- “Later than the lurch I saw him.”
- “Come ten-fifteen he was still going.”
- “When she took her port list I heard his laugh.”
- “He waved from the corridor once we rolled.”
- “I passed the time of day with the Owner after the bump.”
- “He answered me after the tilt changed.”
- “The Commodore survived the lurch.”
- “The lurch didn't kill him; I spoke to him later.”
- “after she heeled port” (no “to”), “after the lurching”, “alive past the lurch”

**#91 — citing the instrument without the locked terms:**

- “The instrument in the engine room shows she flipped at 22:14.”
- “Ottilie penciled LURCH 22:14 on the strip.” (bare “strip”, no “heel”)
- “The paper tick in the engine room recorded the flip.”
- “Gladys's lean-log shows 8 degrees then 6.”
- “The engine-room graph shows starboard then port.”
- “The list recorder in the pump house.”
- “the inclinograph”
- “the lean gauge”
- “The recorder in the engine room shows 6 degrees port.”

A root engine check (victim + alive/interaction + time/anchor after `until`; instrument terms until `heel-chart` is found) is the right fix for these leftovers. The phrase list is the data layer, not a complete paraphrase net.
