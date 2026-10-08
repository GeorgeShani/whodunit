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
| 21:13 | Reginald hears the Lord re-lock the door behind him (`ev-lord-relocks`). Two minutes after the candles were lit, Archibald leaves the dining room "to find the brandy" (`ev-archibald-leaves-dining`). |
| 21:14 | Victoria is alone in the dining room (`ev-victoria-alone`). Reginald shuts himself in his pantry. |
| 21:15 | Archibald is on the servants' telephone to his broker until 21:20 (`ev-archibald-phone`). Reginald hears him (`ev-reginald-hears-phone`), and Archibald sees candlelight under the pantry door and hears coins (`ev-archibald-notices-pantry`). **Victoria knocks and the Lord lets her in**, leaving the key in the lock (`ev-victoria-admitted`). |
| 21:16 | Gregory, his lantern blown out, slips in by the garden door and stands in the dark hall alcove, leaving the **muddy footprint** (`ev-gregory-enters-hall`). |
| **21:17** | **Victoria kills the Lord with the silver candlestick. The candle falls and goes out** (`ev-murder`). Gregory hears the thud and sees the light under the door dim (`ev-gregory-hears-thud`). |
| 21:18 | Reginald calls through the pantry door, "Who's on that telephone?", and Archibald snaps back (`ev-pantry-exchange`). Victoria takes the letter, wipes the candlestick and stands it back on the desk (`ev-victoria-takes-letter`). |
| 21:19 | Victoria steps out, **locks the door from outside and pockets the key** (`ev-victoria-locks-door`). A lightning flash shows Gregory her face (`ev-gregory-sees-victoria`). |
| 21:20 | Victoria **burns the letter** in the dining-room fire (`ev-letter-burned`) and **drops the key in the coal scuttle** (`ev-key-hidden`). Gregory flees to the garden and Archibald hangs up. |
| 21:22 | Archibald returns to the dining room (`ev-archibald-returns`). |
| 21:30 | Reginald brings the coal and finds the door locked with an **empty keyhole**. He sees the Lord's hand through it and **screams** (`ev-reginald-scream`). |
| 21:31–21:32 | Archibald shoulders the door open. At 21:32 Reginald notices that the letter that lay open on the desk at 21:12 is gone (`f-letter-gone`). **Body discovered**; no key in the lock, on the body or anywhere in the room (`ev-door-forced`, `ev-body-discovered`). |
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

Victoria's alibi is: *"Archibald and I sat by the dining-room fire from the moment the candles were lit until we heard the scream. Neither of us left."* (21:11 to 21:30) Archibald backs it up. Three testimonies break it. Each is a secret with `revealConditions`, evaluated by `engine/secrets.ts`, never by the model.

