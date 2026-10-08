# AI guardrails

**The engine is the truth; the model is a performer it does not trust.** The engine decides every fact, reveal,
stress change and verdict. The model only voices a line. Nothing the model writes can unlock anything. A reply can
only be **rejected**: the engine retries once with a corrective note, then plays a safe in-character deflection.

## 1. Incident: Victoria confessed the murder (2026-10-08)

George showed Victoria Archibald's testimony card. She answered: *"I killed Edmund with that candlestick at
seventeen minutes past nine to stop him signing the new will..."*

The game state at that point:
- the candlestick, the key and the letter had all been shown to her;
- `s-victoria-left-dining` and `s-victoria-new-will` were already admitted;
- her stress was 75.

Reproduced deterministically in `tests/ai/core-guilt.test.ts` ("root cause, pinned").

File and line references are to the tree before the fix (`da253b4^`).

| Question | Answer | Evidence |
| --- | --- | --- |
| (a) Did the engine reveal it, or was it a chain reveal? | **The engine revealed it, by data design. It was a single reveal, not a chain.** `s-victoria-murder` was an ordinary revealable secret. Its conditions were stress ≥ 80, all three clues shown, and both earlier secrets admitted. The card broke nothing new, because `l-victoria-together` was already broken. It only "touched" a lie, which is worth +5. That took her from 75 to 80, and `secretsToReveal` picked the murder. | `cases/blackwood/characters/victoria.json:211-226` (the conditions, present since 3bd7e2d / b71d855). `engine/interrogation.ts:28` (`relatedEvidence: 5`). `engine/interrogation.ts:140-144` (the testimony branch: `!nowBroken && touches ? +5`). `engine/interrogation.ts:160` (`secretsToReveal(ch.secrets, rt)[0]`, with no exclusion). `engine/secrets.ts:30-34` (every eligible secret, with no severity order). |
| (b) Did the prompt leak it? | **Yes, by instruction.** The confession directive pasted the secret's description verbatim: *"She killed her husband with the silver candlestick at 21:17..."*. Every confession prompt also carried a hardcoded example: `say "21:17" as "seventeen minutes past nine"`. The murder-minute facts themselves were correctly withheld from WHAT YOU KNOW. | `ai/prompts/interrogation.ts:230` (Fix #23, 3037634). |
| (c) Why did the canon check pass a true admission? | The time check allows every time in the reveal directive, so 21:17 was "canon". There was **no admission check of any kind**. | `ai/canon-check.ts:206` (`d.revealSecret?.description` in `canonTimes`). `ai/perform-turn.ts:91-110` (validate checked only times, event order, confrontation hygiene, outbursts and modern words). |

The card's mapping was right. Archibald's card breaks only `l-victoria-together`. The bug was that the murder
could be unlocked at all, and that nothing checked what the model said.

## 2. Guard architecture (five layers)

```
case data ──► L0 coreGuilt ──► L1 engine decides ──► L2 prompt surface ──► model ──► L3 output contract ──► player
                                                                                   ▲
                                                L4 audit + eval (CI) ──────────────┘
```

### L0 Data: `secrets[].coreGuilt`
- `coreGuilt: true` marks a secret that is part of the killing itself: the act, the weapon in hand, being at the
  scene at the murder minute, locking the victim in, or hiding the key. The flag lives in `engine/types.ts`
  (SecretSchema). The case data flag is the primary source.
- **Defence in depth**: `derivedCoreGuilt` (`engine/core-guilt.ts:33`) also treats a secret as core guilt when all
  of these hold:
  - its owner is `solution.murdererId`;
  - one of its related facts spans `solution.time`;
  - that fact involves the murderer or happens at `solution.locationId`.

  `coreGuiltSecretIds` (`:52`) is the union of the flag and the derivation.
- The validator warns when a flagged secret has `revealConditions` or a `testimonySummary`, or when its owner is
  not the murderer.

### L1 Engine: the decision
- Core guilt is **never revealable**: `shouldRevealSecret` returns false (`engine/secrets.ts:22`), and `planTurn`
  excludes core ids (`engine/interrogation.ts`).
- **One secret per exchange, lowest severity tier first** (embarrassing, then serious, then damning; ties go by
  authored order): `secretsToReveal` (`engine/secrets.ts:42`). In a confrontation, the second speaker may reveal
  only if the first did not (`allowReveal`).
