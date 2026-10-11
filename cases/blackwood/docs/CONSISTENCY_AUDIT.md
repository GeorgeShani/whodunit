# Blackwood consistency audit (loopholes, wormholes, inconsistencies)

> **SPOILERS / SERVER-SIDE DESIGN DOC.** Do not ship to the client or feed to the model.

Scope (Marvin, relaying George, 2026-10-11): an adversarial pass over Blackwood and the rules that govern it.
- Logic and fairness: can you guess, eliminate or game your way to a win? Is the proof leap-free? Do the endings grade right?
- Consistency across `case.json`, `timeline.json`, characters, evidence, leads, solution, endings and the #53 voice pools.
- Sequence breaks.
- What the model could plausibly improvise against canon.

This audit builds on `SOLUTION_PROOF.md` and `LEAK_AUDIT.md` (leak paths, card matrix, forbidden phrases) and does not repeat them. Where a point overlaps `docs/HOW_TO_PLAY.md` "Mechanics I found ambiguous or surprising" (#54), the note number is given.

**Method.** I read every file by hand and cross-checked them. I read the engine's grading, gate, ending, hint and lead code (`engine/accusation.ts`, `accuse-handler.ts`, `accuse-schema.ts`, `progress.ts`, `ending-payload.ts`, `hints.ts`, `progression-validation.ts`) without changing it.

`tests/cases/blackwood-audit.test.ts` adds an exhaustive search of every reachable game state: searches, exchanges with exchange counts capped at 2, cracks, and stress reveals counted adversarially as available at any time. On each state it checks the gate invariants.

**Base.** origin/main 9aa8884, plus a read of PR #53 (`agatha/blackwood-voice`) for the voice pools. **Status as of 2026-10-11 evening (Tbilisi):** #53 and #55 are merged, and so are Dexter's E1 to E5 and C1 to C4. PR B is draft PR #57 (`agatha/blackwood-audit-data`, origin/main merged in). It also carries the fixes from Gremlin's r7 offline review (`/workspace/qa/r7/review.md`), CA-27 onward.

**Status key:**
- **fixed (PR #55)**: data fix in PR #55, with a regression test.
- **queued (PR B)** / **fixed (#57)**: data fix on `agatha/blackwood-audit-data`, draft PR #57, with a regression test. #53 is on main, so the original hold is lifted. #57 is now held only for George's story answers and one combined paid re-record (E7).
- **Dexter**: engine or UI work, written up below to forward.
- **decision**: needs George or Marvin.
- **accepted**: deliberate, with the reason given.

## Summary

| Severity | Count | Fixed (PR #55) | Queued (PR B) | Dexter | Decision | Accepted |
|---|---|---|---|---|---|---|
| High | 1 | 1 | | (+ validator follow-up) | | |
| Medium | 7 | | 3 | 3 | 1 | |
| Low | 18 | 2 | 5 | 1 | 3 | 7 |
| **Total** | **26** | **3** | **8** | **4** | **4** | **7** |

Each finding is counted once, under its primary status. Some also carry a secondary ask, such as a validator follow-up or a decision. Dexter's E1 to E5 are now done on main (see §5).

**Gremlin's r7 review (CA-27 to CA-40, §7):**

| Severity | Count | Fixed (#57) | Dexter | Decision / pending | Accepted |
|---|---|---|---|---|---|
| High | 1 | 1 (+ engine follow-up E8) | | | |
| Medium | 6 | 5 | 1 | | |
| Low | 7 | 5 (+ engine strings E10) | | 1 | 1 |
| **Total** | **14** | **11** | **1** | **1** | **1** |

CA-36 leaves one part accepted, and Marvin approved it: no innocent gets a stress-only crack. Reginald's card gap in CA-28 is fixed, per Marvin's decision.

## 1. Logic and fairness

### CA-01 · High · ACCUSE opened in states where the win was impossible: fixed (PR #55)

**Evidence:**
- `case.json` `accuseGate` asked for ≥3 clues, ≥3 suspects at ≥2 exchanges, ≥2 secrets and `lead-alibi` closed.
- `solution.json` needs `minKeyEvidence: 2`: both `library-key` and `burned-letter`.
- Four clues exist, so three of them (`silver-candlestick`, `muddy-footprint`, `library-key`) met the clue count without the letter.

The exhaustive search found reachable states in which the gate was open but no accusation could ever win. One of them: candlestick + footprint + key, with `s-gregory-in-hall` and `s-gregory-saw-victoria` revealed. That player holds the eyewitness who watched Lady Victoria lock the door. They pass the gate, name her correctly, and lose with "the murderer escaped" because the letter was never found. This is a lucky-loss trap rather than a lucky-win one, but it is a clear fairness break. The gate is meant to say "the case is ready", and here it said so when it wasn't.

**Fix:**
- `accuseGate.closedLeadIds` is now `["lead-alibi", "lead-motive"]`. `lead-motive` ("Who gains from his death?") is open from the start and closes on `burned-letter`. The letter needs the key, so the gate now implies both key clues. `lead-alibi` already implied a key testimony.
- `lockedLines.leads` was reworded to cover both loose ends without naming either: "Loose ends, detective. Either somebody's story hasn't been put to the test, or the why of it all is still hiding somewhere in this house."

The fastest legal path is still **10**, because the letter was already on it.

**Tests:**
- `blackwood-audit.test.ts` CA-01 checks every reachable state, with stress reveals included: an open gate now always means both key clues and a key testimony are held.
- It also replays the reported state, and asserts the path is still 10 and that the line leaks nothing.
- Mutation check: with the old gate the search finds **288** reachable states that are open but unwinnable, across **13** distinct clue and testimony combinations, including the eyewitness one. The test prints only the first five (`.slice(0, 5)`). Gremlin's r7 recount, fixed in CA-38.
- I updated the two existing tests that pinned the old gate and line.

**Decision (George):** the gate in `SOLUTION_PROOF.md` §12.3 was "the approved one". This changes it, so please confirm. The alternative is a gate field for required evidence (Dexter, E1).

### CA-02 · Medium · Proof citations can be hedged at no cost: Dexter (E2) / decision (HOW_TO_PLAY #2)

**Evidence:**
- `gradeAccusation` counts only key ids and ignores the rest.
- The form allows 5 clue citations (`MAX_ACCUSE_EVIDENCE`) and 3 testimony citations (`MAX_ACCUSE_TESTIMONY`).
- Blackwood has 4 clues and exactly 3 key testimonies.

Citing everything held always meets the key-evidence and key-testimony rules. With CA-01 fixed, every player at the gate holds both key clues and a key testimony, so "cite everything" is a guaranteed pass on proof. The proof step decides nothing. The only real choices left are murderer, weapon and motive (see CA-03 and CA-04).

**Proposed fix (engine):** make citing cost something. Options:
- (a) Fail on any cited clue that is a red herring for the accused. Each clue would carry an author-set `pointsTo`, for example the footprint pointing at Gregory.
- (b) Cap citations at `minKeyEvidence + 1` and `minKeyTestimony + 1`.
- (c) Grade the "why each clue matters" step.

(b) is the smallest change.

### CA-03 · Medium · Motives map one-to-one onto suspects: decision

**Evidence:** `case.json` `motives` are `inheritance` (Victoria), `business-ruin` (Archibald), `stolen-money` (Reginald) and `revenge` (Gregory), one each, as `SOLUTION_PROOF.md` §9 says.

Naming the killer picks the motive by elimination. "Right lady, wrong motive" happens only by blunder. Together with CA-02 and CA-04, the accusation comes down to one real choice out of four suspects.

**Proposed fix:** add one decoy motive that fits Victoria as well as the truth does. "A loveless marriage" (`freedom`) fits her `resentment: 90` and the cool marriage in her relationship note. Only the letter and the 10 o'clock signing make it inheritance. The new motive would have a spoiler-free description. I haven't changed this, because the motive list is player-facing design.

### CA-04 · Low · The weapon picker lists every clue found: Dexter (E3) (HOW_TO_PLAY #10)

**Evidence:** `validateAccusationDraft` takes the weapon from all discovered evidence ids, and the handler only checks that the weapon was discovered.

Only one of Blackwood's four clues is a weapon, so the weapon choice is a formality. The "wrong weapon" branch of "right lady, wrong story" is close to unreachable.

**Proposed fix:** an optional `weapon: true` flag on evidence, or a case-level `weaponOptions`. That allows decoy weapons in case two, such as the poker in a library fireplace. For Blackwood it can stay as it is.

### CA-05 · Medium · The murderer's loss plays a generic ending, so the shape of the loss names the killer: Dexter (E4, done) + fixed (#57, CA-31)

**Evidence:**
- `engine/ending-payload.ts` `lossBeats()` never plays `endings.wrong[<murderer>]`, and it strips the murderer's cameos from the other wrong endings (#22).
- So accusing Victoria plays the generic two beats ("Me? You've got it all wrong, detective!" plus "Without proof that holds up, … is sent home"). Accusing any innocent plays their authored, characterful lines.
- "Play Again" replays the same solution (HOW_TO_PLAY #9).

A returning player who sees the generic version knows they named the killer and only missed the proof. #22 meant to prevent exactly that.

There is also dead data: `endings.json` `wrong.victoria` (3 lines, the "right lady, wrong story" ending) and Victoria's six cameo lines in the other three wrong endings are never played. `SOLUTION_PROOF.md` §10 still describes `wrong.victoria` as if it were played; that doc fix rides with PR B, because #53 also edits SOLUTION_PROOF.

**Proposed fix (engine; George picks):**
- (i) Every loss plays the same generic shape. Simplest, and #22-pure.
- (ii) The murderer gets an authored loss ending that sounds exactly like an innocent's (a protest plus a narrator line), with no "right lady". The data would then need a `wrong.<murderer>` written to that brief. I would rewrite `wrong.victoria` once the rule is chosen.

**Update (r7).** Dexter's E4 (2fd33e4) now plays `wrong.victoria` when she is accused with the wrong story. That made its "right lady, wrong story" line a live verdict leak. CA-31 rewrites every wrong ending to one shape that gives nothing away.

### CA-06 · Low · A loss never reveals the solution: decision (HOW_TO_PLAY #9)

By design (#22). Combined with a replay of the same solution, the learning loop is: lose, then replay with meta-knowledge. Options:
- keep it;
- after a loss, offer an explicit "Show me what happened" spoiler that only ends a case that is already closed, so nothing becomes guessable.

### CA-07 · Medium · The checklist has no Leads row: Dexter (E5) (HOW_TO_PLAY #3)

`CaseNotReady.tsx` shows Clues, Suspects and Cracks, but no leads. With `closedLeadIds` unmet, every row shows ✓ and the button stays locked. CA-01 makes this more likely, because there are now two required leads.

The data mitigation in PR #55 is that the leads line now names both loose ends generically.

**Proposed fix:** a "Leads n/m" row (counts only, no titles).

### CA-08 · Low · Gate counts can be met with throwaway questions: accepted

Exchanges count whatever was asked, including fallback replies, and leads open on counts (HOW_TO_PLAY #11). "Hello" twice to each of three suspects meets the suspect count and opens `lead-keyhole` and `lead-letter`. This is deliberate (`SOLUTION_PROOF.md` §12.5): it keeps the game unblockable during a model outage, and the evidence and secret requirements still have to be met by real play.

### CA-09 · Low · Stress alone yields one secret: accepted

`s-victoria-left-dining` opens at stress 70. It counts towards `minRevealedSecrets`, but it is not a key testimony and does not close `lead-alibi`. Covered by the exhaustive search (CA-01).

Gremlin (r7 L5) adds that Victoria is the only suspect who cracks from pressure alone, so the pressure itself singles out the culprit. See CA-36 for why an innocent stress crack was tried and not kept.

## 2. Consistency

### CA-10 · Medium · Mud: Gregory walks soaked through the hall into the library, yet "no mud beyond the alcove": queued (PR B)

**Evidence:**
- `loc-gregory-2135` has him coming in through the kitchen door.
- `loc-gregory-2136` and `ev-gregory-arrives` have him reaching the library from the kitchen, soaked.
- `loc-gregory-2140` and `2145` have him in the hall.
- Against that, `f-no-mud-beyond-alcove` and the `muddy-footprint` card say there is no mud anywhere beyond the alcove, in the hall or the library.

That elimination clue proves too much. Taken literally, it says Gregory was never in the hall or library at all, which the timeline contradicts. The model can also be led to "his boots left mud all over the library".

**Fix (PR B):**
- `loc-gregory-2135` gains "scraping the mud off his boots on the scraper by the kitchen door".
- `ev-gregory-arrives` says his boots were scraped clean at the kitchen door.

The 21:16 print in the alcove was left when he came in by the garden door straight off the wet lawn, before he went back out and round to the kitchen. (An earlier draft of this note said the garden door "has no scraper". That is not in the data, so the claim is withdrawn: CA-38.) Gregory's voice action "drips steadily onto the carpet" is water, not mud, and stays. The model is now also guarded against inventing tracked mud (CA-32).

### CA-11 · Low · "Dinner for four" with three diners: fixed (PR #55)

**Evidence:** the dining-room `searchFlavor` said "Dinner for four" and "Still four", but only Lord Blackwood, Victoria and Archibald dined (`loc-*-2030`). Reginald served and Gregory ate in the servants' quarters. A fourth place invites an invented guest.

**Fix:** "Dinner for three" and "Still three". Tested.

### CA-12 · Low · The intro put the death "between the port and the coffee": fixed (PR #55)

**Evidence:** the port was at 20:45 and the coffee at 20:58 (`ev-reginald-serves-coffee`). He was alive at 21:12 and died at 21:17.

**Fix:** "Somewhere between the coffee and the coal, Lord Blackwood was struck down in his own locked library…" The coal was ordered for 21:30. Tested.

### CA-13 · Low · The hall clock "striking" at 20:57: queued (PR B)

**Evidence:** `reginald.json`, the jab at Victoria: "You swept past me at three minutes to nine, and it was striking at the time." The grandfather clock chimes the quarters (`SOLUTION_PROOF.md` §4, "just after the quarter chime"), so nothing strikes at 20:57.

**Fix:** "…and I had looked at it not a moment before." The line already opens with "I merely recall the hall clock", so "hall clock" now appears once (r7 L6).

### CA-14 · Low · One lightning flash shows four actions: queued (PR B)

**Evidence:** `ev-gregory-sees-victoria` and the `s-gregory-saw-victoria` card. In "a lightning flash" Gregory sees her step out, lock the door, pocket the key and walk off. A flash lasts an instant, and a player who asks "in one flash?" gets an improvised answer.

**Fix:** "in a lightning flash through the hall windows, and the flickers that follow it", in the fact and in the card. r7 (CA-33) carries the same wording to Gregory's 21:19 entry, his reveal directive, the eyewitness lead's closing line, the win recap and two leak-scenario expectations. The guards' lightning and flash patterns still match, and Victoria's guard still blocks all five of Gregory's flicker probes.

### CA-15 · Medium · No canon on whether the police were telephoned: queued (PR B)

**Evidence:**
- The servants' telephone works: Archibald used it 21:15–21:20, and the Lord meant to ring the Yard at midnight (`ev-archibald-threat`).
- Nothing says whether anyone rang the police after 21:32.

"Has anyone called the police?" is one of the first questions a player asks. The model improvises either "the line is dead", which contradicts Archibald's call, or "the police are on their way", which contradicts the flooded road.

**Fix:** `ev-household-waits`, which every suspect already knows, now says Reginald telephoned the police **at 21:38**, but nobody can get through the flood before morning. r7 (CA-34) adds the call itself (`ev-reginald-telephones-police`, 21:38, servants' telephone, known by Reginald) and guards against "the line is dead" and "the police are coming tonight" (CA-32).

### CA-16 · Low · Who is the detective, and how are they in a flooded house? Decision

There is no canon. Suspects asked "when did I arrive?" will improvise. George or Marvin should choose: a guest at dinner? Arrived before the road flooded? Then I add one public fact everyone knows.

### CA-17 · Low · A gardener sacked that morning is still on the estate at night: queued (PR B)

**Evidence:** `f-gregory-dismissed`. He eats supper at 20:30 and secures the greenhouse at 20:50, with no reason given.

**Fix:** "…and told him to be gone by morning." The flooded road then explains the rest. This one is a `case.json` edit, but it changes three prompts, so it rides with PR B's single re-record.

### CA-18 · Low · Two coal scuttles: queued (PR B)

**Evidence:** at 21:30 Reginald stands at the library door "with the coal scuttle" (`loc-reginald-2130`), while the key lies in "the coal scuttle beside the dining-room hearth". The model can merge them, for example saying Reginald carried the key up.

**Fix:** "with a fresh scuttle of coal from the kitchen".

### CA-19 · Low · Everyone "knows" the blackout's cause: accepted

`ev-blackout` says lightning struck the power line. Nobody indoors saw that, but it is true and harmless, and it gives the model a canon answer instead of an invented fuse-box story.

### CA-20 · Low · Reginald and Archibald cross the same dark passage a minute apart: accepted

Reginald walks back at 21:13 and is in the pantry at 21:14. Archibald crosses the hall at 21:14. `f-reginald-saw-no-one` holds, because Reginald was already below stairs. The risk is the model improvising "I followed the butler's candle". Archibald's free text is gated by his false-alibi secret until it opens, and after that a candle glimpse contradicts nothing.

### CA-21 · Low · Gregory's sobriety tonight is not canon: decision

He was sacked for drinking (`f-gregory-dismissed`), and the endings and Reginald's jab joke about gin. Nothing says whether he was sober at 21:19. The model, or another suspect, can improvise "he was drunk", which undermines the key eyewitness, or "he was sober", which may be unintended.

**Proposal:** a canon "not a drop since this morning" fact. Or decide that a shaky witness is part of the design.

## 3. Testimony edges and sequence breaks

### CA-22 · Medium · Cards that plainly contradict a lie but don't break it: queued (PR B, Archibald side) / accepted (Victoria side)

**Evidence:**
- `l-archibald-together` ("with Victoria … until the scream") breaks only on `s-reginald-theft`. Two other cards say the opposite:
  - Gregory's eyewitness card: she was in the hall at 21:19.
  - Victoria's own `s-victoria-left-dining` card: "she left the dining room while Mr Crane was away".
- `l-victoria-letter` ("I've never seen that letter in my life") has no testimony path. Reginald's overheard card has his lordship holding the letter up at her.
- `s-victoria-left-dining` reveals on Archibald's or Reginald's card, but not on Gregory's. Gregory's card puts her outside the dining room at 21:19, a harder contradiction of "neither of us left".

**Effect:** the player presents an obvious contradiction, nothing happens, and the hint system never flags it.

**Fix (Archibald side):** `l-archibald-together.breaksOnSecretIds` += `s-gregory-saw-victoria`, `s-victoria-left-dining`. The fastest path stays 10.

**Accepted (Victoria side).** These two edges stay out:
- `l-victoria-letter` breaking on Reginald's overheard card;
- `s-victoria-left-dining` revealing on Gregory's card.

The reason is #47 ("a card reveals only the secret mapped to it", `tests/engine/card-reveal.test.ts`, `blackwood-guilt.test.ts`):
- Gregory's eyewitness card shows Victoria the core-guilt moment itself. It must crack nothing of hers, so that her answer never starts from that scene.
- "Never seen that letter" needs no second route. Reginald's overheard card already reveals `s-victoria-new-will`, which supersedes `l-victoria-letter` and retires it, and so does the `burned-letter` clue. An extra break edge would add nothing. (The first version of this note said breaking it "would steer her towards the letter she burned (core)". Gremlin's r7 M4 showed that reasoning was wrong: the burning itself is revealable through the new-will secret. Only *when* she burned it, 21:20 inside the murder window, is core guilt. See CA-30.)

The cost is that those two contradictions earn the player nothing from Victoria. The cards still break `l-victoria-locked-in`, `l-victoria-never-in-hall` and `l-victoria-menu`.

### CA-23 · Low · No dead rooms, leads, clues or secrets: accepted (verified)

- The validator's reachability check and the CA-01 search agree: all 5 rooms, 4 clues and 9 leads open and close, and every non-core secret is reachable at zero stress apart from Victoria's stress shortcut.
- `lead-eyewitness` is a bonus lead, and `lead-motive` now has a job (CA-01).
- `f-candle-burn` is known by no character and reaches the player only on the candlestick card. That is deliberate: the time of death is deduced, not told.

### CA-24 · Low · Reginald's alibi corroboration reaches the player only through free dialogue: accepted

`SOLUTION_PROOF.md` §5.14 eliminates Reginald partly with `ev-archibald-notices-pantry` (candlelight and coins at 21:15). No testimony card carries that fact; Archibald may say it after his false alibi opens. The elimination still holds without it, because Gregory's card says it was Victoria who locked the door.

## 4. AI surface (what the model could improvise against canon)

Already covered elsewhere and not repeated here:
- times inside the murder window, the guilt check and core guilt (`SOLUTION_PROOF.md` §13);
- locked-secret words (`forbiddenPhrases`, #46). Innocents' over-claims were listed here as covered by #46, but Gremlin's r7 probes showed they were not: see CA-27;
- the broker fact (#53);
- canon times bound to events (`event_time`).

New in this audit:

| Risk | Where it comes from | Handling |
|---|---|---|
| An invented fourth diner | "Dinner for four" | CA-11, fixed |
| Gregory "tracking mud through the house" | CA-10 | fixed in data (#57), and guarded (CA-32) |
| "The telephone is dead" or "the police are coming" | CA-15 | fixed in data (#57), and guarded (CA-32, CA-34) |
| Reginald carrying the key up in the coal scuttle | CA-18 | fixed in data (#57), and guarded (CA-32) |
| "He was drunk, sir" | CA-21 | decision. Meanwhile Gregory may not volunteer drinking tonight (CA-32) |
| The bloodied handkerchief | Victoria wiped the candlestick with her handkerchief at 21:18 (`ev-victoria-takes-letter`, core). Her always-on quirk dabs dry eyes with a lace handkerchief. A witness could invent a stain. | CA-25 below, reworked in CA-29 |
| Spare keys, invented staff, invented rooms | none in canon | guarded (CA-32), plus the canon fact `f-household-tonight` |
| Two liars improvising different shared-alibi details | `l-victoria-together` and `l-archibald-together` agree on the time span but share no detail | accepted: realistic, and the claims never contradict canon. The engine cannot register a mismatch as a break, so the player can't earn anything from it either. |
| Victoria's alibi details (times, who lit the candles) | her claim, "from the moment the candles were lit until we heard the scream", matches canon at both ends | no change |
| Wrong weapon or room | the weapon and room are canon in every relevant prompt (`ev-body-discovered`) | no change |

### CA-25 · Low · The handkerchief: queued (PR B)

Each innocent gets one `forbiddenPhrases` entry: a handkerchief with blood, a stain or red on it (questions and denials pass). Victoria's own guilt check already covers "wiped … handkerchief". **Superseded by CA-29:** the first rule blocked tears and rouge, and it was easy to get round.

### CA-26 · Low · Pocket-watch quirk shared by Archibald and Reginald: accepted

Their quirks, and both #53 voice pools, include checking a pocket watch. The two voices blur slightly, but the two actions are written differently. Kept so #53 doesn't churn. A later voice pass could swap Reginald's to the hall clock.

## 5. Engine and UI asks for Dexter (forward as written)

**Status:** E1 (7f81e08), E2 (3e768a9, 307d09c), E3 (d16d145), E4 (2fd33e4) and E5 (2596e5e) are done on main. E6 waits on George. E7 is still open, and it is now one re-record for 69 fixtures (CA-39). E8 to E11 are new from r7.

1. **E1, validator: warn when ACCUSE can open while the win is impossible (CA-01).**
   - `progressionWarnings` should search reachable states, as `fastestPath` already does.
   - It should warn when `accuseProgress(...).unlocked` holds but the held key clues are fewer than `minKeyEvidence`, or the held key testimonies are fewer than `minKeyTestimony`.
   - Optional: an `accuseGate.evidenceIds` field (clues that must be held), so cases don't need a stand-in lead the way Blackwood now uses `lead-motive`.
   - `tests/cases/blackwood-audit.test.ts` has a working version of the search (about 1 s on Blackwood).
2. **E2, grading: hedged citations are free (CA-02, HOW_TO_PLAY #2).** `gradeAccusation` ignores non-key citations, and the limits (5 clues, 3 testimonies) are at or above Blackwood's totals, so "cite everything" always proves. The smallest fix is to cap citations at `minKeyEvidence + 1` and `minKeyTestimony + 1`. A fuller fix is to fail a clue the case marks as pointing at someone other than the accused.
3. **E3, accuse form: the weapon picker lists all found clues (CA-04, HOW_TO_PLAY #10).** Offer only evidence flagged as a weapon (`weapon: true`), or a case-level `weaponOptions`, so decoy weapons are possible.
4. **E4, endings: the murderer's loss is generic while innocents get authored lines, so the shape of the loss names the killer (CA-05, HOW_TO_PLAY #1).** `ending-payload.ts` `lossBeats()` skips `wrong[<murderer>]` and strips the murderer's cameos (#22). Make every loss the same shape: either all generic, or all authored with the murderer's entry written not to confirm. Until then, `wrong.victoria` and Victoria's cameo lines are dead data.
5. **E5, UI: no Leads row in `CaseNotReady.tsx` (CA-07, HOW_TO_PLAY #3).** Add "Leads n/m" with counts only. Blackwood now has two required leads.
6. **E6, loss reveal (CA-06, HOW_TO_PLAY #9).** If George wants it: an explicit post-loss "what happened" view, served only for a closed game.
7. **E7, re-record (PR B / #57).** #57 changes prompts. Every suspect knows `ev-household-waits` and `f-household-tonight`, so all 69 recorded Blackwood scenarios are stale. They are listed in `tools/ai-eval/pending-rerecord.json`. Two of them now *behave* differently. Under CA-28, `t-archibald-victoria-left` is a false-alibi reveal turn and `t-reginald-archibald-card` is a theft reveal turn, so their recorded replies are retried and the replays run out of recorded calls. It keeps the "replays are current" check red until the paid re-record. Do one combined pass after #57.
8. **E8, guard: generic third-person culprit-act check for non-culprit speakers (CA-27).** `ai/guilt-check.ts` `findGuiltLeak` runs its culprit-act patterns (struck, killed, the candlestick in hand, went into the library in the window, locked the door, hid the key) only with a first-person subject, and several rules return early for non-culprits (`if (!culprit) continue;`). Proposal: when the speaker is not the murderer, run the same act patterns with the subject set to the murderer's names and pronouns, "she" or "he" from the murderer's gender, contractions included (`she'd`, `she's`, `her ladyship's`). Hedged, negated and questioning lines should pass, as the first-person versions already do. A hit should be treated as an over-claim unless the act is covered by a revealed secret or a testimony card in the speaker's context. Gregory's eyewitness content is the example: it stays sayable once `s-gregory-saw-victoria` is out. Blackwood now does this by hand in data (`[r7-H1*]` entries on Reginald, Archibald and Gregory). A second case would need its own list unless the engine does it.
9. **E9, guard: the guilt-path fallback is a culprit tell (CA-37).** `ai/guard.ts` `safeDeflection`: when `reason` is `guilt_leak` or `admits_core_guilt`, the generic lines come from `DEFLECT_CALM`/`DEFLECT_RATTLED` (`ai/guilt-check.ts`), for example "You may stare at me all evening, detective. My answer is the same: no comment." The action **always** comes from `GUILT_ACTIONS_CALM`/`_RATTLED` ("smooths a sleeve with great care", "grips the back of a chair") instead of the character's own voice actions, quirks and tells. The emotion is `defensive` or `panicked`. Several guilt rules run only for the murderer, so in practice this signature, and the extra retry latency before it, shows up almost only for Victoria. Proposal: route guilt-path fallbacks through the same authored deflection and action pool as every other fallback, filtered by the existing `isSafe` check. Or give every suspect the guilt-path pool, so it can't tell them apart.
10. **E10, engine strings that contradict canon (CA-34).** The canon (`ev-household-waits`, `ev-reginald-telephones-police`) is that the servants' telephone works, Reginald rang the police at 21:38, and nobody can get through the flood before morning. Three engine lines contradict it:
    - `engine/session.ts` `CASE_CLOSED_LINE`: "The case is closed, detective. **The constable has everyone's statements**, and I've nothing more to say." No constable has arrived.
    - `engine/session.ts` `CASE_CLOSED_SEARCH_LINE`: "**The constable has sealed the house.** The case is closed, detective: there's nothing left to search."
    - `engine/accuse-handler.ts` `ACCUSE_LINES.recordDown`: "**The telephone line to the Yard is down**, detective, …" The line works.
    Suggested rewordings, case-neutral: "The case is closed, detective. Everyone has said their piece, and I've nothing more to say." / "The case is closed, detective: there's nothing left to search." / "The record can't be written up just now, detective. Your notes are safe: make your accusation again in a moment." Better still, make them case-overridable.
11. **E11, guard notes (r7, information).**
    - The `event_time` check binds a spoken time to an event by cue words. Before #57, "I rang the police at twenty to ten" (Reginald) was attributed to Archibald's call (`ev-reginald-hears-phone`) and blocked, while "I telephoned the police at a quarter to ten" passed. #57 gives the call its own canon time (21:38). The binding is still decided by the wording.
    - The "any time in context" blind spot: a canon time in the speaker's context, such as 21:15 for Reginald, lets an invented third-person claim at that time pass. CA-27 covers Blackwood's case in data.
    - `forbiddenPhrases` checks only `dialogue`, not `action`. That is fine today, but a stage direction can still carry an invented act ("glances at her blood-spotted handkerchief").
    - The Archibald speech-style line added for the breakdown eval is now redundant with C1's single outburst rule. It is harmless, and it stays until the re-record confirms C1.

## 6. Decisions for George or Marvin

1. Confirm the gate change in CA-01 (`lead-motive` added to `closedLeadIds`).
2. CA-03: add a decoy motive for Victoria ("a loveless marriage"), or accept the one-to-one map.
3. CA-05 and CA-06: endings policy for a loss: all generic, or authored and non-confirming. And whether to offer a post-loss reveal.
4. CA-16: how the detective comes to be in the house.
5. CA-21: is Gregory sober tonight, or is a shaky witness intended?
6. PR B forces a paid replay re-record (E7). Do it together with #53's re-record if possible.
7. ~~r7 (CA-28): Reginald's card gap.~~ **Decided by Marvin, 2026-10-11:** Archibald's telephone card also cracks `s-reginald-theft`. Fixed.
8. ~~r7 (CA-32): "no other servants" (`f-household-tonight`).~~ **Approved by Marvin.**
9. ~~r7 (CA-34): the police call at 21:38 on the servants' telephone.~~ **Approved by Marvin.**
10. r7 (CA-36): the new fireplace lead trigger (the candlestick found, and the dining room searched) still needs confirming. ~~Victoria as the only stress-only crack~~ is **approved by Marvin**.
11. r7 (CA-39): approve the one combined paid re-record of the 69 listed fixtures.

## 7. Gremlin's r7 offline review (CA-27 onward)

Source: `/workspace/qa/r7/review.md` (Gremlin, 2026-10-11, offline: no model calls). His probe lines are now regression tests that run the **real** guard (`prepareTurn` + `checkReply`, his harness in `tests/helpers/r7-guard.ts`):
- `tests/cases/blackwood-r7-guards.test.ts` (H1);
- `blackwood-r7-alibi.test.ts` (M1);
- `blackwood-r7-canon.test.ts` (M4, M6, L1 to L4);
- `blackwood-audit-data.test.ts` (M2);
- `blackwood-content.test.ts` (M3);
- `tests/cases/blackwood-progression.test.ts` (L5).

Every new `forbiddenPhrases` entry carries an `[r7-…]` tag in its `note`, so it can be traced. All fixes are in draft PR #57.

### CA-27 · High · Innocents could name Victoria as the killer: fixed (#57) + Dexter (E8)

**Evidence (r7 H1):** on a fresh state, all of these passed for Reginald, Archibald and Gregory:
- "She'd killed him by then", "she'd done for him", "she did him in", "her ladyship's done him in";
- "her ladyship is the one who killed him", "bashed his head in", "brained him";
- "went in to him while the lights were out", "was in with him when the candle went out", "with his lordship in the library at a quarter past nine".

After their secrets were out, these also passed:
- "slip something into her gown by the library door" (Gregory's sighting in another mouth);
- "came away from the library door with her hands shaking";
- "when the lights went out she wasn't in the dining room";
- "her voice in there, pleading, just afore the thud";
- Archibald's "at 21:21 I saw Victoria coming away from the library door".

§4 had wrongly called this "covered by #46".

**Fix (data, `[r7-H1a…i]` on all three innocents):**
- The subject group takes contractions (`she'd`, `she's`, `her ladyship's`, `had`, `has`).
- New verbs: killed, murdered, struck, brained, bashed, coshed, did/done for him, did/done him in, bashed or stove his head in, and "is/was the one who…".
- Victoria in with him in the murder window, with window times only. Reginald truly saw her in the library at 20:54.
- Her voice "in there" or "in the library" in the window, or pleading or "before the thud".
- Repeating Gregory's sighting (slipping something into her gown, coming away from the library door).
- "When the lights went out she wasn't in the dining room."

Hedges pass: "she could have…", "did she…?", "I don't think she…". Gregory's copies use `unlessRevealed: s-gregory-saw-victoria`, so his true sighting stays sayable once revealed and is blocked before. Reginald's copies exempt his true 20:54 and 20:57 sightings.

**Engine:** E8, the generic version for every case.

### CA-28 · Medium · An exposed "together" lie with the truth still locked (PR B's CA-22 regression): fixed (#57)

**Evidence (r7 M1):** after CA-22, Victoria's stress-only left-dining card (no clues needed) or Gregory's eyewitness card exposed `l-archibald-together`, but `s-archibald-false-alibi` stayed locked. His prompt had no whereabouts for 21:13–21:22 and told him to stop insisting, so he invented alibis:
- the library door was locked;
- the billiard room;
- the cellar;
- a cigar on the terrace.

The hint system and the confrontation card picker then steered players into that gap.

**Fix:**
- `s-archibald-false-alibi.revealConditions.testimonyIds` += `s-victoria-left-dining`, `s-gregory-saw-victoria`. Whatever breaks "together" now cracks the false alibi too.
- One card, one crack (#47): each card cracks one secret per suspect. Victoria's card cracks nothing else on anyone. Gregory's card cracks nothing of Victoria's, by design. The pinned map in `blackwood-guilt.test.ts` is updated.
- Archibald guards:
  - `[r7-M1a]` an invented library visit or locked door. True lines after Reginald's scream (21:30–21:31) pass.
  - `[r7-M1b]` his room, upstairs, outside for a cigar.
  - `[r7-M1c]` before the reveal: leaving the dining room, or the brandy errand he gave as his excuse.
- Invented rooms are blocked for everyone (CA-32).
- Archibald's true telephone story still passes after his reveal.
- New generic test: every card that breaks an innocent's lie must reveal a secret that supersedes it on the same exchange.

The fastest path stays 10.

**Reginald's twin gap: fixed (#57, decided by Marvin).** The generic test found one more gap: Archibald's telephone card exposed Reginald's `l-reginald-heard-nothing` while `s-reginald-theft` stayed locked. Marvin's ruling is that one card never exposes a lie while the secret behind it stays locked. So `s-reginald-theft.revealConditions.testimonyIds` = [`s-archibald-false-alibi`], alongside `burned-letter`.
- Leak scenario `reg-07-archibald-card` now expects the theft reveal. The overheard quarrel stays hidden.
- The generic test has no allow-list.
- The pinned card map in `blackwood-guilt.test.ts` gains the edge.

Knock-on effects, checked:
- The gate stays sound. The E1 validator search raises no warning. The theft is a key testimony, but `lead-alibi` was already closed by the false alibi that the card needs. The gate still needs both key clues through `lead-motive`.
- The fastest path stays **10**.
- Earlier unlock: the theft no longer needs the letter. The earliest route is now Victoria at stress 70, then her left-dining card to Archibald, then his card to Reginald, with **zero clues**. On that route Reginald's prompt gains `ev-reginald-hears-phone` (Mr Crane "moving it all before midnight") and his pantry track, while `s-archibald-embezzlement` is still locked, because it needs `library-key`. Before this change the theft implied the letter, and so the key. This is Reginald's own hearsay, which points at Archibald's red herring. It reveals nothing of Victoria's, and Archibald's own phrases stay gated. Accepted, and noted here for Marvin.
- `s-reginald-overheard` still needs `burned-letter` after the theft, so it doesn't move.

### CA-29 · Medium · The handkerchief rule blocked tears and was easy to get round: fixed (#57)

**Evidence (r7 M2):**
- CA-25's rule blocked "stained with tears", "tear-stained" and "stained with rouge". Victoria's always-on quirk is dabbing her eyes.
- It let through "red smears", "hanky … bloodied", "kerchief … blood", "crimson-spotted", "never seen so much blood as … on her handkerchief" (the stray `never` exempted it), a stain more than 40 characters away, and "something dark and wet".

**Fix (`[r7-M2]`, replaces CA-25's entry on all three innocents):**
- handkerchief, hanky, hankie or kerchief, and a blood word in either order, within about 120 characters of the same sentence;
- blood words: blood, bloodied, bloodstained, gore, crimson, scarlet, red smears, spots or stains, "was red", "dark and wet";
- bare "stained" no longer counts, so tears, rouge and sweat pass;
- a negation exempts only when it sits just before the stain word ("no blood");
- his own or another man's handkerchief is not covered.

All of Gremlin's lines are tested, both ways.

### CA-30 · Medium · The burning is sayable, but not when: fixed (#57)

**Evidence (r7 M4):**
- `s-victoria-new-will` (revealable) admits burning the letter, while `ev-letter-burned` (21:20) is core guilt.
- "I burned the letter while Archibald was away on his errand" passed. It places the burning, and so her holding the desk letter, inside 21:13–21:22.
- CA-22's reasoning for leaving `l-victoria-letter` alone contradicted the model.

**Decision taken (George):** the bare act is revealable, and *when* is core.

**Fix:**
- The new-will description, which is the reveal directive, now ends "When she burned it, and how the letter came into her hands, she will not say."
- `ev-letter-burned` stays in `s-victoria-murder.relatedFactIds` (core).
- Victoria's `[r7-M4]` guard covers "burn", "destroyed", "put/fed it to the fire" plus a time or relative anchor in either order: Archibald's errand or absence, while he was gone, while the lights were out, during the blackout, in the dark, after dinner broke up, when or after I came back, before the scream, any 21:xx or "past nine".
- CA-22's reasoning is corrected.
- The bare admission on the reveal turn passes.

### CA-31 · Medium · Loss endings confessed the accused's secret: fixed (#57)

**Evidence (r7 M3):**
- Accusing Archibald played "a perfectly routine transfer. Of all the money. Before midnight": his alibi and his embezzlement.
- Accusing Reginald played "borrowed a small amount from the household accounts": his theft.
- Accusing Gregory played "I didn't see nothin'… I mean, I didn't DO nothin'!": his sighting.
- With E4 now live, accusing Victoria played "You've found the right lady and told entirely the wrong story": the verdict itself.

Play Again keeps the solution (CA-06), so each loss eliminated or confirmed a suspect.

**Fix:** every `endings.wrong` entry is now the same shape:
- two lines, spoken by the accused only;
- pauses 1000 and 1400;
- the first line "shocked".

None of them mentions money, the telephone, the sighting, the letter, the will, the key, the library or the verdict:
- Reginald: the bent fork, then "thirty years in service… I shall see to the tea while you think again";
- Archibald: "I threaten everybody!", then his solicitors "first thing in the morning";
- Gregory: "I only came in out of the rain", then he will stand in the kitchen till somebody believes him;
- Victoria: "Accusing a grieving widow in her own hall. How terribly modern of you.", then "I shall be in the hall, being brave."

Victoria's cameo lines in the innocents' endings were never played (#22) and are removed. Tests updated: `blackwood-content.test.ts` checks the shape and the forbidden content, and `ending-sequence.test.ts` no longer pins "right lady".

### CA-32 · Medium · The AI-risk table relied on prompt wording alone: fixed (#57)

**Evidence (r7 M6):** all of these passed:
- "I tracked mud all through the hall and into the library";
- "I fetched the coal scuttle from the dining-room hearth";
- "The telephone is dead"; "the police'll be here within the hour";
- "I'd had a nip of gin in the shed";
- "a spare key on my ring";
- "the cook and the scullery maid";
- "the conservatory … the billiard room".

**Canon checked first:**
- Rooms: library, dining room, hall (with the alcove), garden (lawn, greenhouse, potting shed), kitchen and servants' quarters (pantry, servants' telephone), and bedrooms upstairs.
- No conservatory, cellar, billiard room, ballroom, terrace, drawing room or similar appears anywhere in the case data.
- No staff other than Reginald and Gregory.
- `f-library-single-key`: no spare.
- Nothing says Gregory drank tonight (CA-21 is open).

**Fix, on every suspect:**
- `[r7-M6-rooms]` invented rooms ("we have no billiard room" passes);
- `[r7-M6-staff]` invented staff ("there is no cook tonight" passes; "cooked the books" is untouched);
- `[r7-M6-spare-key]` any spare, second, duplicate or master library key (denials pass);
- `[r7-M6-mud]` mud tracked into the library, the carpet, or across or through the hall. The alcove print and Gregory's scraped boots pass;
- `[r7-M6-scuttle]` anyone carrying the dining-room scuttle;
- `[r7-M6-phone]` a dead, down or cut line, or the police on their way, tonight, within the hour or soon. "Can't come before morning" passes.

Gregory only, `[r7-M6-gin]`: volunteering that he drank tonight, in the shed or before he came in. Talking about being sacked for drink passes.

A new public fact, `f-household-tonight`, known by all four, says who is in the house and that there are no other servants. Marvin approved it.

Three filler lines in `tests/engine/confrontation.test.ts` named a cellar and a dead line. The guard now rightly rejects them, so they were reworded. That is test data, not engine code.

### CA-33 · Low · The lightning wording was only partly applied: fixed (#57)

**Evidence (r7 L1):** "a lightning flash" (singular) survived in four places: `loc-gregory-2119`, the `s-gregory-saw-victoria` description (the reveal directive), the `lead-eyewitness` closing line and the win recap.

**Fix:** all four now say a lightning flash and the flickers that follow it. Two leak-scenario `allowed` notes now use the same wording. CA-14's quoted fix is corrected, and Victoria's guard still blocks the flicker variants (tested).

### CA-34 · Low · The police call had no time or place, and three engine lines contradict it: fixed (#57) + Dexter (E10)

**Evidence (r7 L2):**
- The call had no time or place.
- "I rang the police at twenty to ten" was blocked as Archibald's call time, while "I telephoned the police at a quarter to ten" passed.
- Archibald's true "Your butler rang the police from the servants' telephone" tripped his own false-alibi phrase.

**Fix:**
- New `ev-reginald-telephones-police` (approved by Marvin): 21:38, servants' telephone, known by Reginald. It has no `locationId`, because his location checkpoints are library at 21:36 and hall at 21:40, and the place is in the statement.
- `ev-household-waits` (everyone) says "at 21:38".
- Archibald's bare "servants' telephone" rule now lets a sentence about the butler or the police through.

**Engine:** the three contradicting strings are listed in E10.

### CA-35 · Low · Reginald "did not see Victoria at all"; "the desk was bare": fixed (#57)

**Evidence (r7 L3, L4):**
- `f-reginald-saw-no-one` ended "and he did not see Victoria at all", but he saw her at 20:54 (through the ajar door), at 20:57 (she swept past him) and at 21:11 (the candles).
- The `lead-letter` hint said "By 21:32 the desk was bare", but the candlestick stood on it (`ev-body-discovered`).

**Fix:**
- "…did not see Victoria at all in that time."
- `[r7-L3]` blocks his flat "I did not see her ladyship at all this evening". A denial scoped to the blackout passes.
- The hint now reads "By 21:32 the letter was gone."

### CA-36 · Low · Meta tells: the fireplace lead, the motive list, stress: fixed (#57), part accepted

**Evidence (r7 L5):**
- `lead-fireplace` ("Her ladyship keeps eyeing the dining-room fireplace") named Victoria and opened after any two exchanges with her.
- The accuse-form motive list put the true motive first.
- Its description, "only if he died at the right moment", pointed at the 10 o'clock signing.
- Victoria is the only suspect who cracks from stress alone.

**Fix:**
- `lead-fireplace` is now "Where does the candlestick live?". The candlestick is one of a pair from the dining table (`f-weapon-origin`). It opens on evidence: `silver-candlestick` found **and** the dining room searched. The first dining-room visit nags and opens the lead, and the next visit finds the key. That keeps "first visit, no key". It names nobody, and the closing line is "The dining-room hearth gave up its first secret."
- The fastest path stays **10**.
- Motives are in neutral alphabetical order: Business ruin, Inheritance, Revenge, Stolen money. Inheritance now reads "Someone stood to gain from Lord Blackwood's fortune."
- Suspect order is alphabetical by file, which is already neutral.

**Accepted (approved by Marvin):** an innocent stress-only crack. I tried `stressThreshold: 70` on `s-gregory-in-hall`, the natural candidate. It broke Dexter's E1 invariant: a non-key secret reached by pressure counts toward `minRevealedSecrets`, so the gate could open in states with too few key testimonies to win (`tests/engine/accuse-gate-audit.test.ts`). It also changed confrontation pressure behaviour. Any innocent secret that is not key has the same problem, and a key one (Reginald's theft, Archibald's alibi) would hand out key proof for pressure. So Victoria stays the only stress crack. The mitigation is that it is not key testimony, does not close `lead-alibi`, and E1 covers it.

### CA-37 · Medium · The guilt-path fallback is a culprit tell: Dexter (E9)

**Evidence (r7 M5):** `safeDeflection` uses guilt-only line and action pools. Most guilt rules run only for the murderer. See E9.

### CA-38 · Low · Errors in this doc: fixed (#57)

- CA-23 said 6 rooms. There are 5.
- CA-01's mutation note said five bad states. There are 288, across 13 combinations.
- The base and status lines were stale.
- CA-10 relied on a garden-door "no scraper", which is not in the data. The claim is withdrawn, not added to the data.
- CA-13's jab said "hall clock" twice.

All are corrected above.

### CA-39 · Low · Eval staleness: pending (re-record needs approval)

All 69 recorded Blackwood scenarios are stale, because every suspect's prompt changed. They are listed in `tools/ai-eval/pending-rerecord.json`, so the stale-set assertion is exact. `t-archibald-victoria-left` and `t-reginald-archibald-card` also behave differently (CA-28 makes both turns reveals), so their replays run out of recorded calls. That keeps "replays are current" red until the combined paid re-record (E7). Nothing was re-recorded.

### CA-40 · Low · Reginald's overheard and theft secrets relate facts he doesn't know: accepted

`s-reginald-overheard` relates `f-new-will`, and `s-reginald-theft` relates `f-letter-accuses-butler`, but Reginald knows neither. That is intentional: he heard the quarrel but never read the letter, and the related ids exist for the card and proof cross-links. Noted in `SOLUTION_PROOF.md`.
