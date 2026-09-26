# Case 001 · Murder at Blackwood Manor: Solution Proof

> **SPOILERS / SERVER-SIDE DESIGN DOC.** This file explains the answer. Do not ship it to the client or feed it to the LLM.

IDs in `code` refer to the case data: `ev-*` / `loc-*` facts live in `timeline.json`, `f-*` facts in `case.json`, and evidence ids in `evidence.json`. Every deduction step below cites at least one of them.

## 1. The answer

| | |
|---|---|
| **Who** | `victoria`, Lady Victoria Blackwood |
| **How** | One blow to the head with the `silver-candlestick` that Reginald had set, lit, on the library desk at 21:12 (`ev-candlestick-delivered`, `ev-murder`) |
| **Where** | `library` |
| **When** | 21:17 |
| **Why** | Inheritance. The new will, to be signed at 10:00 the next morning, cut her to £200 a year (`f-new-will`, `f-inheritance-motive`) |

Server-only truth (`solution.json`): `murdererId: "victoria"`, `weaponId: "silver-candlestick"`, `locationId: "library"`, `time: "21:17"`, `motiveId: "inheritance"`, `keyEvidenceIds: ["library-key", "burned-letter"]`, plus a short `explanation` for the reveal screen. The player picks the motive from four public options in `case.json` `motives`: `inheritance` (true), and the red herrings `business-ruin` (Archibald), `stolen-money` (Reginald) and `revenge` (Gregory). The key evidence is the key (locked from outside and carried to the dining room) plus the letter (motive, burned in the dining room). The weapon is already cited through `weaponId`.

## 2. What happened (canonical timeline, condensed)

| Time | Event |
|---|---|
| 20:30 | Dinner ends in the dining room (`ev-dinner-ends`). |
| 20:40 | Lord Blackwood exposes Archibald's embezzlement and gives him until midnight. Archibald: *"Expose me, Edmund, and you won't live to see your auditors!"* Victoria and Reginald hear it (`ev-archibald-threat`). |
| 20:45 | The Lord locks himself in the library, key in the lock on the inside, as always (`ev-lord-locks-in`, `f-lord-key-habit`). |
| 20:50–20:57 | Victoria argues with him in the library over the new will; he waves the solicitor's letter (`ev-victoria-argument`). At **20:54** Reginald sees part of it through the ajar door (`ev-reginald-overhears`). |
| 20:58 | Reginald serves coffee. The Lord is alive and re-locks the door (`ev-reginald-serves-coffee`). |
| **21:10** | **Lightning takes out the power. Blackout** (`ev-blackout`). |
| 21:11 | In the dining room Reginald lights the pair of silver candlesticks and carries one off for the Lord. Victoria and Archibald watch (`ev-candlesticks-lit`). |
| 21:12 | Reginald sets the lit candlestick with a **fresh candle** on the library desk. The Lord is alive, the letter lies open, and he orders "coal at half past" (`ev-candlestick-delivered`). |
| 21:13 | Reginald hears the Lord re-lock the door behind him (`ev-lord-relocks`). Archibald leaves the dining room "to find the brandy" (`ev-archibald-leaves-dining`). |
| 21:14 | Victoria is alone in the dining room (`ev-victoria-alone`). Reginald shuts himself in his pantry. |
| 21:15 | Archibald is on the servants' telephone to his broker until 21:20 (`ev-archibald-phone`). Reginald hears him (`ev-reginald-hears-phone`), and Archibald sees candlelight under the pantry door and hears coins (`ev-archibald-notices-pantry`). **Victoria knocks and the Lord lets her in**, leaving the key in the lock (`ev-victoria-admitted`). |
| 21:16 | Gregory, his lantern blown out, slips in by the garden door and stands in the dark hall alcove, leaving the **muddy footprint** (`ev-gregory-enters-hall`). |
| **21:17** | **Victoria kills the Lord with the silver candlestick. The candle falls and goes out** (`ev-murder`). Gregory hears the thud and sees the light under the door dim (`ev-gregory-hears-thud`). |
| 21:18 | Reginald calls through the pantry door, "Who's on that telephone?", and Archibald snaps back (`ev-pantry-exchange`). Victoria takes the letter, wipes the candlestick and stands it back on the desk (`ev-victoria-takes-letter`). |
| 21:19 | Victoria steps out, **locks the door from outside and pockets the key** (`ev-victoria-locks-door`). A lightning flash shows Gregory her face (`ev-gregory-sees-victoria`). |
| 21:20 | Victoria **burns the letter** in the dining-room fire (`ev-letter-burned`) and **drops the key in the coal scuttle** (`ev-key-hidden`). Gregory flees to the garden and Archibald hangs up. |
| 21:22 | Archibald returns to the dining room (`ev-archibald-returns`). |
| 21:30 | Reginald brings the coal and finds the door locked with an **empty keyhole**. He sees the Lord's hand through it and **screams** (`ev-reginald-scream`). |
| 21:31–21:32 | Archibald shoulders the door open. **Body discovered**; no key in the lock, on the body or anywhere in the room (`ev-door-forced`, `ev-body-discovered`). |
| 21:36 | Gregory arrives from the kitchen (`ev-gregory-arrives`). |
| 21:38 | Lights return (`ev-lights-restored`). |
| 21:40 | Victoria murmurs to Archibald that they were "together the whole time" and he agrees (`ev-alibi-pact`). |
| 21:45 | Flooded road; the household waits in the hall (`ev-household-waits`). |