| Who | Secret | revealConditions | What they then admit (fact ids) |
|---|---|---|---|
| Reginald | `s-reginald-theft` | `burned-letter` (the solicitor's line about the butler) | Skimming the accounts. He spent the blackout counting cash in the pantry, heard Mr Crane on the servants' telephone 21:15–21:20 and called out to him at 21:18 (`ev-reginald-hears-phone`, `ev-pantry-exchange`). |
| Reginald | `s-reginald-overheard` | `burned-letter`, **after** `s-reginald-theft` | The 20:54 quarrel: "Ten o'clock tomorrow… not a penny more" (`ev-reginald-overhears`). |
| Archibald | `s-archibald-false-alibi` | `library-key` (found in "his" dining room) **or** Reginald's theft card (`testimonyIds`: he heard Crane on the telephone) | He left at 21:13 for the telephone (`ev-archibald-leaves-dining`, `ev-archibald-phone`). **Victoria asked him to say they were together** (`ev-alibi-pact`). |
| Archibald | `s-archibald-embezzlement` | `library-key`, **after** `s-archibald-false-alibi` | Moving the embezzled money before midnight (`f-archibald-embezzlement`). |
| Gregory | `s-gregory-in-hall` | `muddy-footprint` | In the hall alcove from just after the quarter chime. Heard the thud and saw the light under the door dim (`ev-gregory-enters-hall`, `ev-gregory-hears-thud`). |
| Gregory | `s-gregory-saw-victoria` | `library-key`, **after** `s-gregory-in-hall` | **Lady Victoria** stepped out, locked the door, pocketed the key and went to the dining room (`ev-gregory-sees-victoria`, `ev-victoria-locks-door`). |
| Victoria | `s-victoria-new-will` | `burned-letter` **or** Reginald's overheard card (`testimonyIds`) | She knew about the new will and burned the letter. |
| Victoria | `s-victoria-left-dining` | `library-key` **or** stress ≥ 70 **or** Archibald's or Reginald's theft card (`testimonyIds`; mode `any`) | She was alone in the dining room while Archibald was away, and got him to agree to the "together" story at 21:40 (`ev-victoria-alone`, `ev-archibald-leaves-dining`, `ev-alibi-pact`). Nothing about the library. |
| Victoria | `s-victoria-locked-door` | **none: core guilt, never revealed in interrogation** (§13) | (Truth, never admitted: she went to the library, locked it from outside at 21:19 and dropped the key in the scuttle at 21:20, `ev-victoria-locks-door`, `ev-key-hidden`.) |
| Victoria | `s-victoria-murder` | **none: core guilt, never revealed in interrogation** (§13) | The confession lives only in `endings.json` `correct.confession`, after a correct accusation. Nothing below depends on it. |

The old `s-victoria-left-dining` (library, lock and key included) is split in two, so that the new stress path only makes her admit leaving the dining room. Stress alone never unlocks the library visit or the murder.

### 4.1 Testimony paths (revealed secrets presented to another suspect)

A revealed secret becomes a notebook card (`testimonySummary`, public) that the player can present to another suspect (`engine/testimony.ts`). Every lie breaks only on a real contradiction (leak audit, §14). Most have an evidence path, so testimony is a second route there. Three have no contradicting clue or card and retire only when their owner confesses (`supersededBySecretIds`); `l-victoria-never-in-hall` breaks only on Gregory's eyewitness card.

| Lie | Evidence path (`brokenByEvidenceIds`) | Testimony path (`breaksOnSecretIds`, mode `any`) | Canon that makes the testimony break it |
|---|---|---|---|
| `l-victoria-together` "…from the moment the candles were lit until we heard the scream. Neither of us left." | `library-key`, `burned-letter` | `s-reginald-theft`, `s-archibald-false-alibi`, `s-gregory-saw-victoria` | Crane on the servants' telephone 21:15–21:20 (`ev-reginald-hears-phone`); Crane left at 21:13 (`ev-archibald-leaves-dining`); she was in the hall at 21:19 (`ev-gregory-sees-victoria`) |
| `l-archibald-together` "I was with Victoria by the dining-room fire from the moment the candles were lit until the scream." | `library-key`, `burned-letter` | `s-reginald-theft` | Reginald heard Crane's voice on the telephone 21:15–21:20, and Crane answered him at 21:18 |
| `l-reginald-heard-nothing` "In the kitchen polishing silver, heard nothing." | none (the letter blames him for the accounts; it says nothing about where he was). It retires with `s-reginald-theft`. | `s-archibald-false-alibi` | Crane's card says the butler called out to him from the pantry at 21:18 (`ev-pantry-exchange`) |
| `l-victoria-never-in-hall` "I never went near the library after nine." | none (see §11.4) | `s-gregory-saw-victoria` | Gregory saw her step out of the library at 21:19. No clue places her in the hall, so only the eyewitness breaks it. |
| `l-victoria-locked-in` "Edmund must have locked himself in." | `library-key` | `s-gregory-saw-victoria` | Gregory saw her lock the door from outside |
| `l-victoria-menu` "Our little chat? The Sunday menu. Nothing more." | `burned-letter` | `s-reginald-overheard` | Reginald saw and heard the 20:54 quarrel: "…what the new will allows" |
| `l-victoria-letter`, `l-gregory-shed` | `burned-letter` / `muddy-footprint` | none (evidence only) | |
| `l-archibald-racehorse`, `l-gregory-saw-nothing` | none: no clue contradicts "a racehorse" or "saw nothing in the dark". They retire when `s-archibald-embezzlement` / `s-gregory-saw-victoria` is revealed (both on `library-key`). | none | |

**Testimony cards** (each states only what the owner knows, with the data's source; every clock time is one the owner knows, and a test checks this):

| Secret | `testimonySummary` |
|---|---|
| `s-reginald-theft` | Reginald admits he hid in his pantry with money skimmed from the household accounts. Through the door he heard Mr Crane's voice on the servants' telephone from 21:15 to 21:20; at 21:18 Mr Crane told him to mind his own business. |
| `s-reginald-overheard` | At 20:54, through the ajar library door, Reginald saw her ladyship clutch his lordship's sleeve crying 'You wouldn't dare, Edmund!' as he held up a letter: 'Ten o'clock tomorrow... what the new will allows.' |
| `s-archibald-false-alibi` | Mr Crane admits he left the dining room at 21:13, after the candles were lit, and was back at 21:22. He used the servants' telephone 21:15-21:20; the butler called through the pantry door at 21:18. At 21:40 he backed Lady Victoria's story. |
| `s-archibald-embezzlement` | Mr Crane admits he embezzled company money, and that between 21:15 and 21:20 he telephoned his broker to move it before midnight. |
| `s-gregory-in-hall` | Gregory admits that at 21:16 he slipped in by the garden door and stood in the dark hall alcove, six paces from the library door. At 21:17 he heard a heavy thud in the library and saw the light under the door dim. |
| `s-gregory-saw-victoria` | Gregory says that at 21:19, in a lightning flash, he saw Lady Victoria's face as she stepped out of the library, locked the door, slipped the key into her gown and walked towards the dining room. |
| `s-victoria-left-dining` | Lady Victoria admits she left the dining room while Mr Crane was away, between 21:13 and 21:22, so they were not together all that time. At 21:40 she asked him to say they had been. |
| `s-victoria-new-will` | Lady Victoria admits she knew before the murder that his lordship meant to sign a new will, and that she burned the solicitor's letter. |

`s-victoria-locked-door` and `s-victoria-murder` have no summary on purpose: either card would name the killer by itself. Neither can be revealed in interrogation at all (§13).

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

### Proof without any confession

WHO, HOW, WHY and WHEN all follow from the four discoverable clues plus testimony that those clues unlock at **zero stress** (a test checks this: with all four clues shown and stress 0, every secret except Victoria's two core-guilt secrets, `s-victoria-locked-door` and `s-victoria-murder`, unlocks and every lie breaks or retires, except `l-victoria-never-in-hall`, which only Gregory's card breaks):
- **WHEN (21:17):** `silver-candlestick` (candle burned about 5 minutes) + Reginald's freely given 21:12 delivery (`ev-candlestick-delivered`). Cross-checked by Gregory's thud (`muddy-footprint` → `s-gregory-in-hall`).
- **HOW:** `silver-candlestick` + `f-weapon-origin` + the lock turned from outside (`library-key`).
- **WHO:** `library-key` in the dining-room scuttle and `burned-letter` in the dining-room fire; the "together" alibi is broken by Reginald (`burned-letter` → `s-reginald-theft`) and Archibald (`library-key` → `s-archibald-false-alibi`); Gregory's eyewitness account (`muddy-footprint` then `library-key`).
- **WHY:** `burned-letter` (the new will), backed up by Reginald (`s-reginald-overheard`).

Stress (the 70 on `s-victoria-left-dining`) only adds a shortcut. Nothing in the chain needs it, and no amount of stress makes Victoria confess the killing (§13).

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
| Victoria | "I never went near the library after our little chat at nine." (was: "I never set foot in the hall after our little chat at nine.") | Hides the 21:15–21:19 trip; reworded so it doesn't clash with her stress admission that she left the dining room | Gregory `ev-gregory-sees-victoria` (after `muddy-footprint`, then `library-key`) |
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
| Victoria | `s-victoria-left-dining` | (now the full list) `ev-victoria-alone`, `ev-archibald-leaves-dining`, `ev-archibald-returns`, `ev-alibi-pact`, `loc-victoria-2113`, `2114`, `2122` |
| Victoria | `s-victoria-locked-door` (new) | `ev-victoria-admitted`, `ev-victoria-locks-door`, `ev-key-hidden`, `loc-victoria-2119`–`2121` |
| Victoria | `s-victoria-new-will` | `f-inheritance-motive`, `f-letter-accuses-butler`, `loc-victoria-2050`, `loc-victoria-2054`, `ev-victoria-passes-reginald` |
| Archibald | `s-archibald-false-alibi` | `ev-archibald-returns`, `ev-archibald-notices-pantry`, `ev-pantry-exchange`, `loc-archibald-2113`–`2122` |
| Archibald | `s-archibald-embezzlement` | `ev-archibald-threat` |
| Reginald | `s-reginald-theft` | `loc-reginald-2115`–`2122` ("counting his hidden money", calling through the pantry door) |
| Reginald | `s-reginald-overheard` | `loc-reginald-2054`, `f-new-will` (gates `b-reginald-will`) |
| Gregory | `s-gregory-in-hall` | `f-footprint-gregory`, `f-no-mud-beyond-alcove`, `loc-gregory-2115`–`2122` |

`loc-reginald-2114` is not a direct link. Linking it would widen the old proximity window back to 21:13 and hide `ev-lord-relocks`. Since the case switched to the explicit gate, it is hidden with `hiddenUntil` instead (§7.2).

Red-herring beliefs are pointed at a fact the character can see, so the gate doesn't swallow them: `b-reginald-crane-did-it` and `b-archibald-gregory-did-it` are about `ev-body-discovered` (before: `ev-murder`, inside the window), and `b-gregory-will-hang` is about `f-gregory-dismissed` (before: `f-footprint-gregory`).

**Reginald saw no one (QA #6).** New world fact `f-reginald-saw-no-one` (`source: witnessed`, confidence 1): after the lock turned at 21:13 he stayed below stairs until the coal at 21:30, and in that time saw no one in the hall or at the library door and did not see Victoria at all. He has a matching accurate belief, `b-reginald-saw-nobody`. It is a `case.json` fact, not a timeline window, on purpose. A timeline entry involving Reginald from 21:14 to 21:30 would overlap his theft window and be withheld, and a gap is exactly what the model filled with an invented sighting. His only sighting of Victoria stays `ev-victoria-passes-reginald` at 20:57.

### 7.2 Explicit gate (`"knowledgeGate": "explicit"`)

The proximity heuristic is off. Only direct links and `hiddenUntil` apply. Every fact and belief the heuristic used to hide was reviewed:

| Fact / belief | Decision | Why |
|---|---|---|
| `loc-reginald-2114` (21:14, shutting himself in his pantry) | `hiddenUntil: { secretIds: [s-reginald-theft] }` | Requested. The pantry is where the theft happens. His 21:13 lock-turn (`loc-reginald-2113`, `ev-lord-relocks`) stays visible. |
| `loc-archibald-2040` ("threatening Lord Blackwood across the table") | `hiddenUntil: { lieIds: [l-archibald-racehorse] }` | Calls it a threat, which contradicts his "just a racehorse" story. It unlocks when the lie retires, i.e. when `s-archibald-embezzlement` is revealed (a superseded lie counts as broken). |
| `loc-archibald-2112` (by candlelight with Victoria) | visible | True, and matches the cover story. Gives nothing away. |
| `loc-archibald-2140` (with the household in the hall) | visible | Harmless. The pact itself (`ev-alibi-pact`) stays linked to his false-alibi secret. |
| `loc-gregory-2114` ("stumbling about after his lantern blows out") | `hiddenUntil: { secretIds: [s-gregory-in-hall] }` | Contradicts "in the potting shed all night", and the lantern is why he came into the hall. |
| `loc-victoria-2057` (leaving the library, sweeping past Reginald) | visible | Her "menu chat" story already admits the 20:50 visit. Neutral wording, and she witnessed it herself. |
| `loc-victoria-2058` (back at the table with Archibald) | visible | Harmless, matches the cover story. |
| `loc-victoria-2112` (by candlelight with Archibald) | visible | Harmless, matches the cover story. |
| `loc-victoria-2140` (with the household in the hall) | visible | Harmless. The pact stays linked. |
| `ev-victoria-passes-reginald` ("flushed … without a word") | Victoria: linked to `s-victoria-new-will`. Reginald: visible | "Flushed" hints at the quarrel her menu story hides. `hiddenUntil` would hide it from Reginald too, and he needs his 20:57 sighting (#6), so this is a per-character direct link instead. |
| `b-reginald-lady-stayed` (false) | visible | Wanted red herring. He last saw her in the dining room at 21:11 and saw nobody after 21:13, so it contradicts nothing he witnessed. |
| `b-reginald-crane-did-it` (false) | visible, reworded | Old: "…threatened his lordship at dinner and went creeping about in the dark." New: "…threatened his lordship at dinner, and he has the temper for it." "Creeping about" came from the telephone he heard, which is behind his theft secret. |
| `b-victoria-unseen`, `b-victoria-reginald-deaf`, `b-victoria-brandy-errand` | hidden: `aboutFactId` moved to `ev-victoria-locks-door`, `ev-victoria-argument`, `ev-archibald-leaves-dining` | Each gives something away ("in the hall", "our quarrel", "he went off"). The facts they were about were facts she doesn't know, so they had no gate. |
| `b-archibald-victoria-stayed`, `b-archibald-butler-spy` | hidden: `aboutFactId` moved to `ev-archibald-phone`, `ev-pantry-exchange` | Both mention or imply the telephone. They come back as honest, wrong beliefs once his false alibi is revealed. |

**Tests** (`tests/cases/blackwood.test.ts`, "knowledge gating"): a curated per-character list of sensitive facts must each be linked to one of that character's own secrets or lies. Every known self-involving entry from 21:13 to 21:22 must be linked or on a short safe list. With nothing shown, the gate must withhold all of them. Once every secret is revealed and every clue shown, nothing is withheld. Reginald's no-sighting fact and belief must reach the model. A regex check keeps giveaway words (alibi, telephone, theft, new will, what he saw, and so on) out of goals, traits, speech style and relationship notes.

## 8. Remaining modelling notes (contract v2)

All eleven gaps from the first draft are closed by contract v2 (commit 3608125). What's left:

1. **Source and confidence are per fact, not per knower.** A shared fact such as `ev-archibald-threat` is canonical to Archibald but only *heard* by Victoria and Reginald, and it cannot carry both. I kept shared world facts `canonical` and gave non-canonical sources only to single-perceiver entries. The same limitation keeps `f-new-will` (told to and read by Victoria) canonical.
2. **`keyEvidenceIds` judging rules are TBD** (contract: "judging rules come later"). This case expects `library-key` and `burned-letter`. If the engine ends up requiring *all* key evidence, the accusation needs both.
3. **The accusation no longer contains time or location.** WHEN (21:17) and WHERE stay engine truth and are used by the opportunity check, but the player isn't graded on them. The deduction in §5 still derives them, because they are needed to break the alibi.

4. **A stress reveal doesn't expose the owner's own lie.** If Victoria reaches stress 70 before any clue or testimony breaks `l-victoria-together`, the engine tells her to confess `s-victoria-left-dining` while that lie is still marked MAINTAIN. The data can't fix this: a lie can't break on its owner's own secret, and the validator flags that as self-referential. In practice most pressure comes from presenting the clues and testimony that break the lie anyway (`library-key`, `burned-letter`, or three testimony cards). Engine suggestion: when a secret is revealed, expose the owner's lies whose `aboutFactId` is in that secret's `relatedFactIds`.
   **Resolved (engine, Phase 7):** lies now take an optional `supersededBySecretIds` (the owner's own secrets). `l-victoria-together` lists `s-victoria-left-dining`, so the stress confession retires the lie in the same turn. The prompt shows it as DROPPED and never as MAINTAIN (tested in `tests/engine/stress.test.ts`).

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

**Where each clue is found** (`evidence.json` `locationId`): `silver-candlestick` in the library, `muddy-footprint` in the hall, and `burned-letter` and `library-key` both in the dining room. No clue is `initiallyAvailable`: the notebook starts empty and all four, including the weapon, are found by searching, in the order and under the conditions of §12. The garden and the kitchen/servants' quarters hold no clue. Every location has an `emptyLine` (a comic line shown when a search finds nothing new).

Search flavour (`case.json` `locations[].searchFlavor`) and each clue's `discoveryLine` are public. They never name a suspect or mention the will or the time, and no text shown before a clue is found names the clue or its hiding place (a test checks this; §12.5). The kitchen flavour does mention the servants' telephone, as a lead (§12.2).

`endings.json` is server-only. It holds:
- `correct.confession`: Victoria's confession, with an Archibald cameo that breaks the alibi.
- `correct.recap`: narrator prose covering who, how, why and 21:17 in the library, and the proof. Lines cite `evidenceIds`.
- `wrong.<suspectId>`: one ending for each of the four suspects. `wrong.victoria` is "right lady, no case" (wrong weapon, wrong motive or no key evidence).
- `escapedLine`.

## 11. Round 2 data fixes (Gremlins #26 and #27, Dexter's data notes)

### 11.1 Archibald's order of events (#26)

Canon, in the order every statement now uses: **21:10** lights fail (`ev-blackout`, back at 21:38) → **21:11** Reginald lights the candles (`ev-candlesticks-lit`) → **21:13** Archibald leaves, *two minutes after the candles were lit* (`ev-archibald-leaves-dining`) → **21:15–21:20** servants' telephone (`ev-archibald-phone`), with Reginald calling through the pantry door at **21:18** → **21:22** back in the dining room, nine minutes after he left (`ev-archibald-returns`) → **21:40** the pact (`ev-alibi-pact`).

The old blur was "he left after the lights went out till Reginald lit the candles": the blackout began at 21:10 but the candles were lit at 21:11 and he left at 21:13, so he never left *before* the candles. Lies and beliefs now anchor to events, not to "the blackout" (the topic label stays "whereabouts during the blackout", which is true of the whole window). Beliefs `b-archibald-victoria-stayed`, `b-victoria-brandy-errand` and `b-reginald-lady-stayed` carry clock times. `b-archibald-gregory-did-it` no longer says "sacked": Archibald does not know `f-gregory-dismissed`.

### 11.2 Retired lies (`supersededBySecretIds`)

A lie is retired by its owner's own secret whose confession literally contradicts the claim:

| Lie | Retired by |
|---|---|
| `l-victoria-together` | `s-victoria-left-dining` |
| `l-victoria-letter`, `l-victoria-menu` | `s-victoria-new-will` |
| `l-victoria-locked-in`, `l-victoria-never-in-hall` | none since §13: they break by `library-key` / Gregory's card and stay EXPOSED; she stonewalls |
| `l-reginald-heard-nothing` | `s-reginald-theft` |
| `l-reginald-few-words` | `s-reginald-overheard` |
| `l-archibald-together` | `s-archibald-false-alibi` |
| `l-archibald-racehorse` | `s-archibald-embezzlement` |
| `l-gregory-shed` | `s-gregory-in-hall` |
| `l-gregory-saw-nothing` | `s-gregory-saw-victoria` |

Goals, relationship notes and beliefs have no supersession field. They are reworded so that they are true both before and after the confession (Victoria no longer "insists she spent the blackout by the fire"; Archibald's note on Lord Blackwood no longer says the quarrels were only business as a fact).

### 11.3 Voice: no catchphrases

`catchphrases` is empty for all four characters ("Darling, I simply couldn't." and "Must we dwell on unpleasantness?" were the hooks the model repeated). `speechStyle` now describes register and behaviour only. "Darling" is gone from the lie claims. `endings.json` keeps its authored "darling" lines as scripted flavour.

### 11.4 Library key and `brokenByEvidenceIds`

Before: showing `library-key` broke three of Victoria's lies at once, before she had said any of them. The engine rule stays (evidence breaks a lie whether or not it has been told). The key's list was trimmed to the lies it actually contradicts:

| Lie | Key stays? | Why |
|---|---|---|
| `l-victoria-together` | yes | The library key in the dining-room scuttle contradicts "neither of us left". |
| `l-victoria-locked-in` | yes | A key outside the room contradicts "he must have locked himself in" (`f-lord-key-habit`). |
| `l-victoria-never-in-hall` | **removed**, and the footprint too | Neither the key nor the print puts Victoria in the hall or library. Only Gregory's eyewitness (`s-gregory-saw-victoria`) does. |

The proof does not use this lie: WHO, HOW, WHY and WHEN are derived in §5 without it.

### 11.5 Pair material (#27)

`relationships[].description` is the only per-pair free-text field. It is always in the character's prompt, so it carries tone and what the speaker would say, never a fact that needs gating. Each text uses only what the speaker knows, with no giveaway words (a test checks the same word list as §7.2 plus the specific facts below). Archibald's note on Gregory does not say "sacked". Victoria's notes use the dinner threat and the dismissal because she was present for both.

| From → to | Resentment / what they throw / what they bring up defensively |
|---|---|
| Victoria → Archibald | Tiresome but handy. Needles his temper and the dinner threat; goes cool and reminds him whose house it is. |
| Victoria → Reginald | Furniture that carries trays. Needles his hovering; reminds him his place depends on hers. |
| Victoria → Gregory | Contempt. Throws the dismissal, the gin and the boots; "a sacked man with a grudge is who the police will want." |
| Archibald → Victoria | Grieving ornament. Jabs that she bears up well for a new widow; laughs off the dinner row as business. |
| Archibald → Reginald | Stiff busybody. "It was your candlestick, carried in by your own hands." |
| Archibald → Gregory | Ignores him until there is a body; "soaked and shifty the moment the body was found"; talks over his mumbling. |
| Reginald → Archibald | Quotes the dinner threat back word for word, straight-faced, and answers bluster with exaggerated politeness. |
| Reginald → Victoria | Never accuses. Under pressure turns stiff and recalls exactly when her ladyship swept past him in the hall (20:57). |
| Reginald → Gregory | Fatherly. Scolds the gin and the mud; steps between him and raised voices. |
| Gregory → Victoria | Terrified of her tongue; cannot meet her eye; edges towards a door. |
| Gregory → Archibald | Nervous of the loud gentleman who keeps pointing at him; stubborn mutters about the greenhouse. |
| Gregory → Reginald | Trusts him most; turns to him like a lost lamb. |

The table is the tone of each pair. The barbs themselves now live in `relationships[].jabs` (each tied by `aboutFactId` to a fact the speaker knows where the barb rests on one, and `when: confrontation` for the sharp ones) and the touchy subjects in `relationships[].defensiveOn` (§12.6). `description` keeps only the feeling.

### 11.6 End-screen location name

`solution.json` holds only `locationId`. The "Where, when" row prints `locations[].name` ("The Library, 21:17"). `locations[].name` also titles the Investigate cards and appears in prompts, so it stays capitalised. Blackwood's authored `correct.recap` already reads "in the library". The capitalised "in The Library" appears only in the engine's fallback `engineRecapLine` (cases without an authored recap): that is an engine change, not data.

## 12. Progression (rooms, leads, the accuse gate)

Implemented with Dexter's progression backend (docs/CASE_FORMAT.md "Progression"). Conditions are checked against the state before each action, and every one only ever goes from false to true.

### 12.1 The solve path
1. **Library** (open from the start): `silver-candlestick`. The dining room is shut until it is found (`requires: silver-candlestick`, `lockedLine` "Crime scene first, detective! Procedure!").
2. **Talk.** Two exchanges with a suspect open a lead (§12.2).
3. **Dining room, first search:** `library-key` (coal scuttle). Needs `lead-keyhole` (Reginald x2 or Archibald x2) **or** `lead-fireplace` (Victoria x2). Nag until then: "The hearth is still holding out on you."
4. **Dining room, second search:** `burned-letter` (grate). Needs `library-key` already found **and** `lead-letter` (Reginald x2), checked against the state before the search, so key and letter are always two searches.
5. **Garden / kitchen / hall:** the garden and kitchen give leads (§12.2) and no clue. `muddy-footprint` (hall) needs `lead-lantern` (garden searched) **or** `lead-boots` (Gregory x2).
6. **Crack them.** Show `burned-letter` to Reginald (`s-reginald-theft`), `library-key` to Archibald (`s-archibald-false-alibi`), the footprint then the key to Gregory (`s-gregory-in-hall`, then `s-gregory-saw-victoria`). Showing a clue to Victoria also cracks her (`library-key` → `s-victoria-left-dining`, `burned-letter` → `s-victoria-new-will`).
7. **Accuse** (§12.3): murderer, weapon, motive, **both** key clues and a **revealed key testimony** (`s-reginald-theft`, `s-archibald-false-alibi` or `s-gregory-saw-victoria`).

### 12.2 Leads (all nine, `case.json` `leads`)
| Lead | Opens when | Closes when | Unlocks |
|---|---|---|---|
| `lead-weapon` | start | `silver-candlestick` found | (the dining room opens on the clue itself) |
| `lead-motive` | start | `burned-letter` found | tracking only |
| `lead-keyhole` | Reginald >= 2 **or** Archibald >= 2 | `library-key` found | `library-key` |
| `lead-fireplace` | Victoria >= 2 | `library-key` found | `library-key` |
| `lead-letter` | Reginald >= 2 | `burned-letter` found | `burned-letter` (with the key) |
| `lead-lantern` | garden searched | `muddy-footprint` found | `muddy-footprint` |
| `lead-boots` | Gregory >= 2 | `muddy-footprint` found | `muddy-footprint` |
| `lead-alibi` | kitchen searched, Victoria >= 2 or Archibald >= 2 | any of `s-reginald-theft`, `s-archibald-false-alibi`, `s-gregory-saw-victoria` revealed | ACCUSE |
| `lead-eyewitness` | hall searched | `s-gregory-saw-victoria` revealed | bonus |

Canon added for the leads: `f-letter-gone` (`case.json`, 21:32, library, witnessed by Reginald, confidence 0.8, known only by Reginald): the letter that lay open at 21:12 had gone by 21:32. It fits the timeline: Victoria took it at 21:18 (`ev-victoria-takes-letter`) and burned it at 21:20 (`ev-letter-burned`), and Reginald is in the library at 21:32 (`loc-reginald-2132`). The garden's snuffed lantern and the kitchen's crooked telephone with a shred of cigar are search flavour (lead hints), not clues and not secrets: Gregory's lantern died at 21:14 and he came in by the garden door at 21:16; Archibald phoned at 21:15-21:20 and chews an unlit cigar.

### 12.3 The accuse gate
`accuseGate`: >= 3 clues, >= 3 suspects questioned >= 2 exchanges each, >= 2 revealed secrets, and `lead-alibi` closed. While locked, `/api/accuse` answers 403 `accuse_locked` with the first unmet item's line (clues, suspects, secrets, leads) and spends nothing. Win rule (`solution.json`): `minKeyEvidence: 2` (`library-key` and `burned-letter`) and `minKeyTestimony: 1` of `keyTestimonyIds` (`s-reginald-theft`, `s-archibald-false-alibi`, `s-gregory-saw-victoria`). Citing testimony that is not revealed in the signed state is rejected (`testimony_not_revealed`).

### 12.4 Fastest legal path: 10 actions
`validate:case` prints "fastest legal path: 10 actions". The proposal's hand count was 11, but it missed that showing a clue to Victoria is also an exchange that cracks one of her secrets, so she can supply both the second suspect-exchange and the second revealed secret:

| # | Action |
|---|---|
| 1 | Search the library (candlestick) |
| 2-3 | Two exchanges with Reginald (opens `lead-keyhole` and `lead-letter`) |
| 4 | Search the dining room (key) |
| 5 | Search the dining room again (letter) |
| 6 | Show the key to Archibald (`s-archibald-false-alibi`, closes `lead-alibi`; Archibald 1) |
| 7 | Show the key to Victoria (`s-victoria-left-dining`; Victoria 1) |
| 8 | Show the letter to Victoria (`s-victoria-new-will`; Victoria 2) |
| 9 | One more exchange with Archibald (Archibald 2) |
| 10 | Accuse: Victoria, candlestick, inheritance, key + letter, citing `s-archibald-false-alibi` |

The gate is met after action 9: three clues, three suspects at >= 2 (Reginald 2, Victoria 2, Archibald 2), three secrets, `lead-alibi` closed. A test replays this path against the real functions. A typical game with the garden, kitchen, hall and Gregory takes about 18-25 actions. Whether to accept 10, or to make 11 the floor by raising `minSuspectsQuestioned.minExchanges` to 3 or `minRevealedSecrets` to 3, is George's call; the data is not changed to chase the number.

### 12.5 Fairness argument
- **No lucky guess.** ACCUSE is locked until the gate is met, and the gate cannot be met without talking to three suspects, cracking two secrets and closing the alibi lead. The server recomputes the gate from the signed token (403 otherwise). Winning also needs both key clues and a real revealed key testimony, all re-checked against the token. Because one accusation is final (#22), the only residual guess after the gate is murderer x weapon x motive, and a player at that point holds the proof. A test shows that all four clues with nobody questioned still gets 403.
- **Provable from evidence alone.** Every unlock is evidence, search or talk; none needs stress. The two key clues are reachable at zero stress through leads that open on plain conversation. Every key testimony is cracked by a clue (`s-reginald-theft` by `burned-letter`, `s-archibald-false-alibi` by `library-key`, `s-gregory-saw-victoria` by `library-key` after `s-gregory-in-hall`), with no stress route; the reachability simulation in `validate:case` fails the build otherwise, and a test checks it. The deduction chain of §5 is unchanged.
- **Reachability and redundancy.** The unlock graph is a DAG (talk, leads, key, letter, secrets) and monotone, so no order of play undoes an unlock. The key has three routes (Reginald, Archibald, Victoria), the footprint two (garden, Gregory), the alibi lead three secrets. The one single point is Reginald for the letter: he is mandatory but deterministic (two exchanges), and fallback replies count as exchanges, so a model outage cannot lock the game.
- **Early leaks.** Before a clue is found, nothing shown names it or its hiding place: the dining-room card no longer lists the scuttle, the hall card no longer measures the alcove, the dining-room flavour no longer pokes the scuttle, and the nag lines are vague. A test scans every public pre-clue string. Lead hints name rooms and people already on the map (as designed) but no clue, no motive and no culprit.

### 12.6 Pair material (supersedes the table of §11.5 for the barbs)
Each of the 12 ordered pairs has a short `description` (feeling), at least one `jabs[]` entry and one `defensiveOn[]` entry. About half the barbs are tied by `aboutFactId` to a fact the speaker knows, so the engine offers them only while the speaker knows it: the dinner threat (`ev-archibald-threat`) for Victoria, Reginald and Archibald; the dismissal (`f-gregory-dismissed`) for Victoria, Reginald and Gregory; the candlesticks (`ev-candlesticks-lit`), the door forced (`ev-door-forced`), the arrival (`ev-gregory-arrives`) and the 20:57 sighting (`ev-victoria-passes-reginald`). None names a secret, the library or the key (a test checks the same giveaway word list as §7.2). Archibald's barbs never mention the dismissal, and Gregory's never mention the dinner threat, because they do not know them. The `description` texts of §11.5 are kept for the tone.

## 13. The murderer never confesses in interrogation (live-play fix)

**Bug.** In George's live play, showing Victoria Archibald's card (`s-archibald-false-alibi`) made her confess the whole murder. The card itself only breaks `l-victoria-together` and reveals nothing. The data path was stress: an exposed lie adds stress, and `s-victoria-murder` revealed at stress >= 80 once all three of candlestick, key and letter had been shown and `s-victoria-left-dining` and `s-victoria-new-will` were cracked. So late in a game the card's stress pushed her over 80 and the engine unlocked the murder secret and its facts (`ev-murder`, `loc-victoria-2115`–`2119`).

**Rule.** No in-game murder confession before the accusation. Victoria's two core-guilt secrets, `s-victoria-murder` and `s-victoria-locked-door`, have **no `revealConditions`**, so the engine can never reveal them, and the facts they cover (`ev-victoria-admitted`, `ev-murder`, `ev-victoria-takes-letter`, `ev-victoria-locks-door`, `ev-key-hidden`, `ev-letter-burned`, `loc-victoria-2115`–`2121`) stay withheld from her prompt for the whole interrogation. Her confession lives only in `endings.json` (`correct.confession`), which is played after a correct accusation and never reaches the model. Both secrets carry `coreGuilt: true` (the engine field from da253b4): the engine never puts them in the revealable set (interrogation, evidence, testimony, confrontation or breakdown), never turns them into a testimony card, and filters their facts out of her prompt even if another secret lists them. A card or clue can still expose a lie whose truth is core guilt (Gregory's card against `l-victoria-locked-in` / `l-victoria-never-in-hall`): the notebook shows the contradiction, nothing is revealed, and she stonewalls.

**What each card and admission may do now:**
- Archibald's card (`s-archibald-false-alibi`), Reginald's theft card and Gregory's eyewitness card break `l-victoria-together`; Reginald's overheard card breaks `l-victoria-menu`; Gregory's eyewitness card also breaks `l-victoria-locked-in` and `l-victoria-never-in-hall`. No card reveals a Victoria secret. The door lies stay EXPOSED and she stonewalls; the facts behind them stay hidden.
- `s-victoria-left-dining` (key or stress 70): she admits she left the dining room between 21:13 and 21:22 and asked Archibald at 21:40 to say otherwise. Her description now adds that she will not say where she went; its `relatedFactIds` hold no murder-window fact.
- `s-victoria-new-will` (letter): she knew about the will and burned the letter. `ev-letter-burned` no longer mentions the handkerchief (the one that wiped the candlestick). The leak audit (§14) moved `ev-letter-burned` from this secret to `s-victoria-murder`, because its time, 21:20, is inside the murder window: burning at 21:20 the letter that lay on the desk at 21:12 places her in the library. She admits burning it, never when.
- `l-victoria-locked-in` and `l-victoria-never-in-hall` lost their `supersededBySecretIds` (the retiring secret can no longer be revealed).

**Proof.** Unchanged: §5 never used either core-guilt secret. WHO rests on the key and letter in the dining room, the broken alibi (`s-reginald-theft`, `s-archibald-false-alibi`) and Gregory's eyewitness (`s-gregory-saw-victoria`), all evidence-cracked at zero stress.

**Tests** (`tests/cases/blackwood-guilt.test.ts`): every card, every clue and stress 100 reveal only `s-victoria-left-dining` and `s-victoria-new-will`, and none of her visible facts, secrets, beliefs, lies or goals mention the strike, the library visit, the locked door or the scuttle; each card exposes exactly the Victoria lies it contradicts and reveals nothing; no revealable secret lists a murder-window fact, and every murder-window fact is covered by a core-guilt secret.

## 14. Leak audit

The full leak-path audit (every reveal and break path, the worst admission the model could make at each point, and the findings with fixes) is in [`LEAK_AUDIT.md`](LEAK_AUDIT.md). The eval scenarios for the harness are in [`../evals/leak-scenarios.json`](../evals/leak-scenarios.json). The data changes from the audit:

- `b-victoria-unseen` no longer says "Nobody saw **me** in the hall".
- `ev-letter-burned` is now core guilt (above).
- Trimmed `brokenByEvidenceIds`:
  - `l-archibald-racehorse` (was `library-key`);
  - `l-reginald-heard-nothing` (was `burned-letter`);
  - `l-gregory-saw-nothing` (was `library-key`).
- Gregory's tell "glances towards Lady Victoria" is now "glances towards the hall door".
- `f-reginald-saw-no-one` says "below stairs", not "his pantry".
- New `revealConditions.testimonyIds` (any-of, alongside the existing conditions):
  - `s-victoria-left-dining` ← `s-archibald-false-alibi`, `s-reginald-theft`;
  - `s-victoria-new-will` ← `s-reginald-overheard`;
  - `s-archibald-false-alibi` ← `s-reginald-theft`.

  Each card also breaks a lie that the secret supersedes. No card can reveal a core-guilt secret. The fastest legal path is still 10.

The proof (§5) is unchanged: it never used a broken lie as a step. The validator still prints a fastest path of 10.