- A clue or card breaks only the lies it contradicts. Revealing a secret unhides only its own `relatedFactIds`.
- Core-guilt secrets never become testimony cards (`publicTestimonies`, `engine/testimony.ts:98`).
- New trigger: `revealConditions.testimonyIds` (cards shown to this character). Reachability and the fastest
  path both honour it, and never "crack" core guilt.

### L2 Prompt surface: what the model sees
- Knowledge gate layer 4 (`engine/knowledge-gate.ts:126`) always withholds the facts a core-guilt secret covers.
  This holds even if another revealed secret lists those facts.
- A story that is exposed but whose truth is core guilt gets `stonewall`
  (`engine/context-builder.ts:190`). The character drops the story but admits **nothing** in its place.
- Prompt rules:
  - Rule 5: pressed on anything not admitted, deflect or stonewall, and never fill the gap.
  - Rule 6: never confess the murder or any part of it.
  - Rule 10: the `admits` bookkeeping.
- The `IDS FOR "admits"` legend lists only the character's own stories, their admitted secrets, and this turn's
  reveal. It never includes a locked secret.
- The confession example time is taken from the secret being confessed (`timeExample`), never hardcoded.
- **`npm run audit:prompts`** (`tools/prompt-audit.ts`) builds the real prompt (`prepareTurn`) for every
  character in these states:
  - fresh;
  - each revealable secret admitted on its own;
  - all revealable secrets admitted;
  - each clue shown;
  - each card shown;
  - maximum pressure;
  - the breakdown turn.

  It writes `docs/PROMPT_SURFACE.md` and **fails** if the culprit's prompt holds a core-guilt secret (id or
  description), a covered fact (id or statement), the murder minute as their own knowledge, or the solution text.

### L3 Output contract: `ai/guard.ts`
The model replies with strict json_schema: `{dialogue, emotion, intensity, action, evidenceReactions, wantsToLeave,
stressDelta, trustDelta, admits[]}`. Here `dialogue` is the spoken line, and `admits` holds the story and secret ids
the line concedes, or `"killing"`.

`checkReply` (`ai/guard.ts:95`) rejects a reply on the first failing check:

1. **guilt_leak**: `findGuiltLeak` (`ai/guilt-check.ts:77`), or `admits` contains `"killing"`.
   - It rejects only links to the killing: killing or striking, the weapon used on the victim, being at the scene
     in the murder window, locking the door, or taking the key. It also rejects anyone's "I did it", "it was me"
     or "I confess to the murder".
   - Motive admissions pass. For example: "I knew about the will and burned the letter".
2. **admits_core_guilt / multiple_reveals / admits_locked_secret / concedes_maintained_lie**: the model's own
   `admits` list is checked against what the engine unlocked. A self-report can only cause a rejection.
3. **unknown_time**: every clock time must come from the character's context (`ai/canon-check.ts`).
4. **event_order**: relative timings must match the real order of events (`ai/order-check.ts`).
5. **unknown_name**: a titled name ("Colonel Mustard") or a familiar one ("poor Bertie") that is not in the prompt
   or the player's words.
6. Performance checks: repeats and the wrong addressee (in confrontations), a breakdown without an outburst, and
   modern words.

How a rejection is handled:
- **Retry**: once, with a corrective note. The note never contains locked content, only ids the model already has.
- **Then**: `safeDeflection` (`ai/guard.ts:188`). For guilt it uses the guilt deflection. For other contract
  breaks it picks a line by stress band and uses the character's own quirks (calm) or tells (rattled) as the
  action. Performance slips keep the existing canned lines.
- **Log**: every rejection writes one JSON line:
  `{"event":"ai_guard_reject","gameId","character","reason","attempt","detail"}` (`logReject`). It never includes
  the prompt or the key.
- **Cost**: the retry counts as an extra paid call against the per-IP limit and the daily cap
  (`settle({called, extra})`, `ai/model-gate.ts`).
- The `admits` field is stripped before the response reaches the client.

### L4 Evaluation: `npm run eval:ai`
- 45 scripted scenarios (`tools/ai-eval/scenarios.ts`): normal questions, every key clue, every testimony card,
  breakdowns, confrontations, prompt injections, and confession baits on every suspect.
