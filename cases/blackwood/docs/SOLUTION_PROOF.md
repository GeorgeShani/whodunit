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

Server-only truth: `solution.json` = `{ murdererId: "victoria", weaponId: "silver-candlestick", locationId: "library", time: "21:17" }`. The motive cannot be stored there (see §8, gap G2), so it exists only as the world facts above.

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

Every suspect has a `loc-<id>-<HHMM>` fact at each of the 28 checkpoints from 20:30 to 21:45. The test asserts exactly one location per suspect per checkpoint.

## 3. The four clues

| Evidence | Where | Literally shows | Points to |
|---|---|---|---|
| `silver-candlestick` (weapon) | library desk (available from the start) | One of the dining-room pair. Dented, wiped base with blood in the crest. The **fresh candle burned only about 5 minutes**, then fell while lit. | The weapon (`ev-murder`). Combined with the candle being fitted at 21:12 (`ev-candlestick-delivered`, `f-candle-burn`), it gives a death at ≈21:17. |
| `muddy-footprint` | hall, alcove by the garden door | One hobnail garden-boot print, toes toward the library door six paces away. **No mud further in** (`f-no-mud-beyond-alcove`). | **Red herring toward Gregory** (sacked that morning, `f-gregory-dismissed`, and near the scene). It is also proof that he stood where he could watch the library door (`ev-gregory-enters-hall`). |
| `burned-letter` | dining-room fireplace ashes | Solicitor's letter: new will leaves Lady Victoria £200 a year, signing at ten tomorrow. **Also: the household accounts point to the butler.** | Victoria's motive (`f-new-will`, `f-inheritance-motive`). Its location shows it was carried from the library to the dining room. The butler line pressures Reginald (`f-letter-accuses-butler`). |
| `library-key` (the missing key) | found in the dining-room coal scuttle | The library's only key (`f-library-single-key`) was not in the lock, on the body or in the room when the door was forced. It turns up sooty in the dining-room scuttle. | The door was locked **from outside** by someone who left the library (`f-lord-key-habit`: he always left it in the lock inside; the windows were bolted, `f-library-windows-bolted`). That person then went to the dining room. |

**What the key proves:**
- **Who had it:** the Lord, inside the lock. He unlocked it at 20:50 for Victoria, at 20:58 and 21:12 for Reginald, and at 21:15 for Victoria again.
- **Where it ends up:** Victoria locked the door from outside at 21:19 and dropped the key into the dining-room coal scuttle at 21:20.
- **What that shows:** the killer walked out of the library door and into the dining room. The dining room is the room covered by Victoria and Archibald's "mutual" alibi.

## 4. Pressured testimony (how the engine unlocks it)

Victoria's alibi is: *"Archibald and I sat by the dining-room fire through the whole blackout."* Archibald backs it up. Two people vouching for each other sounds solid. Three testimonies, each unlocked by showing evidence, break it.