Every suspect has a `loc-<id>-<HHMM>` point entry at each of the 28 checkpoints from 20:30 to 21:45, and the test asserts exactly one location per suspect per checkpoint. Time ranges are `from`/`to` windows: `ev-victoria-argument` 20:50–20:56, `ev-archibald-phone` and `ev-reginald-hears-phone` 21:15–21:20. The test checks that everyone a window involves is at its location at every checkpoint inside it.

## 3. The four clues

| Evidence | Where | Literally shows | Points to |
|---|---|---|---|
| `silver-candlestick` (weapon) | library desk (found by searching the library; not in the notebook at the start) | One of the dining-room pair. Dented, wiped base with blood in the crest. The **fresh candle burned only about 5 minutes**, then fell while lit. | The weapon (`ev-murder`). Combined with the candle being fitted at 21:12 (`ev-candlestick-delivered`, `f-candle-burn`), it gives a death at ≈21:17. |
| `muddy-footprint` | hall, alcove by the garden door | One hobnail garden-boot print, toes toward the library door six paces away. **No mud further in** (`f-no-mud-beyond-alcove`). | **Red herring toward Gregory** (sacked that morning, `f-gregory-dismissed`, and near the scene). It is also proof that he stood where he could watch the library door (`ev-gregory-enters-hall`). |
| `burned-letter` | dining-room fireplace ashes | Solicitor's letter: new will leaves Lady Victoria £200 a year, signing at ten tomorrow. **Also: the household accounts point to the butler.** | Victoria's motive (`f-new-will`, `f-inheritance-motive`). Its location shows it was carried from the library to the dining room. The butler line pressures Reginald (`f-letter-accuses-butler`). |
| `library-key` (the missing key) | found in the dining-room coal scuttle | The library's only key (`f-library-single-key`) was not in the lock, on the body or in the room when the door was forced. It turns up sooty in the dining-room scuttle. | The door was locked **from outside** by someone who left the library (`f-lord-key-habit`: he always left it in the lock inside; the windows were bolted, `f-library-windows-bolted`). That person then went to the dining room. |

**What the key proves:**
- **Who had it:** the Lord, inside the lock. He unlocked it at 20:50 for Victoria, at 20:58 and 21:12 for Reginald, and at 21:15 for Victoria again.
- **Where it ends up:** Victoria locked the door from outside at 21:19 and dropped the key into the dining-room coal scuttle at 21:20.
- **What that shows:** the killer walked out of the library door and into the dining room. The dining room is the room covered by Victoria and Archibald's "mutual" alibi.

## 4. Pressured testimony (engine reveal rules)

Victoria's alibi is: *"Archibald and I sat by the dining-room fire through the whole blackout."* Archibald backs it up. Three testimonies break it. Each is a secret with `revealConditions`, evaluated by `engine/secrets.ts`, never by the model.

