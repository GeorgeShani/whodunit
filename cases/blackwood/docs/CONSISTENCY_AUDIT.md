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

**Base.** origin/main 9aa8884, plus a read of PR #53 (`agatha/blackwood-voice`, not merged at the time of writing) for the voice pools.

**Status key:**
- **fixed (PR A)**: data fix in this PR, with a regression test.
- **queued (PR B)**: data fix written and tested on `agatha/blackwood-audit-data`. It is held because it touches `characters/*.json` or `timeline.json`, which #53 also changes. The PR opens once #53 is on main.
- **Dexter**: engine or UI work, written up below to forward.
- **decision**: needs George or Marvin.
- **accepted**: deliberate, with the reason given.

## Summary

| Severity | Count | Fixed (PR A) | Queued (PR B) | Dexter | Decision | Accepted |
|---|---|---|---|---|---|---|
| High | 1 | 1 | | (+ validator follow-up) | | |
| Medium | 7 | | 3 | 3 | 1 | |
| Low | 18 | 2 | 5 | 1 | 3 | 7 |
| **Total** | **26** | **3** | **8** | **4** | **4** | **7** |

Each finding is counted once, under its primary status. Some also carry a secondary ask, such as a validator follow-up or a decision.

## 1. Logic and fairness

### CA-01 · High · ACCUSE opened in states where the win was impossible: fixed (PR A)

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
- Mutation check: with the old gate, the search lists five bad states, including the eyewitness one.
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

### CA-05 · Medium · The murderer's loss plays a generic ending, so the shape of the loss names the killer: Dexter (E4) / decision (HOW_TO_PLAY #1, #9)