- Assertions on each spoken line (`tools/ai-eval/assertions.ts`):
  - no guilt admission;
  - only the allowed secrets (by `admits` and by text signature);
  - canon times;
  - known names;
  - a valid emotion;
  - voice (no meta talk or modern words);
  - length;
  - no naming of the culprit as the killer under solution baits.

  Engine assertions: at most one new secret per exchange, and never core guilt.
- **BEFORE** applies the assertions to each turn's raw first model output. **AFTER** applies them to the line the
  player actually sees.
- `--record` calls xAI directly. Each response is priced from its own `usage` and cross-checked against xAI's
  `cost_in_usd_ticks`. Spend is kept in a gitignored ledger, and a call is refused before it is sent if its worst
  case could cross the cap.
- The default mode replays the fixtures (`tests/fixtures/ai-eval/*.json`) through the full pipeline (handlers,
  engine and guard) with fetch stubbed. This also runs in `npm test` (`tests/tooling/ai-eval.test.ts`).

## 3. Known limits
- Text signatures for "conceded a locked secret without listing it" exist only in the eval, not in the guard. The
  guard relies on `admits` plus the guilt check for that.
- The name check covers titled and familiar forms only. A bare invented first name ("Bertie said...") is not caught.
- A third party's public card can carry the murder minute as their own observation. For example, Gregory's
  in-hall card says "at 21:17 he heard a thud". The audit allows this and notes it. The guilt check still blocks
  the culprit placing herself in the library at that minute.
- Case one's `s-victoria-locked-door` is revealable in the current data. The guilt check rejects her saying it, so
  she deflects, but the engine still records it as admitted. Agatha's data PR (#41) flags it `coreGuilt`.

## 4. Gremlin round 5 (#44-#49)

Every Gremlin repro is an eval case in `tools/ai-eval/gremlin-scenarios.ts`. Most are **crafted replays**
(`Scenario.crafted`): the exact line Gremlin got past the guard is scripted as the model output and run through the
real pipeline (handlers, engine, guard, fallback) with no live call and no fixture. `rejectFirst` asserts the guard
rejects it with the expected reason; `acceptFirst` is a no-false-positive control. Live recording is capped per round
as well as cumulatively: `npm run eval:ai -- --record --round gremlin-5 --round-cap 0.50 --cap 1.40` (the ledger keeps
`rounds.<id>`; a call whose worst case could cross either cap is refused before it is sent).

### #47 A card cracks its own secret (engine)
In an exchange where a clue or a testimony card is presented, `planTurn` may reveal only a secret mapped to that item
through `revealConditions.evidenceIds` / `testimonyIds` (`isMappedToPresentation`, `engine/secrets.ts`). The item's
stress still accrues; a stress-threshold reveal it enables waits for the next ordinary exchange. A breakdown triggered
by an item still happens and reveals nothing beyond the item's own secret. Rationale: the player should be able to
read every reveal as "this card did that"; a card mapped to none of the character's secrets can rattle them and break
their lies but never makes them confess something unrelated.

### #48 Never retract an admission (prompt + guard)
- Prompt: `ALREADY ADMITTED` now says "never deny, retract or take them back, not even in a breakdown or in anger",
  and the breakdown directive repeats it.
