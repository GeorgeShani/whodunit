# Three-step lead hints

Short spec for Dexter. George approved the feature on 20 November 2026. The room's design, plus Marvin's rule: the engine, never the AI, picks each hint, and no hint ever names the killer or the helper.

This document is the authoring source for the three-step texts. **Do not add a `hints` field to case JSON until the schema commit for it is on main.** The standing `lead.hint` string is unchanged in shape (PUBLIC, shown while the lead is open, max 240). Leaky standing hints were rewritten in this PR, still as that single string.

Toon will style a served hint as a typed note dropping into the notebook, like the player's own thought, with a soft typewriter tap. Every text below is written in the second person or an impersonal voice, never as the game addressing the detective.

## What already exists

- Each lead has one `hint` string (max 240). `publicProgress` sends that string only while the lead is open. Hidden leads do not publish their hint. Closed leads publish `closedLine` instead.
- `POST /api/hint` is a different system: one spoiler-safe contradiction hint (`engine/hint-handler.ts`, `engine/hints.ts`), cooldown `HINT_COOLDOWN_TURNS = 3`, no model call. It names a character whose story may clash with something the player already holds. It does not serve lead hints today.
- Tallyho already had per-lead standing hints. Gremlin found that `lead-motive` gave the answer away. That string, and the other leaks listed at the end, are fixed in this PR.

## Proposed data shape

Keep `hint` as the standing notebook line. Add an optional, **server-only** array on the same lead:

```jsonc
"hints": [
  { "tier": 1, "text": "<=160", "requires": { /* optional Condition */ } },
  { "tier": 2, "text": "<=160", "requires": { /* optional Condition */ } },
  { "tier": 3, "text": "<=160", "requires": { /* optional Condition */ } }
]
```

- `tier` is 1, 2 or 3: (1) where to look, (2) what to look at, (3) what to do with it (for example, who to show it to).
- Exactly three entries, one of each tier, when the array is present. `text` is required, trimmed, 1 to 160 characters. No em or en dashes. Second person or impersonal thought voice.
- Optional `requires` uses the existing `Condition` schema. The engine must not serve that tier until the condition holds.
- A gating lead (an id in `accuseGate.closedLeadIds`) should have a `hints` array. Validator: warning until every gating lead in a public case has one, then error. Non-gating leads may have one later; it is not required.
- **Server-only.** Do not copy `hints` into `getPublicCaseView`, `PublicProgress`, or any other client payload. Only the single served `text` leaves the server, and only after the player asks. If the array were public, a player could read every tier from the case payload without using a hint and without the "solved with help" flag. Standing `hint` stays public, so it must stay gentle (see leak rules).
- Do not replace or overload the existing `hint` field. The standing line and the requestable ladder do different jobs.

## How the engine picks a hint

No model calls. The engine owns the choice, the cooldown, and the flag.

