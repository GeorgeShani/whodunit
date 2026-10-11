# Tallyho consistency audit (case two, design stage)

| | |
|---|---|
| **Scope** | `docs/cases/TALLYHO_DESIGN.md` and `docs/CASE_TWO_IMPLEMENTATION_PLAN.md`, checked against the engine as it is on `main` (read-only; re-checked after b1ee793, 7f81e08, 307d09c, fac75ba and 43d7de8): `engine/accusation.ts`, `engine/progress.ts`, `engine/progression-validation.ts`, `engine/core-guilt.ts`, `engine/knowledge-gate.ts`, `engine/secrets.ts`, `engine/hints.ts`, `engine/confrontation.ts`, `engine/accuse-handler.ts`, `ai/guilt-check.ts`, `ai/order-check.ts`, `lib/clue-art.ts`, plus `docs/CASE_FORMAT.md`, `docs/CASE_AUTHORING.md` and the Blackwood data and docs as the reference for how the mechanics really behave. |
| **Author** | Agatha (mystery and narrative design) |
| **Status** | Docs only. **No Tallyho JSON exists or was created**; that stays on hold until George approves the plan. |
| **Method** | Adversarial: for every gate, secret, fact and line, "how does a player, or the model, get past this the wrong way?" Then "is the right way provable from what the player can see?" |
| **Result** | **78 findings: 5 critical, 23 high, 36 medium, 14 low** (T-01 to T-55 from the first pass; T-56 to T-76 from Gremlin's offline review r8; T-77 and T-78 from the engine changes now on `main`; see section 13). Five are checks that passed, recorded as evidence (T-41, T-45, T-46, T-47, T-51). **66 fixed in this PR** in design or plan text; ten of those also need a follow-up (T-38 George's OK; T-10, T-49, T-55, T-56, T-58, T-62, T-63, T-71, T-73 a Dexter engine item). **7 open:** T-30 and T-39 need George; T-37, T-40, T-54, T-57, T-75 need Dexter. Section 9 is the "Decisions needed" list, including Q3 and Q7 to Q17; section 10 the engine items. |

Severity scale: **Critical** = the case can be solved without proof, or the solution leaks, or a culprit can confess. **High** = a fair player can be blocked, misled by a contradiction, or a gate can be gamed. **Medium** = a consistency, period or AI-surface problem a careful player or the model would hit. **Low** = polish.

Status values: **Fixed (this PR)**, **Needs George**, **Needs Dexter** (engine or schema; never edited by me), **Plan** (changes `CASE_TWO_IMPLEMENTATION_PLAN.md` scope; recorded there and in section 9).

---

## 1. Summary for George (plain words)