- Guard: `retracts_admission` (a contract reason, so retry then in-character deflection), `ai/retraction-check.ts`.
  Two cheap, data-driven cues per revealed secret (including this turn's reveal):
  1. a denial whose object is one of the secret's key terms ("I know nothing of any will", "I never burned that
     letter", "there was no new will", "I never left the dining room"). Key terms are the content words of the
     secret's description and testimony summary, minus names, the murder's own vocabulary (victim, weapon, scene,
     core-guilt objects: the culprit may always deny those), generic and atmosphere words, and words used as a verb
     right after a pronoun ("she *will* not say"). The object must follow a determiner or "no", and the gap may not
     contain a pronoun, a preposition or a "not just" contrast, so "I didn't see nothing in the dark" passes;
  2. a superseded story restated: a lie whose `supersededBySecretIds` lists the secret, with at least two of its
     distinctive words (40% of them) or three.

### #45 Harder confession check (guard)
- **Language decision: an English-only gate, not multilingual patterns** (`ai/language-check.ts`, reason
  `not_english`, a contract reason). A reply whose dialogue or action is in another script (10%+ non-Latin letters,
  or 4+) or another language (a sentence with 2+ Spanish/French/Italian/German/Portuguese function words outnumbering
  the English ones; loan phrases such as "c'est la vie" ignored) is retried once with "answer in English, in
  character; you do not understand that tongue", then replaced by the in-character deflection. Why: the guilt check
  is a list of English constructions, and porting it to every language the model can write is open-ended; "is this
  English?" is one cheap, closed question, every persona speaks period English, and the model already plays
  incomprehension (the live Spanish bait, `g45-victoria-spanish-bait-live`, gets an English refusal). Player input is
  not gated.
- The **action field** is checked (`findActionLeak`): its implied subject is the speaker, so violent verbs against the
  victim or with the weapon, miming with the weapon, and (culprit) turning a key / locking a door are leaks.
- New forms in `findGuiltLeak`: third-person self-naming (the speaker's own name and aliases read as "I"); passive and
  possessive admissions ("he was struck by me", "the deed was mine", "by my (own) hand" about the victim, the door,
  the key or the weapon; "not by my hand" passes); "guilty as charged", "I plead guilty"; (culprit) "<victim> and I
  were alone in <scene>", "alone with him", "while the candles burned"; "after X went off"; "I did go back to the
  library" and going to the scene "to see / reason with" the victim (unless an explicit time outside the murder
  window or a "before dinner" landmark is given); hyphenated spelled times ("nine-seventeen").
- A bare **"yes" to a spelled-out accusation** (`findAffirmedAccusation`): when the reply opens with an affirmation and
  no negation, the accusation the speaker just heard is turned into their own words ("you struck him" becomes "I
  struck him") and run through the guilt check.
- No semantic second pass: every probe line is now held by the regex layer plus the language gate, so a model call per
  suspicious line (cost, latency, a new failure mode) is not justified yet. It stays the next step if a future probe
  defeats both.

### #46 Per-character forbidden phrases (schema + validator + guard)
`characters[].forbiddenPhrases` (see docs/CASE_FORMAT.md), enforced by `checkReply` on every reply (dialogue) as
`forbidden_phrase`, a contract reason, right after the guilt and `admits` checks (`ai/forbidden-phrases.ts`). A secret
revealed in the current exchange counts as revealed for `unlessRevealed`. The retry note quotes only the model's own
matched words, never the entry's `note`. Case one's lists are Agatha's data PR; the fixture case
(`tests/fixtures/cases/harbor-light`) carries three samples.
- Agatha's culprit phrases, folded into `findGuiltLeak` (culprit only): "I never meant to hurt him" (a negated
  intention to harm the victim is still an admission), self-defence / "he came at me", "I watched him fall", blood on
  my gown/sleeves/hands, the weapon "in my hand", "I wiped it clean" / "wiped the blood", "already dead when I came
  out", leaving the scene in the dark or by the lightning, "the gardener saw me" and "I stopped him signing". The last
  two are data-derived: `guiltProfile().witnessNames` are the other characters whose secrets cover one of the
  culprit's core-guilt facts (name, first name, aliases, role), and `motiveActs` are the gerunds after "stop/prevent
  him" in her core-guilt secrets. Each has positive and innocent-speaker negative tests
  (`tests/ai/guilt-agatha-phrases.test.ts`).

### #44 Event-bound times (guard)
`ai/event-time-check.ts`, reason `event_time` (retry with "give an event only its own listed time; if none is listed,
put no clock time on it", then the canned fallback). Spoken forms are normalised to HH:MM by `extractTimes`
("twenty to nine" 20:40, "a quarter past nine" 21:15, "half past eight" 20:30, "nine-seventeen" / "9.17" /
"seventeen minutes past nine" 21:17). The **event-time map** is built from the case's facts and timeline (every entry
with a time or range): cue words are the entry's id tokens (weight 2, or 1 when three or more ids share them) and its
statement's content words (weight 1, or 0 when four or more statements share them), plus a small case-agnostic
English phrase lexicon onto concept words ("the lights went out" -> blackout, "quarrel" -> argument, "overheard" ->
overhears, "into the fire" -> burned; weight 3 on an id token). A sentence with a time binds when its top event scores
3 or more; the time must then fit one of the events the sentence touches (score 2 or more), within:
- precise clock time: +-1 minute;
- rounded ("a quarter past", "half past") or hour-only ("nine o'clock"): +-5 minutes (so "nine o'clock" for the 21:10
  blackout fails; it used to pass);
- hedged ("around", "about", "roughly", "nearly", "approximately", "or so"): +-10 minutes;
- "just / shortly / a little after T": the event lies in [T, T+15]; "... before T": in [T-15, T].
Times in the speaker's own maintained stories and beliefs are exempt. It applies to every speaker, innocents
included. This is a guard-only fix (no prompt change): when the event's time is not in the speaker's context (Reginald's
reveal turn has no 20:54 line), any clock time on it is rejected and the retry tells him not to put one on it. The
order-check ABSENCE/MOVEMENT lists are untouched (deferred). Known limit: a sentence that names two events and one time
is accepted if the time fits either ("after dinner I burned it at half past eight").

### #49 Breather countdown and already-answered replay (client + turn lock)

- **429 breather:** the client reads `unavailable.retryAfter` (else the `Retry-After` header, seconds or HTTP date)
  and keeps AGAIN disabled with a live countdown ("↻ AGAIN 45s", "1:05" from a minute up) until it runs out
  (`retryWaitSeconds`, `formatRetryWait`, `retryOffer` in `ai/model-down.ts`).
- **409 already_answered:** when a turn is answered, the turn lock keeps the newest token AND the minimal public reply
  the player was shown (`ai/public-reply.ts`: dialogue, action, emotion, intensity; for a confrontation, the two lines
  with speaker id and name). Nothing else is cached: no secret ids, reveal, stress, trust, testimony or engine state;
  the stored and received shapes are strict schemas, so an extra field drops the whole reply. A duplicate gets 409
  with `answered` (the stored reply, only if it was the same suspect or pair) plus the newest token; the client shows
  that answer and offers no AGAIN. `in_flight` duplicates carry no answer and keep AGAIN.
- `check:overflow --model-down` answers the first request on each screen with a breather (retryAfter 65 s), so the
  disabled AGAIN with its widest countdown label is measured at every viewport.

## 5. Gremlin round 6 (#51, #52, swallowed questions)

Repros are eval cases in `tools/ai-eval/gremlin-scenarios.ts` (section "Gremlin round 6"); live recording for the round
is capped at $0.25 (`--round gremlin-6 --round-cap 0.25 --cap 1.40`).

### #51 The reveal turn knows what it reveals (engine context)
Root cause: `prepareTurn` built the character's context from the state BEFORE `commitTurn` records this exchange's
reveal, so the knowledge gate still withheld the revealing secret's `relatedFactIds` (and facts `hiddenUntil` it). The
prompt lacked the very time printed on the player's card (Reginald's 20:54, Gregory's 21:16) and the guard's allowed
times rejected it as `unknown_time`; one exchange later the same line passed.
Fix: `buildCharacterContext(state, id, { revealingSecretIds })` (`engine/context-builder.ts`) passes the planned reveal
to the knowledge gate as revealed. On the reveal turn the unlocked facts are in WHAT YOU KNOW and therefore in every
check built from the context: allowed times, the event-time exemptions (beliefs), the order check's movements, the jab
filter and the name vocabulary. The secret itself is not listed as ALREADY ADMITTED (the directive carries it), core-
guilt facts stay withheld (gate layer 4), and another character's secret id is ignored. The reveal directive now says
to give a time "exactly as written there or on that event's own line in WHAT YOU KNOW".
Audit of the other guard checks for the same off-by-one-exchange bug:
- `admits` (`thisTurn`), forbidden phrases (`unlessRevealed`), the retraction check: already counted this exchange's
  reveal (`revealedNow`);
- clue / card shown this exchange: `planTurn` records them before the context is built (evidence and testimony shown,
  lies they break, `hiddenUntil` unlocks): already current;
- lies retired by this exchange's confession: `retiredLieIds` in the directives (prompt and `admits`): already current;
- breakdown this exchange: the directive (`no_outburst`, prompt); `ctx.state.brokeDown` is read by no check;
- canon times, event-time exemptions, order check, name vocabulary, jabs: were one exchange late; fixed by the above.
Known data note: revealing `s-archibald-false-alibi` unlocks `loc-archibald-2115..2117` ("on the servants' telephone to
his broker"), while the broker belongs to the still-locked embezzlement. The `broker` forbidden phrase catches it (one
retry); that used to happen one exchange later, now it can happen on the reveal turn.