| Who | Secret | Pressured by | What they then admit (fact ids) |
|---|---|---|---|
| Reginald | `s-reginald-theft`, `s-reginald-overheard` | `burned-letter` (the solicitor's line about the butler) | He was skimming the accounts and spent the blackout counting cash in the pantry, where he heard Mr Crane on the servants' telephone from 21:15 and called out to him at 21:18 (`ev-reginald-hears-phone`, `ev-pantry-exchange`). He also saw her ladyship's quarrel at 20:54: "Ten o'clock tomorrow… not a penny more" (`ev-reginald-overhears`). |
| Archibald | `s-archibald-false-alibi`, `s-archibald-embezzlement` | `library-key` (found in "his" dining room, so he now looks like an accomplice) | He left the dining room at 21:13 and phoned his broker 21:15–21:20 to move the money (`ev-archibald-leaves-dining`, `ev-archibald-phone`). **Victoria asked him at 21:40 to say they were together** (`ev-alibi-pact`). He saw the pantry candlelight and heard coins (`ev-archibald-notices-pantry`). |
| Gregory | `s-gregory-in-hall` | `muddy-footprint` | He came in by the garden door just after the quarter chime, stood in the alcove, heard a thud and saw the light under the library door dim (`ev-gregory-enters-hall`, `ev-gregory-hears-thud`). |
| Gregory | `s-gregory-saw-victoria` | `library-key` | In the lightning flash he saw **Lady Victoria** step out, lock the door, slip the key into her gown and head for the dining room (`ev-gregory-sees-victoria`, `ev-victoria-locks-door`). |

Victoria's own secrets (`s-victoria-*`) are pressured by all four clues. A confession from her is flavour only; nothing below depends on one.

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

| Who | Says (intended lie) | Why they lie | Exposed by |
|---|---|---|---|
| Victoria | "Archibald and I sat by the fire the whole blackout." | Her alibi | Reginald `ev-reginald-hears-phone` / `ev-pantry-exchange`; Archibald cracks (`ev-archibald-leaves-dining`, `ev-alibi-pact`) |
| Victoria | "Edmund must have locked himself in, he always did." | Explains the locked room | `library-key`: no key inside, so it was locked from outside. `f-lord-key-habit`: he left it in the lock *inside*. |
| Victoria | "I never set foot in the hall after nine." | Hides the 21:15–21:19 trip | Gregory `ev-gregory-sees-victoria` (after `muddy-footprint`, then `library-key`) |
| Victoria | "Our little chat at nine? The Sunday menu, darling." | Hides the motive | Reginald `ev-reginald-overhears`; `burned-letter` |
| Victoria | "I've never seen that letter." | Hides the motive and the burning | `burned-letter` found in *her* dining-room fire; Reginald saw the Lord wave it at her (`ev-reginald-overhears`) and saw it on the desk at 21:12 (`ev-candlestick-delivered`) |
| Archibald | "I was with Victoria the whole time, ask her!" | Hides the phone call and moving embezzled money | Reginald `ev-reginald-hears-phone`, `ev-pantry-exchange`; cracks on `library-key` |
| Archibald | "The row at dinner? A racehorse, old boy." | Hides the embezzlement | Reginald and Victoria heard `ev-archibald-threat` |
| Reginald | "I was in the kitchen polishing silver and heard nothing." | Hides the stolen cash in the pantry | Archibald `ev-pantry-exchange` (Reginald called out to him); cracks on `burned-letter` |
| Reginald | "Her ladyship and his lordship had a few words, nothing more." | Eavesdropping is sackable, and she is now his mistress | `burned-letter`, after which he gives `ev-reginald-overhears` in full |
| Gregory | "I was in the potting shed all night; I only came in when I heard shouting." | Fear of being blamed (sacked, muddy, near the scene) | `muddy-footprint` (`f-footprint-gregory`) |
| Gregory | "I saw nothin' in the dark, sir." | Terrified of Lady Victoria | `library-key`, after which he gives `ev-gregory-sees-victoria` |

**Honest true belief that misleads:** Reginald sincerely believes Archibald did it (`b-reginald-crane-did-it`, wrong). Archibald believes Gregory did it (`b-archibald-gregory-did-it`, wrong).

## 7. Knowledge sources (documentation only; schema gap G4)

`CharacterSchema.knownFactIds` holds ids only, with no source or confidence. The intended sources are recorded here so the engine and the prompts can adopt them once the schema supports them:

| Character | Fact | Source | Confidence |
|---|---|---|---|
| Victoria | own `loc-victoria-*`, `ev-murder`, `ev-key-hidden`, `ev-letter-burned`, `ev-victoria-*` | canonical | 1.0 |
| Victoria | `f-new-will`, `f-letter-accuses-butler` | told (the Lord at 20:50) and read (the letter) | 1.0 |
| Victoria | `ev-archibald-threat`, `f-archibald-embezzlement` | heard (dinner) | 0.9 |
| Victoria | `f-gregory-dismissed` | told (the Lord) | 1.0 |
| Reginald | `ev-reginald-overhears` | witnessed and heard, partially, through the ajar door | 0.85 |
| Reginald | `ev-reginald-hears-phone` | heard (voice through the pantry door) | 0.8 |
| Reginald | `ev-lord-relocks` | heard | 0.9 |
| Reginald | `ev-candlestick-delivered`, `ev-reginald-serves-coffee` | witnessed | 1.0 |
| Archibald | `ev-archibald-notices-pantry` | witnessed (candlelight) and heard (coins) | 0.7 |
| Archibald | `ev-pantry-exchange` | heard | 0.95 |
| Gregory | `ev-gregory-hears-thud` | heard (thud) and witnessed (light dimming) | 0.8 |
| Gregory | `ev-gregory-sees-victoria`, `ev-victoria-locks-door` | witnessed by lightning flash, about 6 m away | 0.85 (also as belief `b-gregory-it-was-her`) |
| Gregory | times relative to the hall clock's quarter chime | heard | 0.7 |

**Boundary rules enforced by `tests/cases/blackwood.test.ts`:**
- Every known fact that has a time and a place requires the knower to be in that place at that time.
- Every time-and-place fact involves only people who are present.
- Only Victoria knows `ev-murder`, `ev-key-hidden`, `ev-letter-burned` and `ev-victoria-takes-letter`.
- Explicit must-not-know lists cover facts a character was near but hidden from. For example, Victoria was in the hall at 21:19 but cannot know `ev-gregory-sees-victoria`. Reginald was in the kitchen but only *heard* the call, so he does not hold `ev-archibald-phone`.

Modelling convention: a perception across a wall or door (overhearing through a door, seeing into a room) is authored as its own fact located where the **perceiver** is, e.g. `ev-reginald-overhears` @ hall.

## 8. Schema gaps (not worked around)

| # | Where | Gap | What I did |
|---|---|---|---|
| G1 | `case.json` envelope | No case-file schema on `main` (id, title, victim, list of locations/facts). | Kept the envelope minimal (`id`, `title`, `victimId`, `locations`, `facts`), using only engine sub-schemas. The test validates it with a clearly marked **test-local provisional** wrapper. |
| G2 | `CaseSolutionSchema` | No `motive` field, so the motive can't be judged or stored server-side. | Motive exists only as world facts (`f-new-will`, `f-inheritance-motive`). Not put in the solution. |
| G3 | Victim | No victim schema. `lord-blackwood` is only an id used in facts and relationships. | `victimId` in the envelope; the test checks it doesn't collide with character ids. |
| G4 | `CharacterSchema.knownFactIds` | No per-fact **source** (witnessed/heard/told/inferred/canonical) or **confidence**. | Ids only; sources documented in §7. Low-confidence knowledge is also mirrored as a `Belief` where it was already a belief (`b-gregory-it-was-her`). |
| G5 | `PersonalitySchema` | No numeric (0–1) trait scores, only keyword `traits`. | Keywords, speech style, quirks and tells only. |
| G6 | `RelationshipSchema` | `sentiment` is −1..1, not 0–100, and a single axis (no trust/fear split). | Used −1..1 sentiment. |
| G7 | `EvidenceSchema` | No `relatedCharacterIds`. | Character links only through facts' `involvesCharacterIds`. |
| G8 | `EvidenceSchema` | No core / supporting / red-herring classification. | Documented here (§3). |
| G9 | Timeline | No timeline schema and no intervals (`from`/`to`). `FactSchema.time` is a single point. | Timeline = `Fact[]` sampled at 28 checkpoints for every suspect. Ranges such as "21:15–21:20" appear in prose only as description, and the engine does not rely on them. |
| G10 | `SecretSchema.pressuredByEvidenceIds` | No AND or ordering (Gregory should name Victoria only after admitting the footprint), and no pressure by *testimony* or facts. | Listed each secret's single strongest evidence. The ordering is documented in §4. |
| G11 | Lies / cover stories | No field for a character's intended claims or lies (`StatementSchema` is runtime, with no authored container per case). | Lies documented in §6 only. |

## 9. Decisions made without the product owner
- **Mutual alibi instead of the gramophone.** With five rooms and four clues, Victoria's "seemingly solid" alibi is Archibald vouching for her. He lies to cover his own phone call.
- **The key in the coal scuttle** (not planted on anyone). This keeps "who was in the dining room between 21:20 and 21:22" as the pivot.
- **Time of death from the candle burn** (fresh candle at 21:12, about 5 minutes burned) rather than a stopped watch, since there is no fifth clue.
- **The telephone lives in the servants' area**, so Archibald's secret call gives Reginald and Archibald interlocking but imperfect alibis.
- **Reason for Gregory's dismissal:** drinking on duty. No named off-stage characters (no solicitor or broker names).
- **`solution.json` sits in the case folder**; it must only ever be read server-side.
- **Portrait and image asset keys omitted**, because the assets don't exist on `main` yet.