1. **The time-of-death proof leaned on the wrong thing.** The design said the watch's smear proved he died before the 22:14 Lurch. It does not: a watch dropped into the pool *after* 22:14 would end up in the same corner. The real proof is the sea chest: it slid at 22:14 and stopped *on the body*, so the body was already there. The design now says that, everywhere (T-01, T-02).
2. **The Captain could confess in conversation.** Core guilt (the guard that stopped Victoria confessing in George's live game) only protects the *murderer*. The Captain, as the helper, had no guard. His "I played the recording" secret is now core guilt in the design, with forbidden phrases, and Dexter needs to extend the engine to cover the helper (T-10, DX1, DX2).
3. **Characters' own fact lists would have told the model the truth they lie about.** The per-minute "where was I" rows and some shared facts were open, so Zippelli's context said "in the stateroom at 21:52" from the first question. Gated now, with a rule for every shared hidden fact (T-09, T-49).
4. **A notebook lead gave away the answer.** "Who was where at the BONK?" opened at the start and named the true time. It now opens only once a witness has heard the BONK (T-05). Several locked lines and leads also named suspects; reworded (T-24, T-06).
5. **"No one helped" and the wrong helper can now be ruled out by evidence**, not by guessing: the cheer box has no timer, only two keys open the chartroom, and the other key-holder was holding the wheel with her back to the curtain (T-15, T-35, T-66). The Captain had sent the helmsman below, so there is no unquestionable eyewitness on the bridge (T-67). The roles are explained on the accuse form, so nobody loses on wording (T-38, George's OK needed).
6. **Two culprits needs a stricter win rule.** "Two testimonies" could be two about the doer. The design now requires one witness to each half (`keyTestimonyGroups`), which Dexter's plan had as optional (T-37, Q9).
7. **Period fixes for 1936:** gramophone to phonograph (wax cylinder), "soft-serve" removed, no chalk outline (no police aboard), radar, sonar, walkie-talkie, teenager banned, and the £2,000,000 offer is about £170 million today (George's call, T-30).
8. **Second round (Gremlin's offline review and the new engine features).** The stager's own facts would have named the doer (T-60); a lead hint pointed at the motive (T-61); innocents' guard phrases would have blocked lines they are meant to say (T-56); the ship's log is now the Captain's and a clue (T-65); the shadow fits two people (T-70). The accuse gate could have opened without the marmalade clue, so a player could reach a case they could not win; one more gate lead fixes it (T-77). The weapon list now shows the crock and one decoy, a jug of Orange Lightning (T-78). The fastest win is still 32 actions on today's engine.

---

## 2. Solvability from evidence alone, including the accomplice

| ID | Sev. | Evidence | Finding | Fix | Status |
|---|---|---|---|---|---|
| **T-01** | Critical | Design 0.1, 4.3, 4.5 step 3, 6.2 `marmalade-run`, 12 | The proof "the watch's smear runs to port, so it was dropped before 22:14" does not prove anything: a watch dropped into the pool at 22:41 (port list) would also skate to port. A sharp player sees the hole; a blunt one has no real proof that the time is false. | Make the **sea chest** the proof leg: it skated at the 22:14 flip and was stopped by the body (parked on the coat-tail); without a body it would be at the port wall. The pool by the starboard wall is the second leg (the jar burst during the starboard list). The watch proves only that the time was *set* (crown out). Rewritten in 0.1, 4.2, 4.3, 4.5, 6.1, 6.2, 10.1, 10.3 and 12. | Fixed (this PR) |
| **T-35** | High | Design 4.5 step 9, 6.2 `cheer-cylinder`, `f-cheer-box`, `f-chartroom-access` | Nothing in evidence ruled out "No one helped": a player could argue Zippelli set the Box going before he was sealed at 22:17. The helper was found by elimination of a hunch, not by proof. | The discovery line now says there is **no clockwork timer** (it must be started by hand), the spring is run down (it played), and the brass plate names the only two keys (Master, Chief Engineer). Period check: a wax cylinder plays two to four minutes, so it cannot "wait" 21 minutes either. The Chief Engineer is placed at the telegraph by the Captain's **own** account (`ev-bilge-sees-ottilie-2`) and hers, while he was behind the curtain (bucket bone dry). So "No one helped" and "Ottilie helped" are both eliminated by evidence. | Fixed (this PR) |
| **T-38** | High | Design 4.7; plan 3.2 | Strict roles: "Bilge did it, Zippelli helped" loses. The form never says what "did it" means for a two-culprit crime (the Captain arguably "did" the murder plan). A player who solved the case can lose on wording. | "Who did it?" gets the hint *"The one who struck the fatal blow."* and the confirm dialog spells out the roles in words. Same text in every case, so nothing is tipped off. Design 4.7 and plan 3.2 updated; the role evidence is listed in 4.7. | Fixed (this PR); **needs George's OK** (UI copy, every case) |
| **T-37** | High | Design 8.3; plan G5/Q9; `engine/accusation.ts` (`minKeyTestimony` only counts) | `minKeyTestimony: 2` from a list of four can be met by `s-boris-saw-shadows` + `s-boris-hives`, both doer-side. With strict two-culprit grading the win then rests on a helper the player cited no witness for. | Require `keyTestimonyGroups`: one from `[s-boris-saw-shadows, s-boris-hives]` and one from `[s-ottilie-curtain, s-gherkina-at-door]`. Plan Q9 now says required for Tallyho. | Plan (Q9); Needs Dexter (G5 is not built) |
| **T-39** | Medium | Design 4.7 last paragraph, 11.3 "half right"; plan Q12 | The design says "the recap may say which half was right", the plan recommends keeping half-right lines off because they leak (#22). Contradiction. | Follow the plan: **no** half-right line. A loss screen that says "you had the helper right" turns a 1-in-31 guess into two independent guesses across replays. Design wording left as "may" pending George; see D7. | Needs George (Q12) |
| **T-55** | Medium | Design 4.6, 11.2 G2; `engine/ending-payload.ts` `lossBeats` (E4, 2fd33e4: a loss plays the accused's own `wrong` entry, the real murderer's included; only the murderer's cameos are dropped from others' endings) | With two culprits, "Zippelli, no one helped" plays Zippelli's own ending and "Bilge did it" plays Bilge's. If either is written as a culprit's sneer it confirms half the answer across replays (the Q12 leak by another door). And Bilge's cameos in an innocent's ending are not dropped, because he is not `murdererId`. | Authoring rule in design 4.6: both culprits' `wrong` entries read like an innocent's exit and mention nothing of the staging. Engine: drop the accomplice's cameos too (DX11, part of G2). The plan now says the same (T-59), and since 307d09c no loss carries a rating or `sloppyRemark`, so nothing outside the ending text differs between a right-doer loss and a wrong-doer loss. | Fixed (design and plan); Needs Dexter (DX11) |
| **T-40** | Medium | `engine/hints.ts` (`hintCandidates`, `heldItemsBreak`) | Hints rank lies the player can break. With two culprits, the first hint the stuck player gets will always point at Zippelli's lies (more of them, more held clues break them), never at the stager. Fair, but it steers. | Content-side: `lead-stager` is the stager's signpost. Engine-side optional: let hints weight leads that are open and unclosed. Not needed for fairness. | Needs Dexter (optional, DX6) |
| **T-50** | Medium | Design 4.5, 9.3 | Is there a step that needs a leap? Two places came close: (a) that the cheer was a recording (now carried by `cheer-cylinder` plus two witnesses, T-15); (b) that 21:52 is the minute (Boris's shadow-play has no clock; Gherkina's timed BONK carries it, Percy's "gong" bounds it). With T-01 the chain is now leap-free; the one inference left (the watch is wrong) has a visual clue and two leads (`lead-time`, `lead-tilt`). | No change beyond T-01, T-15. Recorded as the fair-play statement. | Fixed (this PR) |

**Clean evidence chain per culprit and role (after the fixes):**

- **Doer = Zippelli.** Time: `marmalade-run` (chest on the coat-tail, pool at starboard) + `heel-chart`. Minute: `s-gherkina-recipe-buy` (timed BONK), `s-boris-saw-shadows`. Presence: `midnight-notes` (21:45 Z.) + `s-zippelli-summons`. Weapon: `crock-13` (A.Z. stamp, toupee, in his trunk). Body: `s-boris-hives` vs his allergy lie. Nobody else lacks an alibi at 21:52.
- **Helper = Bilge.** Mechanism: `cheer-cylinder` (no timer, played, switch on CHEER, dry bucket) + `s-gherkina-at-door` (the stateroom trumpet was silent) + `s-ottilie-curtain`. Who: two keys; Ottilie in view at the telegraph (his own words); he was behind the curtain. Role: he was on the bridge at 21:52 (`heel-chart`, `s-ottilie-bridge-visits`), so he is the voice, not the blow. Motive link: `route-sheet` (his course, his stores).

---

## 3. The time-misdirection and ship-list mechanics

| ID | Sev. | Evidence | Finding | Fix | Status |
|---|---|---|---|---|---|
| **T-02** | High | Design 1.4 Rule of the Slide and Rule of Sticky | Contradiction: "sticky things never move" (the watch glued in marmalade) and "the watch skated to the port corner". And if marmalade is glue, the chest could not skate across it either. | One rule: marmalade **sets** into a slick glaze (things *skate* on set marmalade), and **wet** marmalade glues (the toupee to the crock). The chest skates on the set pool and stops on the body; the watch skates loose. | Fixed (this PR) |
| **T-03** | High | Design 1.1, 3.1, `ev-great-lurch` | Physics: a single wave does not flip a steady list. As written, a "wave at 22:14" changed the list for good. | The list is wind heel. At 22:14 the Captain orders hard-a-port onto the secret course (`route-sheet` turns at 22:14), which puts the gale on the other beam; the ship lurches over and stays leaning to port. One cause, already in the plot, and it ties the Lurch to the stager's own order. | Fixed (this PR) |
| **T-21** | Medium | 6.2 `smashed-watch`, 10.3 | "Hunter-case" watch with a smashed crystal: a hunter has a lid over the glass, so a heel-stamp smashing the glass is odd, and the open lid would be the first thing anyone described. | Open-face pocket-watch; crown pulled out (set); glass heel-stamped. Period-correct: a pendant-set pocket-watch is set by pulling the crown, and pulling it does not stop it, so the smash is what stops it at 22:41. | Fixed (this PR) |
| **T-22** | Medium | 6.2 `cheer-cylinder`, `f-cheer-box`, 1.5 | "Gramophone" plays discs; a home recording from 1911 on a wax cylinder plays on a **phonograph**. Home cylinder recording was a real thing in 1911, so the device itself is period-correct. | "Phonograph" throughout; "phonograph" added to the allowed vocabulary. | Fixed (this PR) |
| **T-16** | Medium | A.1 `f-voice-horns` | The open fact described the horns *and* that a junction can switch the network to a box in the chartroom. That second half is the stager's mechanism, open to everyone from the first question. | Split: public `f-voice-horns` (the horn network exists, the Commodore's trumpet feeds it) and hidden `f-horn-junction` (the junction and the CHEER setting), gated like `f-cheer-box`. | Fixed (this PR) |
| **T-15** | High | 6.2 `cheer-cylinder` | The discovery line proved a recording existed but not that it was played tonight, by hand, or who could reach it. | Added: spring run down, no timer, brass plate with the two keys, dry bucket (see T-35). | Fixed (this PR) |
| **T-51** | Low | Design 0.1, 3.1 | Does it fool a first read? Yes: three layers (watch, ship-wide cheer, the magician's perfect alibi) all point at 22:38 to 22:41, and the only alibi-less window that matters (21:52) is not on anyone's mind until the BONK testimonies. The Lurch is felt by everyone and is public, so it is fair play, not a hidden rule. | None. | n/a (pass) |

---

## 4. Timeline, locations, period facts, the purser and knowledge gates

| ID | Sev. | Evidence | Finding | Fix | Status |
|---|---|---|---|---|---|
| **T-09** | Critical | Design 3.4 location grid; `engine/knowledge-gate.ts` (explicit mode shows any fact without `hiddenUntil`) | The 23 `loc-<char>-<HHMM>` checkpoint rows were open. Zippelli's own context therefore said "cab, 21:52" while he lies "greenroom"; Gherkina's, Percy's, Boris's and Ottilie's said where they really were while they lie. The model gets the truth in its prompt, so the lie leaks. | New 7.9 table: every row that contradicts an unbroken lie carries `hiddenUntil` on that knower's own secret and lie; Zippelli's 21:52 to 21:56 rows are in `s-zippelli-deed.relatedFactIds` (never shown). | Fixed (this PR) |
| **T-49** | Critical | `engine/knowledge-gate.ts` (a fact unhides for a knower when a listed secret is unlocked for that knower **or any listed lie is broken for its owner**); A.2 shared facts | A shared hidden fact keyed on two people's lies (`ev-recipe-sale` on Boris's and Gherkina's) unhides for **both** when **either** lie breaks. Breaking Boris's galley lie would let Gherkina's model talk about the sale. Twelve shared facts had this shape. | Rule in 7.0: one copy per knower for every hidden shared fact, each keyed on that knower's own keys only. The twelve are listed. Validator warning proposed (DX10). | Fixed (this PR, rule); Needs Dexter (DX10 warning) |
| **T-13** | High | 7.3, 7.4, 7.6 withheld lists | Facts carrying what a witness *perceived* were keyed on "secret **or** lie". Breaking `l-zippelli-greenroom` (one clue) unhid `ev-summons-card` and `ev-zippelli-admitted`, which is the summons secret's content, without the reveal. Same for Boris's shadows and Gherkina's door silence. | Perception-level facts keyed on the secret only; a broken lie with nothing behind it makes the character stonewall (the engine's rule). | Fixed (this PR) |
| **T-11** | High | 7.3 `s-zippelli-summons`, 3.5; `ai/guilt-check.ts` (`inWindow` pads the window by one minute) | Zippelli's legitimate admission said he left "at 21:51". The core-guilt window is 21:52 to 21:56, padded to 21:51, so the guilt check would reject the reveal, retry, fall back: the reveal never commits and `crock-13` (gated on it) is soft-locked. | "Ten to ten" (21:50) everywhere in his claim and summary; core-guilt `relatedFactIds` kept narrow (no 21:09 to 21:50 planning facts in the window). | Fixed (this PR) |
| **T-12** | High | A.2 `ev-zippelli-returns`; 7.3 | Carrying the crock back to the trunk at 21:59 was keyed on `s-zippelli-smuggling`, so the smuggling reveal would let him say he carried the weapon away. | Keyed on `s-zippelli-deed` (never in play); summary no longer says "crock 13". | Fixed (this PR) |
| **T-14** | High | 7.7 `s-ottilie-bridge-visits`, 7.2, A.2 `ev-bilge-sees-ottilie-2` | Contradiction: Ottilie's testimony said the Captain was "beside her both times", but at 22:38 he is behind the chartroom curtain, which is her other key testimony. | First visit: beside her. Second: he drew the curtain at 22:36 and came out at 22:40; she was at the telegraph. Bilge sees her as he goes in and as he comes out, never during. Behind the curtain neither sees the other. | Fixed (this PR) |
| **T-28** | Medium | Design 1.1 | The detective's own evening was undefined. The model could improvise "you were in the saloon, detective, you heard it too", which makes the player a witness to the staged cheer and lets suspects argue with the player's memory. | The detective boarded as the Commodore's guest, was seasick in a guest cabin forward from 21:30, and was fetched by the purser at 23:05. Knows nothing first-hand. | Fixed (this PR) |
| **T-29** | Medium | 1.6 purser | "The ship's log" is the Captain's (the stager's) document, not the purser's; "sealed the ship" is beyond a purser's authority at sea. | The purser keeps the passenger list and purser's book, and locked the doors below decks on the Captain's say-so. He is offstage and knows nothing about the night. | Fixed (this PR) |
| **T-31** | Medium | A.1 `f-commodore-schedule` | The schedule fact told Bilge (and the model) about Gherkina's 22:30 appointment, which is her secret's content. | Trimmed to what Bilge was told: Z. at 21:45, himself at 23:30, midnight the Announcement. | Fixed (this PR) |
| **T-18** | Medium | 7.4 open knowledge | Gherkina's open knowledge said she heard the cheer, but at 22:38 she was at the stateroom door hearing silence from the trumpet while the corridor horn bellowed. An open "I heard the cheer" makes her model describe it from the saloon. | Removed from open knowledge; it lives only in hidden `ev-door-silence`. | Fixed (this PR) |
| **T-19** | Medium | 7.4 `s-gherkina-at-door`, `ev-door-silence` | Her summary said "heard nothing", which is wrong (the corridor horn was deafening). | "The corridor horn bellowed the cheer above her head, but behind the door: no trumpet, no footsteps, nothing." | Fixed (this PR) |
| **T-20** | Medium | 7.6 `s-boris-saw-shadows` | The summary said "a tall thin man", which narrows it to Zippelli and Bilge by gender and build in public card text. | "A tall thin shadow with windmilling arms", plus "he could not see faces". | Fixed (this PR) |
| **T-17** | Medium | 6.2 `turnip-recipe` | The recipe card bought by Gherkina is found in Boris's drawer. | Boris keeps his own working copy; her signed note of sale is stapled to it. | Fixed (this PR) |
| **T-44** | Medium | 12, `f-zippelli-allergy` | If he is allergic, how did he build false bottoms into marmalade crocks? | He builds them into empty crocks, in gloves, before the Captain's stores fill them. The one time he grabbed a full sticky crock bare-handed was 21:52, hence the hives. | Fixed (this PR) |
| **T-30** | Low | 1.3 Gherkina, `f-pickle-offer` | A £2,000,000 offer in 1936 is about £170 million today. Fine as a cartoon, but the rest of the case is careful about the period, and £500 for the recipe sits next to it. | Option: £200,000 (still enormous). Keep as is if George prefers the cartoon scale. | Needs George |
| **T-33** | Low | 10.1, 10.2, 10.3 | "Chalk outline" (no police aboard; also not period practice) and "soft-serve" (a later coinage). | Removed; "soft-serve" is now an authoring no-no in 1.5. | Fixed (this PR) |
| **T-34** | Low | 1.5 banned words | Words the model is likely to reach for on a 1936 ship were not banned. | Added radar, sonar, cassette, walkie-talkie, teenager. | Fixed (this PR) |
| **T-52** | Low | Design 1.1 port time | "Makes port at dawn" clashed with the dawn lugger rendezvous off Cape Kipper. | "In the morning". | Fixed (this PR) |

**Per-suspect knowledge gates, verified after the fixes** (who could know what, and when): Bilge cannot speak of the Cheer-Box until his owner-cheer lie breaks, and never of playing it; Zippelli cannot place himself in the stateroom until `s-zippelli-summons` and never at 21:52; Gherkina's boat deck, BONK, invitation and door each wait on her own secrets; Percy's goat and the will on hers; Boris's sale, shadows and the hives on his; Ottilie's trips, curtain and still on hers. Everybody felt the Lurch (public). Nobody but Percy saw the room before 23:01. The purser and the detective know nothing first-hand.

---

## 5. Contradictions, red herrings, dead or unreachable content

| ID | Sev. | Evidence | Finding | Fix | Status |
|---|---|---|---|---|---|
| **T-04** | Medium | Design 12 "all pass" | Section 12 claimed every check passed; T-01, T-09, T-49 show it did not. | Marked "superseded in part" with pointers. | Fixed (this PR) |
| **T-27** | Low | 5.1 `grudge` | The id said "grudge", the label "The insult"; the decoy text says "spite". | Label "The insult" kept, id `grudge` stays (ids are not shown). One public word. | Fixed (this PR) |
| **T-45** | Medium | 5.2, 6.3 red herrings | Do red herrings prove too much? Ottilie's still and her spare key make her the strongest wrong helper; she is resolved by evidence (heel-chart marks, at the telegraph in view, T-35). Percy's motive (the will) is real and stays real; her alibi is the goat. Gherkina is a witness to both halves, so she is never just a red herring. None proves the innocent *innocent* without the alibi chain, which is the intended difficulty. | No change. | n/a (pass) |
| **T-46** | Low | 6.1 `orange-lightning`, `s-ottilie-still` | `orange-lightning` cracks only `s-ottilie-still` (harmless, stress route too) and the gate lets the player skip it. Not dead: it closes `lead-smell` and explains the orange smell. | Keep; it is the "skip one" clue `minEvidence: 8` allows. | n/a (pass) |
| **T-47** | Low | 8.1 leads, 9.1 | Every location, clue, lead and the 13 revealable secrets reach a fixed point from empty (re-checked by hand after the gate changes). The two core-guilt secrets are unreachable by design and are not on the proof path, in key testimony or needed by the gate. | None. | n/a (pass) |

---

## 6. Sequence breaks and gaming the gate, hints, leads and cards

| ID | Sev. | Evidence | Finding | Fix | Status |
|---|---|---|---|---|---|
| **T-05** | Critical | 8.1 `lead-alibi` | The gate lead "Who was where at 21:52?" opened at the start. The notebook told the player the true minute before any clue, which defeats the whole misdirection. | Retitled "Who was where at the BONK?", hint without a time, opens when the first BONK witness (`s-gherkina-recipe-buy`, `s-boris-saw-shadows` or `s-percy-goat`) is revealed. | Fixed (this PR) |
| **T-06** | Medium | 2 locked lines (`marmalade-run`, `engine-room`, `cheer-cylinder`) | Locked lines named "ten to ten", Ottilie, "the Captain's alcove". Public text before the clue. | Reworded with no time and no suspect. | Fixed (this PR) |
| **T-24** | High | 2, 6.2, 8.1 public strings | Leads, locked lines and discovery lines named suspects: `lead-boat-deck` named Percy, `lead-crock13` "the Captain's stores", `lead-tilt` "the ship's engineer", the route sheet "A.Z. trunk", the `engine-room` and `cheer-cylinder` locked lines Ottilie and the Captain. Blackwood's test "public flavour never names a suspect" would fail. | Rewritten neutrally. Initials stay only on the clue object itself where the deduction needs them (the A.Z. stamp on the crock, the G. P.-P. signature on the receipt). | Fixed (this PR) |
| **T-07** | High | 6.1 `route-sheet` | The route sheet (the motive) was gated only on `midnight-notes` and the bridge (Bilge ×2): a player could read the smuggling plan in about five actions, before knowing anything was wrong. Its "A.Z. trunk" named the doer's trunk on a clue the stager owns, which made the trunk search a formality. | Needs `midnight-notes` found and Boris ×2 (he says the crocks come from the Captain's stores); "collect from the wings" replaces "for Z.". | Fixed (this PR) |
| **T-08** | High | 6.1 `crock-13` | The weapon opened on `route-sheet` alone; with T-07 it could still come before the player knew Zippelli was summoned, so it read as "random trunk search finds murder weapon". | Needs `route-sheet` found **and** `s-zippelli-summons` revealed. Fastest path re-sequenced (9.5). | Fixed (this PR) |
| **T-36** | High | Plan F7, Q3; `engine/interrogation.ts` `commitTurn`; `engine/confrontation.ts` | A confrontation exchange bumps `interrogationCount` for **both** suspects. The talk gate (6 × 4) can be half met by confrontations: my hand estimate drops the floor from 32 to **about 26**. `fastestPath` does not model confrontations, so the validator would print 32. | See Q3 (section 9). Recommendation: count one side only (the addressed suspect). **Update:** done on `main` (DX8, fac75ba): only the addressed suspect is credited and `fastestPath` models confrontations. Tallyho's floor rechecked: 32 (T-62). | Fixed (DX8 on `main`) |
| **T-41** | Medium | 9.4; `engine/accuse-handler.ts` | Gaming by citation: the handler rejects undiscovered evidence and unrevealed testimony, so a player cannot cite what they have not found. Blind guessing past the gate is about 1 in 430 (36 culprit answers × 2 marked weapons × 6 motives; the earlier "31 pairs × 9 weapons, 1 in 1,700" miscounted the helper answers and predates the weapon flag, T-63, T-78). With T-37 the testimony half needs one witness per culprit. | None beyond T-37. | n/a (pass) |
| **T-42** | Medium | Plan F12, E15, 3.7 G4, 4.4, Appendix | Stale plan facts that would mislead a reader: the clue-art resolver and testimony-triggered reveals are already built; the purser and 1936 date are already in the design; Tallyho's order landmarks are in design 3.6 (eight), not the plan's four. | Corrected in the plan (see section 8). | Fixed (this PR) |

---

## 7. AI improvisation risks, core guilt and forbidden phrases

### 7.1 Findings

| ID | Sev. | Evidence | Finding | Fix | Status |
|---|---|---|---|---|---|
| **T-10** | Critical | 7.2 `s-bilge-cheer`, 11.3; `engine/core-guilt.ts` (`derivedCoreGuilt` and `guiltProfile` read only `murdererId`; the validator warns on `coreGuilt` elsewhere) | The stager's confession was a revealable secret with a stress route. Nothing in the engine stops the Captain saying "I played the recording at 22:38" in the middle of play, which is half the solution. | `s-bilge-cheer` and `s-zippelli-deed` are both `coreGuilt: true`, no reveal conditions, no testimony summary. 13 revealable secrets; `minRevealedSecrets: 10`. Until the engine covers the accomplice, Bilge's forbidden phrases (7.3) carry it. | Fixed (design); **Needs Dexter** (DX1, DX2) |
| **T-25** | High | 1.2 aliases; `engine/core-guilt.ts` `victimNames` | Multi-word aliases are split into words of four letters or more: "the Marmalade King" makes "marmalade" and "king" victim names. Zippelli saying "Zippelli went down to the marmalade stores" then reads as "went to the victim". | Alias dropped until DX3; stays in his bio. **Update:** DX3 is on `main` (b1ee793): "marmalade" and "king" are on the engine's common-words stoplist, so the alias is restored (design 1.2). | Fixed (design; DX3 done) |
| **T-53** | Medium | `engine/core-guilt.ts` `victimNames` | Same splitting makes **"brine"** a victim name (from "Commodore Barnabas 'Barnacle' Brine"), and Brine is also the brand on every crock, Percy's surname and the cheer ("SPREAD THE BRINE"). Low risk (it only matters inside Zippelli's admission patterns), but it is the case's most common word. | Covered by DX3's stoplist (on `main`, b1ee793): "brine" is on it. **Decided:** Tallyho's `guiltCheck` is `{ "ignoreNameTokens": [], "keepNameTokens": [] }`. "brine" is deliberately **not** kept, since a bare "Brine" is the brand, Percy's surname or the cheer far more often than the victim; full names ("Commodore Brine") still count. "barnabas", "barnacle", "stateroom" and "crock" count; "deck", "cabin", "bridge", "saloon", "commodore", "uncle", "marmalade", "king" are already stoplisted, so nothing is added to `ignoreNameTokens` (design 1.2). | Fixed (design; DX3 done) |
| **T-48** | High | 2 `cabin-deck` name; `core-guilt.ts` `nouns()` (full name plus the last word) | Location name "The Cabin Deck" makes "deck" a scene word for the murderer, and the boat deck, the saloon deck and "on deck" are everywhere in Zippelli's alibi talk. | Location named "The Cabin Deck and Stateroom", so the scene words are "cabin deck and stateroom" and "stateroom". | Fixed (this PR) |
| **T-23** | Medium | 2, 6.2, 6.3 | "Bilge pump house" contains the Captain's name; alias matching and the model will both treat it as him. | "Pump house" everywhere; collision rule added in 1.3. | Fixed (this PR) |
| **T-26** | Low | 1.3 aliases | The Commodore calls Gherkina "Pratt" in his notes; without the alias the model may not resolve it. | "Pratt" added. | Fixed (this PR) |
| **T-32** | Medium | 3.6 `body` landmark `fact` regex | The `body` landmark's fact pattern matched "body" in any sentence ("the body of the ship"), which anchors the wrong minute in `landmarksOf`. | Tightened to `\\bfinds the Commodore dead\\b`, the discovery event's own wording. | Fixed (this PR) |
| **T-43** | Medium | All six characters | Tallyho had no forbidden phrases. Blackwood needed 71 to stop over-claims and confessions. | Proposed set in 7.3 below (Blackwood style). The build copies them into `characters/*.json`. | Fixed (this PR, as design text) |
| **T-54** | Medium | 3.6, `ai/order-check.ts` (`ABSENCE`/`MOVEMENT` lists are hard-coded English for Blackwood) | The order check's movement words ("went", "left") fit a manor; a ship has "went below", "came up on deck", "turned in", "went aft". Without them the check is weaker for Tallyho. | Per-case lists (DX5); listed in plan phase 3. | Plan; Needs Dexter (DX5) |

### 7.2 Guilt facts that must be core guilt

| Culprit | Core-guilt secret | `relatedFactIds` (kept narrow) | Never revealable, also hidden by `hiddenUntil` on the core secret |
|---|---|---|---|
| Zippelli (doer) | `s-zippelli-deed` | `ev-bonk`, `ev-watch-staged`, `ev-zippelli-leaves`, `loc-zippelli-2152`, `-2155`, `-2156` (window 21:52 to 21:56) | `ev-plan-call`, `ev-plan-meeting`, `ev-zippelli-returns`, the 21:52 to 21:56 checkpoint rows |
| Bilge (stager) | `s-bilge-cheer` | `ev-cheer-played` (22:38) | `ev-plan-call`, `ev-plan-meeting`, `f-commodore-schedule` (his copy) |

Not core guilt, on purpose: `s-zippelli-summons` (being there at 21:45 to 21:50 is the clue, not the deed), `s-zippelli-smuggling` and `s-bilge-smuggling` (the motive, needed for `lead-motive`). No other Zippelli secret may list a fact that covers 21:52, or `derivedCoreGuilt` silently makes it core guilt too.

### 7.3 Proposed `forbiddenPhrases` (Blackwood style)

Format as in `docs/CASE_FORMAT.md`: `{ text, regex?, unlessRevealed?, note? }`, plus `unlessBroken` (lie ids) and array-valued `unlessRevealed` once DX7 lands (required since r8, T-56; until then a phrase with two keys is authored as two phrases, one per key, which is weaker); plain text matches whole words ignoring case; regex uses `RegExp(p, 'i')`. The negation and question guards follow Archibald's entries (`(?<!(?:\bnever|\bnot|n['’]t)\s+)` before, `(?![^.!?]*\?)` after). Shorthand below: `NEG` = that look-behind, `NOQ` = that look-ahead, `ZIP` = `(?:Zippelli|the\s+Great\s+Zippelli|Amadeo|the\s+magician|the\s+maestro)` (bare `he` dropped, T-72: it fired on every \"he\"; pronouns are the guilt check's job). The build expands them. Time landmarks: `T2152` = `\b(?:21[:.]5[2-6]|nine\s*fifty[-\s]?(?:two|three|four|five|six)|(?:eight|seven|six|five|four)\s+minutes\s+to\s+ten|(?:fifty[-\s]?(?:two|three|four|five|six))\s+minutes\s+past\s+nine)\b`, `T2238` = `\b(?:22[:.]3[6-9]|ten\s*thirty[-\s]?(?:six|seven|eight|nine)|(?:twenty[-\s]?(?:four|three|two|one))\s+minutes\s+to\s+eleven)\b` (T-71: every minute the digits cover now has its word forms; DX15 generates them).

**Bilge (stager)**

| text | regex | unlessRevealed | note |
|---|---|---|---|
| `NEG\bI\s+(?:played\|started\|wound\|cranked\|set\s+off\|put\s+on)\b[^.!?]{0,40}\b(?:cheer\|cylinder\|Cheer-Box\|box\|recording\|phonograph)\b NOQ` | yes | none (core guilt) | The stager's confession. Never in play (DX2 until it lands). |
| `NEG\bI\s+(?:threw\|flipped\|turned\|switched)\b[^.!?]{0,30}\b(?:switch\|junction)\b` | yes | none | The junction switch. |
| `\b(?:recording\|recorded\|cylinder\|phonograph)\b[^.!?]{0,40}T2238` | yes | none | "a recording at 22:38" from him. Innocents may say it after their own reveals; he never does. |
| `\b(?:lugger\|Cape\s+Kipper\|rendezvous)\b` | yes | `s-bilge-smuggling` | Course secret. |
| `\b(?:gold\|sovereigns\|false\s+bottom)\b` | yes | `s-bilge-smuggling` | Smuggling content. |
| `NEG\b(?:I\|we)\b[^.!?]{0,30}\b(?:planned\|arranged\|agreed)\b[^.!?]{0,40}\b(?:Zippelli\|the\s+magician\|Amadeo)\b` | yes | none | The 21:15 plan meeting. |
| `\b(?:Zippelli\|the\s+magician\|Amadeo)\b[^.!?]{0,60}\b(?:cargo\|crocks?\|trunk\|sovereigns\|gold\|lugger)\b\|\b(?:cargo\|crocks?\|trunk\|sovereigns\|gold\|lugger)\b[^.!?]{0,60}\b(?:Zippelli\|the\s+magician\|Amadeo)\b` | yes | none | Never names his partner in the cargo sense, even after `s-bilge-smuggling` (T-60). |
| `Cheer-Box` | no | none (the key is a lie, `l-bilge-owner-cheer`, and `unlessRevealed` takes secrets only) | Stops him volunteering the Box; `hiddenUntil` on `f-cheer-box` does the rest. Use `unlessBroken: ["l-bilge-owner-cheer"]` once DX7 lands, so he can grumble about it once the cylinder is found. |

**Zippelli (doer)**

| text | regex | unlessRevealed | note |
|---|---|---|---|
| `NEG\b(?:I\|Zippelli)\b[^.!?]{0,30}\b(?:bonk(?:ed)?\|conk(?:ed)?\|bop(?:ped)?\|biff(?:ed)?\|thump(?:ed)?\|knocked\s+(?:him\s+)?out\|laid\s+(?:him\s+)?out\|struck\|hit\|brained\|clobbered\|swung)\b NOQ` | yes | none | First and third person (he speaks of himself as Zippelli; the guilt check handles third-person self-naming, this is belt and braces). |
| `\b(?:I\|Zippelli)\b[^.!?]{0,40}\b(?:set\|wound\|changed\|smashed)\b[^.!?]{0,20}\bwatch\b` | yes | none | The watch staging. |
| `\b(?:I\|Zippelli)\b[^.!?]{0,40}\b(?:stateroom\|cabin)\b[^.!?]{0,40}T2152` | yes | none | In the stateroom at 21:52 to 21:56. |
| `\b(?:stateroom\|the\s+Commodore['’]s\s+(?:cabin\|door))\b` | yes | `s-zippelli-summons` | Before the summons he never admits being below the saloon deck. |
| `\b(?:false\s+(?:wall\|bottom)s?\|sovereigns\|gold)\b` | yes | `s-zippelli-smuggling` | Trunk content. |
| `\bcrock\s*(?:13\|thirteen)\b\|\bnumber\s+thirteen\b\|\bthe\s+heavy\s+one\b` | yes | none | The weapon's name in the culprit's mouth, never (T-12, T-57). |
| `\b(?:I\|Zippelli)\b[^.!?]{0,40}\b(?:swung\|lifted\|seized\|picked\s+up\|carried)\b[^.!?]{0,30}\bcrocks?\b` | yes | none | Handling the weapon (T-57); "the crocks" as cargo stays sayable after `s-zippelli-smuggling`. |
| `\b(?:the\s+Captain\|Captain\s+Bilge\|Bilge)\b[^.!?]{0,60}\b(?:cargo\|crocks?\|lugger\|Cape\s+Kipper\|course\|expose[sd]?)\b` | yes | none | The doer never names his partner in the smuggling (T-60, the reverse of Bilge's guard). |
| `\b(?:planned\|arranged)\b[^.!?]{0,40}\b(?:cheer\|Captain\|recording)\b` | yes | none | The staging plan. |

**Gherkina, Percy, Boris, Ottilie (innocents; over-claim guards, as Blackwood #46)**

| Who | text | regex | unlessRevealed | note |
|---|---|---|---|---|
| all four | `NEG\b(?:saw\|seen\|watched\|witnessed)\s+ZIP[\s,]+(?:\w+[\s,]+){0,2}?(?:strike\|hit\|bonk\|swing\|kill)` NOQ | yes | none | Nobody saw a face at 21:52. Boris saw shadows. |
| all four | `\bit\s+(?:was\|were)\s+(?:Zippelli\|the\s+magician\|the\s+Captain\|Captain\s+Bilge)\s+(?:who\|that)\b` | yes | none | Asserting a culprit. May suspect, not assert. |
| all four | `\b(?:the\s+Captain\|Captain\s+Bilge\|Bilge)\b[^.!?]{0,20}\b(?:played\|started\|wound(?:\s+up)?\|cranked\|set\s+off\|tested\|testing)\b[^.!?]{0,30}\b(?:cheer\|cylinder\|recording\|box\|Cheer-Box\|phonograph)\b` | yes | none (Ottilie's belief no longer says it, T-68) | Ottilie heard a click behind a curtain; she did not see him play it. |
| Boris | `\b(?:Zippelli\|the\s+magician\|Amadeo)\b[^.!?]{0,60}\b(?:shadow\|silhouette\|porthole\|curtain)\b` | yes | none | His shadow-play must never get a name (11.3). |
| Boris | `\b(?:sold\|sell\|sells\|selling)\b[^.!?]{0,30}\brecipe\b` | yes | `s-boris-recipe-sale`; `unlessBroken: l-boris-galley` (DX7; `ev-recipe-sale` is visible once that lie breaks) | Stemmed (T-56: \"I sold the recipe\" vs the statement's \"sells\"). |
| Boris | `\b(?:shadows?\|silhouettes?)\b` | yes | `s-boris-saw-shadows` | |
| Gherkina | `\bbonk\b[^.!?]{0,40}T2152\|T2152[^.!?]{0,40}\bbonk\b` | yes | `s-gherkina-recipe-buy` | The timed BONK. |
| Gherkina | `\b(?:knock(?:s\|ed\|ing)?\|st(?:oo\|an)ds?\|stood\|wait(?:s\|ed\|ing)?\|listen(?:s\|ed\|ing)?)\b[^.!?]{0,40}\b(?:door\|stateroom)\b` | yes | `s-gherkina-at-door` | Stemmed (T-56). |
| Gherkina | `\bturnips?\b` | yes | `s-gherkina-recipe-buy` | |
| Percy | `\b(?:I\|we)\b[^.!?]{0,30}\b(?:hid\|hide\|hiding\|kept\|keeping\|smuggled\|fed\|feeding)\b[^.!?]{0,30}\b(?:goat\|Duchess)\b\|\b(?:goat\|Duchess)\b[^.!?]{0,30}\bin\s+the\s+lifeboat\b` | yes | `s-percy-goat`; `unlessBroken: l-percy-cabin` (DX7) | The guilty claim, not the bare words (T-56: bare `goat` fought the open `ev-percy-returns`, now reworded, T-69). |
| Percy | `\bnew\s+will\b` | yes | `s-percy-new-will` | |
| Ottilie | `\b(?:a\|my\|the\|her)\s+still\b\|\bOrange\s+Lightning\b` | yes | `s-ottilie-still` | The noun only, never the adverb "still". |
| Ottilie | `\b(?:I\|me)\b[^.!?]{0,30}\b(?:left\s+(?:my\s+)?post\|went\s+up\s+to\s+the\s+bridge\|on\s+the\s+bridge\|took\s+the\s+wheel\|held\s+the\s+wheel)\b` | yes | `s-ottilie-bridge-visits`; `unlessBroken: l-ottilie-engine` (DX7) | First person only, so she can say the Captain was on the bridge (T-56, T-64). |
| Ottilie | `\b(?:click(?:ed)?\|hiss(?:ed)?\|whirr(?:ed)?)\b\|\bbehind\s+the\s+curtain\b` | yes | `s-ottilie-curtain` | Bare `curtain` dropped: the bridge has one in plain view, and her bridge-visits secret no longer mentions it (T-56). |
| all six | `\b(?:radar\|sonar\|walkie-talkie\|teenager\|soft-serve\|intercom\|loudspeaker\|tape\s+recorder\|nylon\|ballpoint\|biro\|Dramamine\|serial\s+killer\|smoking\s+gun)\b` | yes | none | Period, on top of `vocabulary.banned` (T-73; \"okay\" un-banned as period-correct). |

**The validator's guard on these** (DX10): an `unlessRevealed: S` phrase must not match a fact the same character can see while S is still locked, which is exactly the Blackwood "broker" bug. Checked by hand for the table above against the withheld lists in design 7.2 to 7.7: no hit after T-13 and T-31. **r8 correction (T-56):** that check compared phrases with the authored statement text only, and models paraphrase; the phrases above are now stemmed, phrased as the guilty claim rather than a bare noun, and keyed on the lie as well as the secret where a lie break makes the subject admissible. V36 (plan) runs them over paraphrases at every reveal stage.

---

## 8. What changed in this PR

**`docs/cases/TALLYHO_DESIGN.md`:** status line; 0.1 twist; 1.1 (port time, the Lurch cause, the detective's evening); 1.2 victim aliases; 1.3 aliases and collision rules; 1.4 physics rules; 1.5 vocabulary; 1.6 purser; 2 (location name, gates, locked lines, pump house); 3.1, 3.3, 3.5, 3.6 (`body` landmark); 4.2, 4.3, 4.5, 4.7 (role wording); 5.1; 6.1, 6.2 (seven discovery lines), 6.3; 7.0 (four new rules), 7.1 to 7.7 (core guilt, gates, summaries), 7.8 counts, new 7.9 checkpoint gating; 8.1 leads, 8.2 diagram, 8.3 gate values and `keyTestimonyGroups`; 9.1, 9.2, 9.5 (fastest path re-sequenced, still 32), 9.6; 10 art notes; 11.3; 12; A.1 (`f-voice-horns` split, `f-horn-junction`, `f-commodore-schedule`); A.2 gates and wording. Each change carries its finding id.

**Second round (r8 and `main` engine changes):** see section 13; every change carries T-56 to T-78. Plan: F3, F7, 3.2 (loss endings, stored-win replay), 3.9 (DX3 done, DX7 and DX12 to DX18, the engine changes on `main`), V10, V35 to V37, Q3, R5, R20, the test matrix.

**`docs/CASE_TWO_IMPLEMENTATION_PLAN.md`:** status line; F12 and E15 (clue art is built); 3.2 role wording; 3.4 frame paths; 3.7 testimony-triggered reveals built; new **3.9** (core guilt and the guilt check with two culprits, DX1 to DX4, DX10); 4.4 (clue art, purser, landmarks pointer); V33, V34; phase 3 and phase 5 contents and the commit total; Q9, Q10 notes and a pointer to this audit; R20.

---

## 9. Decisions needed

### 9.1 Items that change the implementation plan or need George

| # | Decision | Recommendation | Who | Plan impact |
|---|---|---|---|---|
| **D1** | Core guilt and the guilt-leak check must cover the **accomplice** (T-10). | Build DX1 and DX2 in phase 5. Until then, Bilge's forbidden phrases carry it. | Dexter, George approves scope | Phase 5 grows (plan 3.9), about 3 to 4 commits |
| **D2** | `keyTestimonyGroups` is **required** for Tallyho, not optional (T-37). | Yes, build G5 in phase 5. | George, Dexter | Q9; phase 5 |
| **D3** | Role wording on the accuse form for every case (T-38). | "The one who struck the fatal blow." plus roles in the confirm dialog. | George | Plan 3.2 (added) |
| **D4** | Confrontations and the talk gate (T-36, Q3). | **Done on `main`** (DX8): addressed suspect only. Floor 32. | n/a | none left |
| **D5** | The guilt check's word splitting (T-25, T-53, T-48). | **Done on `main`** (DX3). Tallyho's `guiltCheck` lists decided (empty both; "brine" not kept). | n/a | none left |
| **D10** | Two-culprit stored-win replay (T-58). | G1 keeps `accompliceId` in `storedOutcomeBody` and the closed record (DX14), with a test. | Dexter | Phase 5 (G1), no extra commit |
| **D11** | Guilt-check vocabulary for a "BONK" case (T-57). | Per-case kill verbs, weapon names and location aliases (DX13), before Tallyho's leak scenarios are written. | Dexter, George approves scope | Phase 5, about 1 commit |
| **D12** | Wrong presentations and model-down turns stop counting toward the talk gate (T-63, T-62). | DX12 and DX16. The floor does not depend on them (32 either way); they stop brute force and outage farming. | Dexter | Phase 5 or 8, 1 to 2 commits |
| **D13** | Gate forces the time clue (T-77) and the weapon picker (T-78). | Design changed; `validate:case` must show no E1 warning and the weapon check passes. | none (data) | Phase 2 data |
| **D6** | £2,000,000 (T-30). | £200,000, or keep for the cartoon scale. | George | none |
| **D7** | "Half right" recap line (T-39, Q12). | Off. | George | Design 4.7 follows whichever George picks |
| **D8** | Validator checks V33 (guilt self-test) and V34 (forbidden phrase vs visible fact, mixed-owner keys) (DX4, DX10). | Add, as warnings first (Q15). | Dexter | Phase 8 list (added) |
| **D9** | Two-culprit loss endings after E4 (T-55). | Authoring rule as in design 4.6; DX11 in phase 5. | Dexter | Phase 5 (G2) |

### 9.2 The plan's open questions

| Q | Question | Recommendation | Reasoning |
|---|---|---|---|
| **Q3** | Do confrontation exchanges count towards the talk gate? | **Count only the addressed suspect**, not both, and have the simulator model confrontations. **Now built on `main` (DX8, fac75ba); Tallyho's floor rechecked at 32 (T-62).** | Counting both lets a player meet half of a 6 × 4 gate by pairing people up, dropping the floor to about 26 (T-36) while the validator prints 32. The gate exists to make the player *talk to* everyone. Counting the addressed side keeps confrontations attractive (they still count once and put pressure on two people) without halving the gate. If George prefers today's rule, keep it but accept 26 as the published floor. |
| **Q7** | How far does per-case theming go? | **Colours, logo and title art only** for Tallyho. | Fonts and layout per case multiply QA and accessibility checks for little gain; the setting block already carries the era. A sea-green palette and a Tallyho title card give the case its identity. |
| **Q8** | Deflate, or trimming only, for the token? | **Deflate first, trimming as a safety net**, as the plan says. | Two culprits, 13 secrets and more leads roughly double the state; deflate buys headroom without losing data, and trimming protects against the long tail. Design note: what may be trimmed must never include revealed secrets or found clues, or a gate could close (T-47's monotonicity). |
| **Q9** | `keyTestimonyGroups` and the pending-reveal fallback after N failures? | **Yes to both, and both are required for Tallyho.** | Groups: T-37 (one witness per culprit). Fallback: Tallyho's gate-critical reveals (`s-zippelli-summons`, `s-ottilie-bridge-visits`, `s-gherkina-at-door`) all pass through the guilt check or forbidden phrases; a false positive there would otherwise block `crock-13` or `cheer-cylinder` forever (T-11 was one). |
| **Q10** | Testimony-triggered reveals and a `lieBrokenIds` atom? | Testimony reveals are **already built**; do not use them on the key path. `lieBrokenIds`: **defer**. | Every key secret already reveals on a clue. One optional use is the recipe triangle (show Boris's sale to Gherkina), which would save one search but adds a route to test. `lead-stager` closes on a secret, so no lie atom is needed. |
| **Q11** | Is a 32-action floor (about 45 to 70 typical) right for a public game? | **Keep 32 as the floor, playtest before tuning**; the gate values are data. | Death on the Nile difficulty is the brief, and 12 of the 24 forced exchanges are productive presentations. The risk is grind, not unfairness: if playtests show stalls, lower `minExchanges` to 3 (floor about 26) before touching clue gates, since the clue gates carry the logic. |
| **Q12** | A "half right" loss line? | **Off.** | It leaks across replays: "you had the helper right" turns one 1-in-36 guess into two separate guesses (T-39). The generic loss and "replay" is fair. |
| **Q13** | Analytics (where players stall)? | **No client telemetry yet; start with the soak script and Gremlin's offline runs.** | Privacy first for a public game; the design questions (where do players stall on the marmalade run?) can be answered by scripted and offline playtests before deciding a stance. |
| **Q14** | Namespace assets per case, or flat with collision checks? | **Flat plus collision checks now**, as the plan says; clue art is already per case. | Tallyho's ids (`cabin-deck`, `ballroom`, `bridge`, `galley`, `engine-room`, `boat-deck`; six new characters) collide with nothing in Blackwood today. Namespacing pays off at case three; the check catches it before then. |
| **Q15** | Validator strictness rollout: warnings first? Who owns `lint` allowances? | **Warnings first for one case cycle, then errors.** The case author (me) owns per-case allowances; Dexter owns the rule list. | Tallyho will be the first case to meet V1 to V34; making them errors on day one blocks the build on rules nobody has run yet. One cycle of warnings, then promote. |
| **Q16** | `publish:case` as a script vs a manual rename? | **Script, plus the CI gate.** | The manual rename is the step most likely to ship a case with `draft` data or skip the validator. A script is cheap and repeatable. |
| **Q17** | Escape hatch for the unlock? | **None for now, as decided; revisit with player complaints.** If one is added later, prefer the short **unlock code** on the Blackwood win screen over a "I already solved it" link. | Blackwood takes 18 to 25 actions, so the cost of replaying is small. A code keeps the lock meaningful; a link turns it into a speed bump. |

---

## 10. Engine-level items for Dexter (read-only findings; I changed no engine code)

| # | Item | Where | Why |
|---|---|---|---|
| **DX1** | Allow `coreGuilt: true` on the accomplice's secrets without a warning; derive core guilt for the accomplice's secrets covering `accompliceAct`. | `engine/core-guilt.ts`, `engine/case-validation.ts` | T-10. Zero-warnings rule. |
| **DX2** | Guilt profile and leak check for the accomplice (his act, window, place, objects). | `engine/core-guilt.ts` `guiltProfile`, `ai/guilt-check.ts` | T-10. Today only the murderer is checked. |
| **DX3** | **Done (b1ee793).** Common-words stoplist plus `guiltCheck.ignoreNameTokens` / `keepNameTokens`. Tallyho uses neither list (T-53). | `engine/name-tokens.ts` | T-25, T-48, T-53. |
| **DX4** | Validator self-test: run `findGuiltLeak` over every revealable secret's summary and description as its owner; print the guilt window and core objects. | `engine/case-validation.ts`, `scripts/validate-case.ts` | T-11 class (a reveal the guard rejects forever). |
| **DX5** | Per-case `ABSENCE` / `MOVEMENT` word lists for the order check (ship verbs). | `ai/order-check.ts`, case data | T-54; already parked for the case-two signal. |
| **DX6** | Optional: hints weight open leads, so a stuck player is not always pointed at the doer. | `engine/hints.ts` | T-40. Not needed for fairness. |
| **DX7** | **Required (raised by r8):** `unlessRevealed` takes an array, plus `unlessBroken` for lie ids. | `engine/types.ts`, `ai/forbidden-phrases.ts` | T-56: phrases that become admissible when a lie breaks. |
| **DX8** | **Done (fac75ba, 43d7de8).** Addressed suspect only; `fastestPath` models confrontations; per-case caps. | `engine/interrogation.ts`, `engine/progression-validation.ts` | T-36, T-62. |
| **DX9** | `keyTestimonyGroups` (G5) in grading, the accuse handler and the form. | `engine/accusation.ts`, `engine/accuse-handler.ts` | T-37. |
| **DX10** | Validator warnings: an `unlessRevealed` phrase matching a fact visible before that reveal; a shared `hiddenUntil` fact whose keys belong to different knowers. | `engine/case-validation.ts` | T-49, and the Blackwood broker bug class. |
| **DX11** | `lossBeats` drops the **accomplice's** cameo lines from other suspects' wrong endings, as it does the murderer's (G2 with E4). | `engine/ending-payload.ts` | T-55, T-59. |
| **DX12** | A presentation that reveals nothing, breaks nothing and touches no lie of the addressed suspect does not count toward `minSuspectsQuestioned`. | `engine/interrogation.ts`, `engine/progress.ts` | T-63. |
| **DX13** | Per-case guilt vocabulary: kill verbs (bonk, conk, bop, biff, knocked out, laid out, thump), weapon names ("the crock", "number thirteen", "the heavy one"), location aliases (greenroom, wings, stage, tank → `ballroom`). | `ai/guilt-check.ts`, `engine/core-guilt.ts` | T-57. |
| **DX14** | `storedOutcomeBody` keeps `accompliceId`; closed record stores it. | `engine/accuse-handler.ts` | T-58. |
| **DX15** | Order-check landmarks: generate word forms from the digit range. | `ai/order-check.ts` | T-71. |
| **DX16** | Model-down turns do not count toward the talk gate; close the #40 parallel-confrontation race. | `engine/interrogation.ts`, `engine/confrontation.ts` | T-62. |
| **DX17** | `vocabulary.allowed` overrides `MODERN_WORDS` ("okay"); multi-word banned entries. | `ai/canon-check.ts` | T-73. |
| **DX18** | Evidence-matched secret wins over a stress-threshold secret in the same exchange. | `engine/secrets.ts` | T-75. |
| ~~E1~~ | **Done (7f81e08):** the validator warns when ACCUSE can open while winning is impossible. It would have fired on Tallyho; fixed in data (T-77). | `engine/progression-validation.ts` | T-77. |
| ~~weapon~~ | **Done (on `main`):** `"weapon": true` on evidence; the picker lists only marked clues; the validator errors if the solution's weapon is unmarked. | `engine/types.ts` | T-78. |

---

## 11. Death on the Nile difficulty without unfairness

- **Hard because:** three misdirection layers; six suspects who all lie; the two culprits each have a perfect alibi for the other's half; the real motive is item 5 of 5; 24 forced exchanges, 8 of 11 clues and 10 of 13 secrets before the accusation; a decoy weapon that fits the "round and heavy" hint (T-78).
- **Fair because:** every step of 4.5 cites a found clue or a revealed witness; nothing needs a confession (T-50); the only inference (the watch is wrong) has a visual clue and two leads; every innocent has an alibi at 21:52 and a resolved red herring; the helper and "No one helped" are decided by evidence (T-35); the roles are worded (T-38); one witness per culprit is required (T-37); the gate cannot open before the time clue is found (T-77); the shadow is evidence, not an identification (T-70).
- **Steps that needed a leap before this PR:** the watch smear (T-01), "a recording, so somebody started it" (T-15, T-35), and the role wording (T-38). All three are fixed in the design.

## 12. Offline review

Gremlin (QA) is asked for an offline adversarial review of this audit with no live spend: try to solve the case on paper by guessing or elimination, try to make each suspect's knowledge leak from the withheld lists, and try to break the fastest path in 9.5.

**Done (r8, `qa/r8/review.md`, offline only, zero live calls):** 6 high, 9 medium, 5 low misses, plus 8 questions. All are recorded in section 13 as T-56 to T-75, with my decisions on the questions.

---

## 13. Second round: Gremlin's review (r8) and the engine changes on `main`

### 13.1 Findings T-56 to T-78

| ID | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| **T-56** | High | 7.3 phrases; design 7.x (r8 H1) | Forbidden phrases blocked lines a character may say after a lie breaks or a secret reveals: models paraphrase ("knocked" vs "knocks", "sold" vs "sells"), bare `goat` fought Percy's open `ev-percy-returns`, and `curtain` fired on Ottilie restating her own revealed visits. A gate-critical reveal (`s-ottilie-curtain`) could stall. My T-47/T-51 pass checked literal statement text only. | 7.3 rewritten: stemmed verbs, guilty-claim phrasing instead of bare nouns, `unlessBroken` on the lie where a lie break makes the subject admissible; `s-ottilie-bridge-visits` no longer mentions the curtain or click (design 7.7). V36 runs every phrase over paraphrases at every reveal stage. DX7 is now required. | Fixed (design, audit, plan V36); Needs Dexter (DX7) |
| **T-57** | High | `ai/guilt-check.ts` `KILL`, `weaponNames`, location aliasing (r8 H2) | The guard does not fit a "BONK" case: "I bonked him with the crock" is not a leak (no bonk verb), and Zippelli's own lie "in my greenroom" reads as a false alibi leak because greenroom/wings/stage are not aliases of `ballroom`. | DX13: per-case kill verbs, weapon names, location aliases. The head noun "crock" already counts since b1ee793. Zippelli's 7.3 phrases carry the verbs meanwhile. | Needs Dexter (DX13) |
| **T-58** | High | `engine/accuse-handler.ts` `storedOutcomeBody` (r8 H3) | After strict grading, a stored win replayed on the 409 path is rebuilt without `accompliceId` and re-grades as "No one helped", a loss. | Plan 3.2 and G1: keep `accompliceId` in the rebuilt accusation and the closed record; test added to the plan. | Fixed (plan); Needs Dexter (DX14) |
| **T-59** | High | Plan F3, 3.2, test matrix vs design 4.6 (r8 H4) | The plan said a culprit's own `wrong` entry is never used; the design (E4) says every loss plays the accused's own entry. | Decided for E4: own entry always plays, both culprits' entries role-neutral, other endings drop both culprits' cameos (DX11). Plan F3, 3.2 and the test row rewritten; static role-word test added. 307d09c (no rating or remark on any loss) closes the last non-text tell. | Fixed (plan) |
| **T-60** | High | A.1 `f-zippelli-trunk`, `s-bilge-smuggling`, `ev-confrontation` (r8 H5) | The stager's smuggling reveal unlocked "Zippelli's trunk" for him, naming the doer; `ev-confrontation` let the doer name the Captain on a reveal turn. | `f-zippelli-trunk` hidden in Bilge's copy until `l-zippelli-trunk` breaks; `s-bilge-smuggling` says "cargo", no trunk, no partner; `ev-confrontation` split (the Captain half is core-guilt context only); guards both ways (7.3). Cross-secret test in plan. | Fixed (design, audit) |
| **T-61** | High | 8.1 `lead-motive` hint; `ship-list` frames (r8 H6) | The hint pointed at the marmalade-thumbprinted fifth motive; a frame label stated "before the Lurch". | Hint rewritten (no pointer); frames labelled neutrally; the reconstruction image is recap-only. | Fixed (design) |
| **T-62** | Medium | Design 9.5; plan F7, Q3 (r8 M1) | Confrontations crediting both suspects put the real floor at about 22, not 32; the #40 race and model-down turns lower it further. | **DX8 is on `main` (fac75ba):** addressed suspect only, and `fastestPath` models confrontations. Rechecked: no exchange can count twice, so 24 exchanges + 7 searches + the accusation = **32 on today's engine**. Open: DX16 (model-down turns, #40). | Fixed (DX8); Needs Dexter (DX16) |
| **T-63** | Medium | Design 9.4, 9.6 (r8 M2) | Brute-force presenting is rewarded: a wrong presentation still counts toward the talk gate. Also my blind-guess figure miscounted the helper answers (31 instead of 36). | DX12 (wasted presentations do not count); design says brute force costs about 75 to 85 actions under DX12; blind odds corrected to about 1 in 430 (36 × 2 weapons × 6 motives); the testimony it earns still has to be interpreted (T-68, T-70). | Fixed (design); Needs Dexter (DX12) |
| **T-64** | Medium | A.2 `ev-bilge-sees-ottilie-1/-2` (r8 M3) | Bilge volunteered a "ten to ten" alibi from the first question, giving away the murder window and contradicting Ottilie's unbroken lie. | Decided: a **sanctioned cross-character lever**, but only after her lie breaks: both sightings hidden until `l-ottilie-engine` is broken (or her testimony is shown to him). Recorded as the one exception in design 7.9. | Fixed (design) |
| **T-65** | Medium | Design 1.6 purser (r8 M4) | 1.6 still gave the purser the ship's log. | The deck log is the Captain's, on the bridge chart table, and a supporting clue (`ships-log`, needs `heel-chart`): helmsman stood down at 20:53, the 22:14 hard-a-port, a razored course entry, "Master at the wheel throughout". It shortens nothing (fastest path unchanged). | Fixed (design) |
| **T-66** | Medium | 4.4, 4.5, `f-chartroom-access` (r8 M5) | "In view" survived for Ottilie's alibi; the second key was worded two ways. | "In view" removed; one wording: the Master's key and the Chief Engineer's key. Ottilie takes the wheel at 22:36, facing forward. | Fixed (design) |
| **T-67** | Medium | Bridge location, art notes (r8 M6) | Curtain or locked door was unclear, and the helmsman was an unquestionable eyewitness. | Layout fixed: bridge → curtain → locked chartroom door (two keys) → Cheer-Box. The Captain stood the helmsman down at 20:53 and took the wheel; he returns at 22:58. | Fixed (design) |
| **T-68** | Medium | Design 7.7 Ottilie's belief (r8 M7) | "The Captain was testing the Box" made an innocent voice the stager's act. | Belief rewritten: she heard a click, a hiss and a whirr behind the curtain and never connects it aloud; the all-innocents guard covers wound/cranked/tested. | Fixed (design, audit) |
| **T-69** | Medium | Design 7.9 vs A.2 events (r8 M8) | Event rows contradicting unbroken lies were open (`ev-gherkina-returns`, `ev-percy-returns`, and others). | 7.9 rule extended to every timed fact and event; rows gated or reworded (`ev-gherkina-leaves` no destination, `ev-percy-returns` no goat smell); V35 checks it. | Fixed (design, plan V35) |
| **T-70** | Medium | 11.3, art notes, `s-boris-saw-shadows` (r8 M9) | "Windmilling arms" matched Zippelli's sprite, so the shadow identified him. | Decided: keep it genuinely ambiguous. The shadow is "a tall figure in something long to the knee", fitting Zippelli's cape and the Captain's greatcoat; "windmill arms" removed from the silhouette notes. Step 6 of 4.5 decides. | Fixed (design) |
| **T-71** | Low | 7.3 time shorthand (r8 L1) | Word forms did not cover all the minutes the digits cover. | Shorthand extended; DX15 generates word forms from the range. | Fixed (audit); Needs Dexter (DX15) |
| **T-72** | Low | 7.3 `ZIP` (r8 L2) | Bare `he` in `ZIP` fired on every "he". | Dropped. | Fixed (audit) |
| **T-73** | Low | Design 1.5 vocabulary (r8 L3) | "Bootleg" is American; "okay" was period-correct but banned; several anachronisms were missing; the spring wound for one play. | "Illicit still"; "okay" un-banned; banned list extended (intercom, loudspeaker, tape recorder, nylon, ballpoint, biro, Dramamine, serial killer, smoking gun); spring "wound for one play". DX17 for the allowed-list override and multi-word entries. | Fixed (design); Needs Dexter (DX17) |
| **T-74** | Low | Suspect file order (r8 L4) | Both culprits listed last is a meta tell. | Display order interleaves culprits with innocents (design 1.3). | Fixed (design) |
| **T-75** | Low | Stress-path overlap (r8 L5) | Percy + `midnight-notes` at ≥ 70 and Ottilie + `heel-chart` at ≥ 75 make two secrets eligible at once. Nothing breaks. | DX18: the evidence-matched secret wins; one test per pair. | Needs Dexter (DX18) |
| **T-76** | Medium | Design 8.3 accusation form (mine, during r8) | The form's citation caps did not match the engine's "minimum required + 1" (`citeCaps`). | Design now says up to 4 clues (3 key + 1 spare) and 3 testimonies. | Fixed (design) |
| **T-77** | High | Design 8.3 `closedLeadIds` (found with E1, 7f81e08) | With 11 clues and `minEvidence: 8`, the gate could open on the other ten clues without `marmalade-run`, a key clue: ACCUSE open, win impossible. The new validator warning would fire. | `lead-time` (closes when `marmalade-run` is found) is now a gate lead: four gate leads. Every key clue and one key testimony per group is now forced by the gate. Fastest path unchanged (step 13 finds it). | Fixed (design, plan) |
| **T-78** | Medium | Design 6.1, 6.2 (weapon flag on `main`) | The picker now lists only `"weapon": true` clues and the validator errors if the solution's weapon is not marked. Tallyho had no marks, and a one-item picker would hand over the weapon. | `crock-13` marked; decoy: the heavy round stoneware jug of Orange Lightning in `orange-lightning`, which fits "something round and heavy" and points at Ottilie, and is ruled out by evidence (no dent, no toupee, no marmalade, bolted hatch four minutes away, owner on the bridge at 21:52). | Fixed (design, plan V37) |

### 13.2 Decisions on Gremlin's eight questions

| # | Question | Decision | Reasoning |
|---|---|---|---|
| 1 | Do confrontation exchanges count for both suspects? | **No: the addressed suspect only.** Now on `main` (DX8). | The gate exists to make the player talk to everyone; floor stays 32 (T-62). |
| 2 | Culprits' loss endings: E4 or "never use a culprit's entry"? | **E4**, with the role-neutral authoring rule and DX11. | One rule, already built; and the culprit's own exit reads like any wrong accusation (T-59). |
| 3 | Is Bilge's 21:50 alibi with Ottilie a lever or a leak? | **A lever, but gated** on her lie breaking. | Volunteered from the first question it gave away the window; after her lie breaks it corroborates her and is fair (T-64). |
| 4 | How identifying may the shadow be? | **Not identifying.** It fits two people. | The doer must come from the evidence chain, not a sprite match (T-70). |
| 5 | May Ottilie voice "the Captain was testing the Box"? | **No.** She reports sounds, never who touched what. | Keeps every innocent from asserting the stager's act; the player makes the connection (T-68). |
| 6 | The helmsman? | **Cut from the bridge**: stood down at 20:53, back at 22:58, recorded in the log. | No unquestionable eyewitness; the stand-down is itself a clue (T-67, T-65). |
| 7 | Is the ship's log a clue? | **Yes, supporting**, gated on `heel-chart`. | It exposes the tampered course and the stand-down without shortening the path (T-65). |
| 8 | Should a mis-presented clue credit the talk gate? | **No** (DX12). | Brute force should cost more than thinking (T-63). |

### 13.3 Engine changes on `main` folded in

| Change | Effect on Tallyho | Where |
|---|---|---|
| **DX3** name tokens (b1ee793) | "The Marmalade King" back in aliases; `guiltCheck` lists both empty; "brine" not kept (T-25, T-53). | Design 1.2; plan 3.9 |
| **E1** validator (7f81e08) | It would have warned: the gate did not force `marmalade-run`. `lead-time` is now a gate lead (T-77). | Design 8.1, 8.2, 8.3, 9.4, 9.5 |
| **Wins-only rating** (307d09c) | A loss never shows a rating or `sloppyRemark`, so a right-doer, wrong-helper loss looks like any other loss outside its ending text (T-59). `sloppyRemark` written for a scraped win only. | Design 4.6; plan 3.9 |
| **DX8** confrontations (fac75ba, 43d7de8) | Floor rechecked: 32, no confrontation shortcut; default caps (6 per pair, 12 per game) kept, `confrontation` block omitted (T-62). | Design 9.5; plan F7, Q3, V10 |
| **Weapon flag** | Two marked weapons: `crock-13` and the Orange Lightning jug (T-78). Blind odds about 1 in 430. | Design 6.1, 6.2, 9.4; plan V37 |