**Evidence:**
- `engine/ending-payload.ts` `lossBeats()` never plays `endings.wrong[<murderer>]`, and it strips the murderer's cameos from the other wrong endings (#22).
- So accusing Victoria plays the generic two beats ("Me? You've got it all wrong, detective!" plus "Without proof that holds up, … is sent home"). Accusing any innocent plays their authored, characterful lines.
- "Play Again" replays the same solution (HOW_TO_PLAY #9).

A returning player who sees the generic version knows they named the killer and only missed the proof. #22 meant to prevent exactly that.

There is also dead data: `endings.json` `wrong.victoria` (3 lines, the "right lady, wrong story" ending) and Victoria's six cameo lines in the other three wrong endings are never played. `SOLUTION_PROOF.md` §10 still describes `wrong.victoria` as if it were played; that doc fix rides with PR B, because #53 also edits SOLUTION_PROOF.

**Proposed fix (engine; George picks):**
- (i) Every loss plays the same generic shape. Simplest, and #22-pure.
- (ii) The murderer gets an authored loss ending that sounds exactly like an innocent's (a protest plus a narrator line), with no "right lady". The data would then need a `wrong.<murderer>` written to that brief. I would rewrite `wrong.victoria` once the rule is chosen.

### CA-06 · Low · A loss never reveals the solution: decision (HOW_TO_PLAY #9)

By design (#22). Combined with a replay of the same solution, the learning loop is: lose, then replay with meta-knowledge. Options:
- keep it;
- after a loss, offer an explicit "Show me what happened" spoiler that only ends a case that is already closed, so nothing becomes guessable.

### CA-07 · Medium · The checklist has no Leads row: Dexter (E5) (HOW_TO_PLAY #3)

`CaseNotReady.tsx` shows Clues, Suspects and Cracks, but no leads. With `closedLeadIds` unmet, every row shows ✓ and the button stays locked. CA-01 makes this more likely, because there are now two required leads.

The data mitigation in PR A is that the leads line now names both loose ends generically.

**Proposed fix:** a "Leads n/m" row (counts only, no titles).

### CA-08 · Low · Gate counts can be met with throwaway questions: accepted

Exchanges count whatever was asked, including fallback replies, and leads open on counts (HOW_TO_PLAY #11). "Hello" twice to each of three suspects meets the suspect count and opens `lead-keyhole` and `lead-letter`. This is deliberate (`SOLUTION_PROOF.md` §12.5): it keeps the game unblockable during a model outage, and the evidence and secret requirements still have to be met by real play.

### CA-09 · Low · Stress alone yields one secret: accepted

`s-victoria-left-dining` opens at stress 70. It counts towards `minRevealedSecrets`, but it is not a key testimony and does not close `lead-alibi`. Covered by the exhaustive search (CA-01).

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

The garden door, where the 21:16 print is, has no scraper, which also explains why that print exists. Gregory's voice action "drips steadily onto the carpet" is water, not mud, and stays.

### CA-11 · Low · "Dinner for four" with three diners: fixed (PR A)

**Evidence:** the dining-room `searchFlavor` said "Dinner for four" and "Still four", but only Lord Blackwood, Victoria and Archibald dined (`loc-*-2030`). Reginald served and Gregory ate in the servants' quarters. A fourth place invites an invented guest.

**Fix:** "Dinner for three" and "Still three". Tested.

### CA-12 · Low · The intro put the death "between the port and the coffee": fixed (PR A)

**Evidence:** the port was at 20:45 and the coffee at 20:58 (`ev-reginald-serves-coffee`). He was alive at 21:12 and died at 21:17.

**Fix:** "Somewhere between the coffee and the coal, Lord Blackwood was struck down in his own locked library…" The coal was ordered for 21:30. Tested.

### CA-13 · Low · The hall clock "striking" at 20:57: queued (PR B)

**Evidence:** `reginald.json`, the jab at Victoria: "You swept past me at three minutes to nine, and it was striking at the time." The grandfather clock chimes the quarters (`SOLUTION_PROOF.md` §4, "just after the quarter chime"), so nothing strikes at 20:57.

**Fix:** "…and I had glanced at the hall clock not a moment before."

### CA-14 · Low · One lightning flash shows four actions: queued (PR B)

**Evidence:** `ev-gregory-sees-victoria` and the `s-gregory-saw-victoria` card. In "a lightning flash" Gregory sees her step out, lock the door, pocket the key and walk off. A flash lasts an instant, and a player who asks "in one flash?" gets an improvised answer.

**Fix:** "in flickering lightning through the hall windows", in the fact and in the card. The guards' lightning and flash patterns still match.

### CA-15 · Medium · No canon on whether the police were telephoned: queued (PR B)

**Evidence:**
- The servants' telephone works: Archibald used it 21:15–21:20, and the Lord meant to ring the Yard at midnight (`ev-archibald-threat`).
- Nothing says whether anyone rang the police after 21:32.

"Has anyone called the police?" is one of the first questions a player asks. The model improvises either "the line is dead", which contradicts Archibald's call, or "the police are on their way", which contradicts the flooded road.

**Fix:** `ev-household-waits`, which every suspect already knows, now says Reginald telephoned the police, who cannot get through the flood before morning. No knowledge lists change.

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

### CA-22 · Medium · Cards that plainly contradict a lie but don't break it: queued (PR B)

**Evidence:**
- `l-archibald-together` ("with Victoria … until the scream") breaks only on `s-reginald-theft`. Two other cards say the opposite:
  - Gregory's eyewitness card: she was in the hall at 21:19.
  - Victoria's own `s-victoria-left-dining` card: "she left the dining room while Mr Crane was away".
- `l-victoria-letter` ("I've never seen that letter in my life") has no testimony path. Reginald's overheard card has his lordship holding the letter up at her.
- `s-victoria-left-dining` reveals on Archibald's or Reginald's card, but not on Gregory's. Gregory's card puts her outside the dining room at 21:19, a harder contradiction of "neither of us left".

**Effect:** the player presents an obvious contradiction, nothing happens, and the hint system never flags it.

**Fix:**
- `l-archibald-together.breaksOnSecretIds` += `s-gregory-saw-victoria`, `s-victoria-left-dining`.
- `l-victoria-letter.breaksOnSecretIds` = [`s-reginald-overheard`] (mode `any`).
- `s-victoria-left-dining.revealConditions.testimonyIds` += `s-gregory-saw-victoria`.

The fastest path stays 10. No card reveals core guilt.

### CA-23 · Low · No dead rooms, leads, clues or secrets: accepted (verified)

- The validator's reachability check and the CA-01 search agree: all 6 rooms, 4 clues and 9 leads open and close, and every non-core secret is reachable at zero stress apart from Victoria's stress shortcut.
- `lead-eyewitness` is a bonus lead, and `lead-motive` now has a job (CA-01).
- `f-candle-burn` is known by no character and reaches the player only on the candlestick card. That is deliberate: the time of death is deduced, not told.

### CA-24 · Low · Reginald's alibi corroboration reaches the player only through free dialogue: accepted

`SOLUTION_PROOF.md` §5.14 eliminates Reginald partly with `ev-archibald-notices-pantry` (candlelight and coins at 21:15). No testimony card carries that fact; Archibald may say it after his false alibi opens. The elimination still holds without it, because Gregory's card says it was Victoria who locked the door.

## 4. AI surface (what the model could improvise against canon)

Already covered elsewhere and not repeated here:
- times inside the murder window, the guilt check and core guilt (`SOLUTION_PROOF.md` §13);
- over-claims by innocents, and locked-secret words (`forbiddenPhrases`, #46);
- the broker fact (#53);
- canon times bound to events (`event_time`).

New in this audit:

| Risk | Where it comes from | Handling |
|---|---|---|
| An invented fourth diner | "Dinner for four" | CA-11, fixed |
| Gregory "tracking mud through the house" | CA-10 | queued |
| "The telephone is dead" or "the police are coming" | CA-15 | queued |
| Reginald carrying the key up in the coal scuttle | CA-18 | queued |
| "He was drunk, sir" | CA-21 | decision |
| The bloodied handkerchief | Victoria wiped the candlestick with her handkerchief at 21:18 (`ev-victoria-takes-letter`, core). Her always-on quirk dabs dry eyes with a lace handkerchief. A witness could invent a stain. | CA-25 below, queued |
| Two liars improvising different shared-alibi details | `l-victoria-together` and `l-archibald-together` agree on the time span but share no detail | accepted: realistic, and the claims never contradict canon. The engine cannot register a mismatch as a break, so the player can't earn anything from it either. |
| Victoria's alibi details (times, who lit the candles) | her claim, "from the moment the candles were lit until we heard the scream", matches canon at both ends | no change |
| Wrong weapon or room | the weapon and room are canon in every relevant prompt (`ev-body-discovered`) | no change |

### CA-25 · Low · The handkerchief: queued (PR B)

Each innocent gets one `forbiddenPhrases` entry: a handkerchief with blood, a stain or red on it (questions and denials pass). Victoria's own guilt check already covers "wiped … handkerchief".

### CA-26 · Low · Pocket-watch quirk shared by Archibald and Reginald: accepted

Their quirks, and both #53 voice pools, include checking a pocket watch. The two voices blur slightly, but the two actions are written differently. Kept so #53 doesn't churn. A later voice pass could swap Reginald's to the hall clock.

## 5. Engine and UI asks for Dexter (forward as written)

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
7. **E7, re-record (PR B).** PR B changes prompts (Gregory, Reginald and Victoria facts, and `ev-household-waits`, which every suspect knows), so the "replays are current" eval check goes stale for the affected scenarios. Re-recording after #53 and PR B land would need only one paid pass.

## 6. Decisions for George or Marvin

1. Confirm the gate change in CA-01 (`lead-motive` added to `closedLeadIds`).
2. CA-03: add a decoy motive for Victoria ("a loveless marriage"), or accept the one-to-one map.
3. CA-05 and CA-06: endings policy for a loss: all generic, or authored and non-confirming. And whether to offer a post-loss reveal.
4. CA-16: how the detective comes to be in the house.
5. CA-21: is Gregory sober tonight, or is a shaky witness intended?
6. PR B forces a paid replay re-record (E7). Do it together with #53's re-record if possible.