1. Refuse if the case is closed (same 409 as today's hint route).
2. Refuse, without consuming a tier or setting the helped flag, if the player has not yet taken a real action: no location search, no interrogation exchange, and no evidence beyond what was initially available. A fresh game does not get a thought handed to it.
3. Share the existing hint cooldown (3 turns), or a matching one. A cooldown or "nothing further" refusal does not consume a tier, does not count as a save, and does not set the flag. A "none" contradiction answer already works this way.
4. A lead is eligible only while its state is `open`. Hidden and closed leads never receive a stepped hint. (If a lead closes as soon as its key clue is found, tier 3 has to be a last action that obtains that clue, or a "show it to" action that is reachable before the close. Do not serve hints after the lead has closed.)
5. Only serve a tier whose `requires`, if any, holds against the current state, and that still points at something the player has already found or can reach next (the close condition is still unmet, and any clue or room the text depends on is in hand or currently findable).
6. If the request includes a `leadId`, only that lead is considered. If it is missing, hidden, closed, or has no eligible unused tier, refuse with an in-character "nothing further occurs to you" line.
7. If no `leadId` is sent, pick among eligible open leads, preferring ids in `accuseGate.closedLeadIds`, then case order.
8. For the chosen lead, serve the **most specific** unused tier whose `requires` holds. Skip earlier tiers that are already obsolete (a later unused tier's `requires` also holds) without marking the skipped ones as used. A late asker can receive tier 3 on the first request; that still counts as using a hint.
9. Never skip ahead to a tier whose `requires` is unmet. Never invent fallback wording. If no authored tier is eligible, fall back to today's contradiction hint when the request did not name a `leadId`.

Suggested request: today's `{ caseId?, stateToken? }` plus optional `leadId`. Suggested response: keep `line` as the thought the notebook types, and distinguish kind so the client can tell a lead thought from a contradiction hint (for example `kind: "lead" | "contradiction"` and, for a lead, `{ leadId, tier }`). Dexter can settle the exact fields.

The Hint control in the notebook (Toon's typed note) is the natural place to ask for a lead's next thought. The existing contradiction button can stay, or `/api/hint` can route to a lead thought first and fall back to a contradiction. Either is fine so long as the picker above holds.

## "Solved with help"

- New game-state fields (names up to Dexter): a count of served lead hints, and which tiers of which leads have been served, so a resumed save does not re-offer or drop the flag.
- The first time an authored lead hint is actually delivered, set a `solvedWithHelp` flag (or derive it from the count).
- A win with that flag still plays the normal ending and still reveals the solution. The ending screen also marks the win as "Solved with help", in the same spirit as today's sloppy rating. Optional: an `endings.helpedRemark` line, like `sloppyRemark`, appended after the ending. If a win is both sloppy and helped, show both.
- A loss never shows the mark (the player did not solve). The flag may still be in the saved state.
- Recommendation: only authored **lead** hints set the flag. Today's contradiction hints already exist in live play with no ending penalty; folding them in would change current Blackwood. George can override this.
- The flag does not change the win rule, the accuse gate, or citation grading.

## Save interaction

Using a delivered lead hint counts as a save. On a successful serve: write the new hint fields into the signed token, bump the save version, and persist (same path as any other state-changing action). A refused request is not a save. If the database is down, the signed token still carries the flag and the used tiers, the same way other progress does.

## Leak rules

These apply to standing `hint` strings and to every stepped `text`.

- Never name the killer or the helper, or point at them as the answer ("the person who did it", "the one who helped").
- Never state a conclusion: a motive, a true time of death, a broken alibi presented as fact, a relationship revealed ("that is not hate"), or the final deduction of who did it.
- Never skip the deduction. A hint may point at the next room, clue, or person to ask. It may not tell the player what to conclude once they get there.
- Tier 3 may say who to show a found clue to, by role or by a fact already in hand ("the man who swears he never left her side", "the Chief", "the guest the Commodore meant to see at a quarter to ten"). It must still leave the conclusion to the player.
- Hints only point at clues the player has found or can reach next. That is why later tiers have `requires`.
- Standing `hint` is public while the lead is open, and in Blackwood every standing hint is also treated as public text for the "do not name unfound clues" check. It must not name hidden evidence or its hiding place (for Blackwood: no scuttle, ashes, footprint, hobnail, solicitor, new will, burned/burnt, charred). Stepped texts can be more specific because they are server-only until served.
- Tallyho texts use 1936 period vocabulary and must pass the case `setting.vocabulary` list (no banned words; prefer phonograph, Cheer-Box, wireless, chartroom, heel recorder).
- No em or en dashes. Prefer 160 characters or fewer (standing `hint` may use the schema max of 240).

## Test ideas

- Serving a hint sets the flag, increments the count, records the tier, and (once saves ship) bumps the save version.
- A second request on the same lead, after cooldown, returns the next eligible tier, or "nothing further" when all eligible tiers are used.
- No request before a real action, on a hidden or closed lead, or during cooldown, sets the flag or consumes a tier.
- A late-game first request on a lead whose later `requires` already hold receives the most specific eligible tier, not an obsolete tier 1, and still sets the flag.
- The fastest legal path is unchanged (Blackwood 10, Tallyho 32). Hints are never required to win.
- Typecheck and validator: unresolved ids in `requires`, a missing tier, a text over 160, a gating lead without `hints` (warning, then error).
- Leak corpus: concatenating every standing `hint`, every stepped `text`, and every served combination must not contain the murderer or accomplice's name, "did it", the true motive label, or Tallyho's true time (21:52) as an answer. Include Gremlin's attack: ask for every hint, on every gating lead, in every order, and stitch them together; the stitched set still must not yield the solution.
- Public view and progress never include unserved `hints` arrays. A finished game reopened from a save still shows "Solved with help" if a lead hint was used.
- No live model calls in any of the above.

## Standing hint rewrites in this PR

These stay in the current `hint` field. Stepped texts are documented below and wait for the schema.

| Case | Lead | Why it leaked | New standing hint |
| --- | --- | --- | --- |
| Tallyho | `lead-motive` | Open from the start. "Five people stood to lose something by midnight. Which loss was worth a man's life?" framed the solution as picking the fatal item from the Midnight Announcement. | Find out what he meant to say at midnight. The speech may still be somewhere in his cabin. |
| Tallyho | `lead-stager` | "Find out how, and who stood behind the curtain" pointed at the helper's exact move. | That cheer came out of a box, not a throat. Someone had to start it. Ask who could have reached the chartroom when it played. |
| Tallyho | `lead-recipe` | "That is not hate" stated the conclusion about the galley deal. | Two people who claim to hate each other's trade cannot meet each other's eyes. Ask what business they had in common tonight. |
| Blackwood | `lead-alibi` | "Somebody's story is going to spring a leak. Find whose, and make them say so" asserted that the joint alibi is false and that someone will confess it. | Two people swear they never left each other's side. Ask whether anyone in the nearby rooms heard otherwise. |
| Blackwood | `lead-motive` | Mild: "somebody in this house is better off tonight" stated a benefit as fact, and the lead is open from the start. Tightened to a paper trail, with no named beneficiary. | A quarrel over money leaves a paper trail. Ask what they were arguing about, then see whether any of those papers are still in the house. |

Other standing hints were audited and left as they are (including Tallyho `lead-alibi` and `lead-time`, and Blackwood `lead-letter`, which tests still require to say "the letter was gone" and not "bare").

## Authored three-step texts

Gating leads only. 18 texts, all 160 characters or under. `requires` is written in the same Condition shape the engine already uses.

### Blackwood (2 leads, 6 texts)

Accuse gate closes on `lead-alibi` and `lead-motive`.

#### `lead-motive` (closes when `burned-letter` is found)

1. Where to look. No extra `requires`.
   "His lordship argued about money tonight. Ask who heard the quarrel, then look through the rooms he used for any paper that went missing."
2. What to look at. `requires`: `{ "mode": "all", "interrogated": [{ "characterId": "reginald", "minExchanges": 2 }], "evidenceIds": ["silver-candlestick"] }`
   "The letter that lay open on his desk is gone. The dining room is where people sat after that, and a fire was burning there."
3. What to do. `requires`: `{ "mode": "all", "evidenceIds": ["library-key"], "leadIds": ["lead-letter"] }`
   "The dining-room fire is still going. You could rake the grate before the last of that letter is gone."

The lead closes as soon as the letter is found, so tier 3 is the last search, not "show the letter to the person it concerns". That showing is useful, but it happens after the lead has already closed.

#### `lead-alibi` (closes when any of `s-reginald-theft`, `s-archibald-false-alibi`, `s-gregory-saw-victoria` is revealed)

1. Where to look. No extra `requires`.
   "Two people claim they spent every minute together in the dark. You might test that against what the servants' rooms and the hall can tell you."
2. What to look at. `requires`: `{ "mode": "any", "searchedLocationIds": ["kitchen", "hall"], "evidenceIds": ["library-key"] }`
   "The butler was in the servants' rooms while the lights were out. Ask what he heard through the door."
3. What to do. `requires`: `{ "mode": "any", "evidenceIds": ["library-key", "burned-letter", "muddy-footprint"], "secretIds": ["s-gregory-in-hall"] }`
   "Show what you found in the dining room to the man who swears he never left her side, or ask the man who was in the hall what the lightning showed him."

Tier 3 names neither the killer nor the witness by given name. "Her side" is the joint-alibi partner the player already heard about once the lead is open.

### Tallyho (4 leads, 12 texts)

Accuse gate closes on `lead-time`, `lead-alibi`, `lead-stager`, and `lead-motive`. Period vocabulary; no banned setting words; never name Zippelli or Bilge; never give 21:52 as the time of death.

#### `lead-time` (closes when `marmalade-run` is found)

1. Where to look. No extra `requires`.
   "Everyone is certain of 22:41. When a room is this sticky, the mess may keep better time than a watch."
2. What to look at. `requires`: `{ "evidenceIds": ["smashed-watch"] }`
   "The watch lies in one sticky corner, yet the marmalade pooled somewhere else. Below decks, a machine keeps a record of which way the ship leans."
3. What to do. `requires`: `{ "evidenceIds": ["heel-chart"] }`
   "Take that chart back to the stateroom. See whether the marmalade ran downhill at the same minute the watch claims."

#### `lead-alibi` (closes when `s-ottilie-bridge-visits`, `s-gherkina-recipe-buy`, `s-boris-saw-shadows`, and `s-percy-goat` are all revealed)

1. Where to look. No extra `requires`.
   "A hollow BONK was heard long before the cheer. Place everyone at that minute, not at the time of the cheer."
2. What to look at. No extra `requires` (the lead only opens after a first BONK witness).
   "Three people were in the open air around that minute. The others should be able to say where they stood when the BONK sounded."
3. What to do. `requires`: `{ "mode": "any", "evidenceIds": ["heel-chart", "turnip-recipe", "goat-evidence"] }`
   "Ask the Chief about the times she left her post. Then make sure the stories from the boat deck all agree on the minute."

Do not say who was alone, or "two on the bridge". That count is a recap in the closed line, after the lead is solved.

#### `lead-stager` (opens when `cheer-cylinder` is found; closes when that clue is held and `s-ottilie-curtain` is revealed)

1. Where to look. No extra `requires` (the Cheer-Box is already in hand).
   "The Cheer-Box has no clockwork timer. Someone had to stand there and start it by hand when the ship heard the cheer."
2. What to look at. No extra `requires`.
   "The chartroom door lists who holds a key. Ask who was on the bridge around 22:38, and what they were doing."
3. What to do. `requires`: `{ "mode": "any", "evidenceIds": ["heel-chart"], "secretIds": ["s-ottilie-bridge-visits"] }`
   "Show the Cheer-Box to the Chief and ask what she heard the last time she was on the bridge."

The Chief is a witness, not the helper. The hint does not mention the curtain, and does not name the Captain.

#### `lead-motive` (closes when `route-sheet` and `crock-13` are both found)

1. Where to look. No extra `requires`.
   "Find out what he meant to say at midnight. The speech may still be somewhere in his cabin."
2. What to look at. `requires`: `{ "evidenceIds": ["midnight-notes"] }`
   "The notes mention a numbered crock and a course that is not the one on the posters. The chartroom may show where the ship is really going."
3. What to do. `requires`: `{ "evidenceIds": ["route-sheet"] }`
   "Show the speech notes to the guest the Commodore meant to see at a quarter to ten, then search the Grand Saloon props for those crocks."

Tier 3 uses a margin appointment the player can already read on the notes. It does not name that guest, and it does not say what is in the crocks.

## Counts

- Blackwood: 2 gating leads, 6 stepped texts, plus 2 standing rewrites (`lead-motive`, `lead-alibi`).
- Tallyho: 4 gating leads, 12 stepped texts, plus 3 standing rewrites (`lead-motive`, `lead-stager`, `lead-recipe`).
- Total stepped texts authored: 18. None of them are in case JSON yet.

## What still needs Dexter (and George)

- Schema, loader, `POST /api/hint` (or a sibling route), game-state fields, ending badge, and the tests above. Agatha will fill the arrays in a follow-up PR once that schema is on main.
- Whether contradiction hints also mark "solved with help" (recommendation: no).
- Optional `endings.helpedRemark` copy, if you want a spoken line as well as the badge.
- Toon: the typed-note treatment and the typewriter tap.
- Gremlin: milk the served hints for the solution on a preview, once this is built.
- How to Play will need a short, spoiler-free note when the button ships. Not in this PR.