| Who | Secret | revealConditions | What they then admit (fact ids) |
|---|---|---|---|
| Reginald | `s-reginald-theft` | `burned-letter` (the solicitor's line about the butler) | Skimming the accounts. He spent the blackout counting cash in the pantry, heard Mr Crane on the servants' telephone 21:15–21:20 and called out to him at 21:18 (`ev-reginald-hears-phone`, `ev-pantry-exchange`). |
| Reginald | `s-reginald-overheard` | `burned-letter`, **after** `s-reginald-theft` | The 20:54 quarrel: "Ten o'clock tomorrow… not a penny more" (`ev-reginald-overhears`). |
| Archibald | `s-archibald-false-alibi` | `library-key` (found in "his" dining room) | He left at 21:13 for the telephone (`ev-archibald-leaves-dining`, `ev-archibald-phone`). **Victoria asked him to say they were together** (`ev-alibi-pact`). |
| Archibald | `s-archibald-embezzlement` | `library-key`, **after** `s-archibald-false-alibi` | Moving the embezzled money before midnight (`f-archibald-embezzlement`). |
| Gregory | `s-gregory-in-hall` | `muddy-footprint` | In the hall alcove from just after the quarter chime. Heard the thud and saw the light under the door dim (`ev-gregory-enters-hall`, `ev-gregory-hears-thud`). |
| Gregory | `s-gregory-saw-victoria` | `library-key`, **after** `s-gregory-in-hall` | **Lady Victoria** stepped out, locked the door, pocketed the key and went to the dining room (`ev-gregory-sees-victoria`, `ev-victoria-locks-door`). |
| Victoria | `s-victoria-new-will` | `burned-letter` | She knew about the new will and burned the letter. |
| Victoria | `s-victoria-left-dining` | `library-key` **and** `muddy-footprint` (mode `all`) | She left the dining room during the blackout. |
| Victoria | `s-victoria-murder` | all of `silver-candlestick`, `library-key`, `burned-letter` **and** stress ≥ 80, after both secrets above | Confession, as flavour only. Nothing below depends on it. |

## 5. Deduction chain (fair play)

### WHEN: 21:17
1. The Lord was alive at 21:12, and Reginald fitted a **fresh** candle then (`ev-candlestick-delivered`; Reginald volunteers this, it is not a secret).
2. That candle burned only about 5 minutes before it fell while lit (`silver-candlestick`, `f-candle-burn`). **Death ≈ 21:17.**
3. Cross-check: Gregory came in just after the quarter chime, heard the thud and saw the light under the door dim a minute or so later (`ev-gregory-enters-hall`, `ev-gregory-hears-thud`), consistent with 21:17. The door was already locked with no key inside by 21:30 (`ev-reginald-scream`).

### HOW: the silver candlestick
4. The body has a head wound (`ev-body-discovered`). The candlestick's base is dented and bloody with wipe marks, and it fell while lit (`silver-candlestick`).
5. It is one of the dining-room pair (`f-weapon-origin`). Reginald took it from the dining room at 21:11 and set it in the library at 21:12 (`ev-candlesticks-lit`, `ev-candlestick-delivered`). **Victoria watched it go** (`ev-candlesticks-lit`), so she had access to the weapon.
6. The killer left through the door. The windows were bolted inside (`f-library-windows-bolted`) and the only key was missing and had been used from the outside (`library-key`, `f-lord-key-habit`, `ev-body-discovered`).

### WHO: Victoria
7. **Opportunity.** Victoria claims she was with Archibald. Reginald, pressured by `burned-letter`, puts Archibald on the servants' telephone in the kitchen 21:15–21:20 (`ev-reginald-hears-phone`, `ev-pantry-exchange`). Archibald, pressured by `library-key`, admits leaving at 21:13 and returning at 21:22 (`ev-archibald-leaves-dining`, `ev-archibald-returns`), and says Victoria proposed the joint story (`ev-alibi-pact`). **Victoria was alone and unwatched 21:13–21:22, which covers 21:17.**
8. **Access.** The Lord unlocked only for people he knew. Victoria had been admitted once already that evening (`ev-victoria-argument`), and she knew the weapon was on his desk (step 5).
9. **Eyewitness.** Gregory (pressured by `muddy-footprint`, then `library-key`) saw Victoria leave the library at the flash, lock the door, pocket the key and walk to the dining room (`ev-gregory-sees-victoria`). The print proves he really was six paces from the door (`muddy-footprint`, `f-footprint-gregory`).
10. **Physical trail.** The key that locked the door from outside is in the **dining-room** scuttle (`library-key`). The letter that lay on the library desk at 21:12 (`ev-candlestick-delivered`) is burned in the **dining-room** fire (`burned-letter`). Both left the library with the killer and ended up in the room where Victoria sat alone from 21:20 to 21:22. Archibald was in the kitchen until 21:20, and Gregory never entered the dining room (step 12).

### WHY: inheritance
11. The burned letter says the new will leaves Lady Victoria £200 a year and was to be signed at ten tomorrow (`burned-letter`, `f-new-will`). Reginald saw the Lord brandish that letter at her at 20:54: "Ten o'clock tomorrow… not a penny more" (`ev-reginald-overhears`). **She knew before 21:17.** Killing him first keeps the old will, under which she inherits nearly everything (`f-inheritance-motive`). Only she loses under the new will, and she is the one who burned the letter.

### Eliminating the others (each alibi is plausible but imperfect)

**12. Gregory** (red herring: sacked that morning `f-gregory-dismissed`; muddy print by the library)
- The print stops in the alcove and there is no mud in the library (`f-no-mud-beyond-alcove`).
- The killer carried the key and letter into the dining room. Gregory went back out to the garden at 21:20 (`loc-gregory-2120`) and only came in through the kitchen at 21:35.
- *Imperfect:* nobody saw him in the hall or garden. Only the print and his own word place him.

**13. Archibald** (red herring: embezzlement `f-archibald-embezzlement`; threat `ev-archibald-threat`; false alibi)
- He was on the kitchen telephone 21:15–21:20: Reginald heard him and they exchanged words at 21:18 (`ev-pantry-exchange`).
- Getting to the library means crossing the hall, where Gregory stood from 21:16 to 21:19 and saw only Victoria.
- He was **outside** the locked door forcing it at 21:31 (`ev-door-forced`).
- *Imperfect:* Reginald heard him but never saw him, and the other end of the line is off-stage.

**14. Reginald** (red herring: skimming `f-reginald-theft`; the letter names the butler `f-letter-accuses-butler`; he handled the weapon at 21:12)
- He was in the pantry from 21:14. Archibald saw his candlelight under the door and heard coins at 21:15 (`ev-archibald-notices-pantry`), and heard him call out at 21:18 (`ev-pantry-exchange`).
- Gregory saw only Victoria leave the library.
- Reginald reported the locked door and empty keyhole himself (`ev-reginald-scream`), and the key was not on him but in the dining room.
- *Imperfect:* behind a closed door, nobody saw him.

## 6. Intended lies and contradictions

Each row is authored as an `intendedLies` entry (`l-*`) in the character's file, with `aboutFactId` (the truth it contradicts) and `brokenByEvidenceIds`. Lies broken by testimony list the clue that unlocks that testimony: `burned-letter` for Reginald's, `library-key` for Archibald's and Gregory's.

| Who | Says (intended lie) | Why they lie | Exposed by |
|---|---|---|---|
| Victoria | "Archibald and I sat by the fire the whole blackout." | Her alibi | Reginald `ev-reginald-hears-phone` / `ev-pantry-exchange`; Archibald cracks (`ev-archibald-leaves-dining`, `ev-alibi-pact`) |
| Victoria | "Edmund must have locked himself in, he always did." | Explains the locked room | `library-key`: no key inside, so it was locked from outside. `f-lord-key-habit`: he left it in the lock *inside*. |
| Victoria | "I never set foot in the hall after nine." | Hides the 21:15–21:19 trip | Gregory `ev-gregory-sees-victoria` (after `muddy-footprint`, then `library-key`) |
| Victoria | "Our little chat at nine? The Sunday menu, darling." | Hides the motive | Reginald `ev-reginald-overhears`; `burned-letter` |
| Victoria | "I've never seen that letter." | Hides the motive and the burning | `burned-letter` found in *her* dining-room fire; Reginald saw the Lord wave it at her (`ev-reginald-overhears`) and saw it on the desk at 21:12 (`ev-candlestick-delivered`) |
| Archibald | "I was with Victoria the whole time, ask her!" | Hides the phone call and moving embezzled money | Reginald `ev-reginald-hears-phone`, `ev-pantry-exchange`; cracks on `library-key` |
| Archibald | "The row at dinner? A racehorse, old boy." | Hides the embezzlement | Reginald and Victoria heard `ev-archibald-threat`; in data `brokenByEvidenceIds: ["library-key"]`, the clue that also unlocks his embezzlement secret |
| Reginald | "I was in the kitchen polishing silver and heard nothing." | Hides the stolen cash in the pantry | Archibald `ev-pantry-exchange` (Reginald called out to him); cracks on `burned-letter` |
| Reginald | "Her ladyship and his lordship had a few words, nothing more." | Eavesdropping is sackable, and she is now his mistress | `burned-letter`, after which he gives `ev-reginald-overhears` in full |
| Gregory | "I was in the potting shed all night; I only came in when I heard shouting." | Fear of being blamed (sacked, muddy, near the scene) | `muddy-footprint` (`f-footprint-gregory`) |
| Gregory | "I saw nothin' in the dark, sir." | Terrified of Lady Victoria | `library-key`, after which he gives `ev-gregory-sees-victoria` |

**Honest true belief that misleads:** Reginald sincerely believes Archibald did it (`b-reginald-crane-did-it`, wrong). Archibald believes Gregory did it (`b-archibald-gregory-did-it`, wrong).

## 7. Knowledge sources and boundaries

Source and confidence now live on the facts themselves. By convention, a perception across a wall or door is authored as its own entry located where the **perceiver** is, with a non-canonical source:

| Fact | Known by | source | confidence |
|---|---|---|---|
| `ev-reginald-overhears` (hall, 20:54) | Reginald | witnessed (partly heard through the ajar door) | 0.85 |
| `ev-reginald-hears-phone` (kitchen, 21:15–21:20) | Reginald | heard | 0.8 |
| `ev-lord-relocks` (hall, 21:13) | Reginald | heard | 0.9 |
| `ev-archibald-notices-pantry` (kitchen, 21:15) | Archibald | witnessed (candlelight, coins) | 0.7 |
| `ev-gregory-hears-thud` (hall, 21:17) | Gregory | heard | 0.8 |
| `ev-gregory-sees-victoria` (hall, 21:19) | Gregory | witnessed (lightning flash, ~6 m) | 0.85 (also belief `b-gregory-it-was-her`) |
| `ev-scream-heard-dining` (dining room, 21:30) | Victoria, Archibald | heard | 0.95 |
| `ev-shouting-heard-garden` (garden, 21:30) | Gregory | heard | 0.7 |

Everything else is `canonical`, meaning objective truth that every knower of it holds with certainty. See §8 for shared facts learned in different ways.

**Boundary rules enforced by `tests/cases/blackwood.test.ts`:**
- A character may only know a located timeline entry if they were at that location for the whole point or window.
- Non-canonical perception facts are known only by the perceivers they involve.
- Only Victoria knows `ev-murder`, `ev-key-hidden`, `ev-letter-burned` and `ev-victoria-takes-letter`.
- Explicit must-not-know lists cover facts a character was near but hidden from. For example, Victoria was in the hall at 21:19 but cannot know `ev-gregory-sees-victoria`.
- Every intended lie is about a fact the liar actually knows.

### 7.1 Knowledge gating (QA #6, #7)

The engine (`engine/knowledge-gate.ts`) withholds a character's known facts while they are linked to one of that character's **locked** secrets (`relatedFactIds`) or **unexposed** lies (`aboutFactId`). It also withholds that character's own timeline entries within ±1 minute of those facts (facts ≤10 minutes apart merge into one window), plus beliefs about withheld facts. Anything not linked reaches the model verbatim, so every incriminating fact is linked explicitly, not left to the window:

| Character | Secret | Facts linked in `relatedFactIds` (besides the original ones) |
|---|---|---|
| Victoria | `s-victoria-murder` | `ev-victoria-takes-letter`, `loc-victoria-2115`–`2119` |
| Victoria | `s-victoria-left-dining` | `ev-archibald-leaves-dining`, `ev-archibald-returns`, `ev-alibi-pact`, `loc-victoria-2113`, `2114`, `2120`–`2122` |
| Victoria | `s-victoria-new-will` | `f-inheritance-motive`, `f-letter-accuses-butler`, `loc-victoria-2050`, `loc-victoria-2054` |
| Archibald | `s-archibald-false-alibi` | `ev-archibald-returns`, `ev-archibald-notices-pantry`, `ev-pantry-exchange`, `loc-archibald-2113`–`2122` |
| Archibald | `s-archibald-embezzlement` | `ev-archibald-threat` |
| Reginald | `s-reginald-theft` | `loc-reginald-2115`–`2122` ("counting his hidden money", calling through the pantry door) |
| Reginald | `s-reginald-overheard` | `loc-reginald-2054`, `f-new-will` (gates `b-reginald-will`) |
| Gregory | `s-gregory-in-hall` | `f-footprint-gregory`, `f-no-mud-beyond-alcove`, `loc-gregory-2115`–`2122` |

`loc-reginald-2114` is deliberately **not** linked. Linking it would widen the window back to 21:13 and hide `ev-lord-relocks`, which Reginald should be able to state. With nothing unlocked the model still sees, for each suspect, the parts of the evening that match their cover story (for example Victoria's "by the fire with Archibald" at 21:11 and 21:30), and none of the blackout truth.

Red-herring beliefs are pointed at a fact the character can see, so the gate doesn't swallow them: `b-reginald-crane-did-it` and `b-archibald-gregory-did-it` are about `ev-body-discovered` (before: `ev-murder`, inside the window), and `b-gregory-will-hang` is about `f-gregory-dismissed` (before: `f-footprint-gregory`).

**Reginald saw no one (QA #6).** New world fact `f-reginald-saw-no-one` (`source: witnessed`, confidence 1): after the lock turned at 21:13 he stayed below stairs until the coal at 21:30, and in that time saw no one in the hall or at the library door and did not see Victoria at all. He has a matching accurate belief, `b-reginald-saw-nobody`. It is a `case.json` fact, not a timeline window, on purpose. A timeline entry involving Reginald from 21:14 to 21:30 would overlap his theft window and be withheld, and a gap is exactly what the model filled with an invented sighting. His only sighting of Victoria stays `ev-victoria-passes-reginald` at 20:57.

**Tests** (`tests/cases/blackwood.test.ts`, "knowledge gating"): a curated per-character list of sensitive facts must each be linked to one of that character's own secrets or lies. Every known self-involving entry from 21:13 to 21:22 must be linked or on a short safe list. With nothing shown, the gate must withhold all of them. Once every secret is revealed and every clue shown, nothing is withheld. Reginald's no-sighting fact and belief must reach the model. A regex check keeps giveaway words (alibi, telephone, theft, new will, what he saw, and so on) out of goals, traits, speech style and relationship notes.

## 8. Remaining modelling notes (contract v2)

All eleven gaps from the first draft are closed by contract v2 (commit 3608125). What's left:

1. **Source and confidence are per fact, not per knower.** A shared fact such as `ev-archibald-threat` is canonical to Archibald but only *heard* by Victoria and Reginald, and it cannot carry both. I kept shared world facts `canonical` and gave non-canonical sources only to single-perceiver entries. The same limitation keeps `f-new-will` (told to and read by Victoria) canonical.
2. **`keyEvidenceIds` judging rules are TBD** (contract: "judging rules come later"). This case expects `library-key` and `burned-letter`. If the engine ends up requiring *all* key evidence, the accusation needs both.
3. **The accusation no longer contains time or location.** WHEN (21:17) and WHERE stay engine truth and are used by the opportunity check, but the player isn't graded on them. The deduction in §5 still derives them, because they are needed to break the alibi.

## 9. Decisions made without the product owner
- **Mutual alibi instead of the gramophone.** With five rooms and four clues, Victoria's "seemingly solid" alibi is Archibald vouching for her. He lies to cover his own phone call.
- **The key in the coal scuttle** (not planted on anyone). This keeps "who was in the dining room between 21:20 and 21:22" as the pivot.
- **Time of death from the candle burn** (fresh candle at 21:12, about 5 minutes burned) rather than a stopped watch, since there is no fifth clue.
- **The telephone lives in the servants' area**, so Archibald's secret call gives Reginald and Archibald interlocking but imperfect alibis.
- **Reason for Gregory's dismissal:** drinking on duty. No named off-stage characters (no solicitor or broker names).
- **`solution.json` sits in the case folder**; it must only ever be read server-side.
- **No `portrait` or `image` keys.** Portraits default to the character id (`assets/characters/<id>/`), and evidence art doesn't exist yet.
- **Motive options:** four, one per suspect, with spoiler-free descriptions.
- **Relationship numbers** are my own proposals. Suspicion follows beliefs: Reginald suspects Archibald most, Archibald suspects Gregory, and Gregory suspects Victoria.

## 10. Location search and endings

**Where each clue is found** (`evidence.json` `locationId`): `silver-candlestick` in the library, `muddy-footprint` in the hall, and `burned-letter` and `library-key` both in the dining room. No clue is `initiallyAvailable`: the notebook starts empty and all four, including the weapon, are found by searching. The garden and the kitchen/servants' quarters hold no clue. Every location has an `emptyLine` (a comic line shown when a search finds nothing new).

Search flavour (`case.json` `locations[].searchFlavor`) and each clue's `discoveryLine` are public. They never name a suspect or mention the will, the telephone or the time.

`endings.json` is server-only. It holds:
- `correct.confession`: Victoria's confession, with an Archibald cameo that breaks the alibi.
- `correct.recap`: narrator prose covering who, how, why and 21:17 in the library, and the proof. Lines cite `evidenceIds`.
- `wrong.<suspectId>`: one ending for each of the four suspects. `wrong.victoria` is "right lady, no case" (wrong weapon, wrong motive or no key evidence).
- `escapedLine`.
