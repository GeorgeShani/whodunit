# WHODUNIT?! sound notes: the noir sound pass

Direction (George, via Marvin): **detective noir**, a rainy 1940s night, smoky jazz and shadows, with Looney Tunes slapstick only as light seasoning. Every sound must fit its moment. **Victory/fanfare is for the solved ending only.** Everything new is synthesized in code (numpy/scipy, `scripts/audio/`), original, CC0.

> **Honesty note:** these sounds were designed and checked by measurement (loudness, peak, spectrograms, decode tests). Nobody has listened to them. Treat the timbres as unreviewed drafts and have a person play the preview zip before sign-off.

## 1. What changed in this PR

- **25 new cues** (themes, case-open sting, noir clue stinger, emotion stings, heartbeat loops, gavel/accusation roll, confrontation, breakdown, contradiction, typewriter/paper/search foley, door creak, two ambient beds) and **all 17 existing cues re-mastered** (same file names and keys) to one loudness policy, mono, smaller. `rain_loop` was rebuilt as a 30 s mono seamless loop (943 KB -> 148 KB ogg).
- Total shipped audio (ogg + mp3): **2.78 MB -> 2.22 MB (-572 KB, -20 %)** while going from 17 to 42 cues. ogg alone: 1362 KB -> 1014 KB (-348 KB); mp3 alone: 1482 KB -> 1258 KB (-224 KB). The 17 old cues now weigh 403 KB ogg / 449 KB mp3; the 25 new ones add 611 KB ogg / 809 KB mp3.
- **No component or layout file is touched.** Because the audio manager has no API for beds, heartbeat, ducking or reduced motion, nothing new is *wired*: until Dexter applies the ask in section 8 the game plays the old mapping with the re-mastered files (and, notably, the START button still plays `fanfare`). `sync-assets` copies all 84 files (checked), `.md` stays out of `public/`.
- Verified: `npm run typecheck`, `npm run lint`, `npm test` (454 tests), `npm run build` all pass on this branch.

## 2. Audit of the live game (https://whodunit-game.vercel.app)

Measured on the shipped files (the live game serves byte-identical copies of `assets/audio/*`, verified with `curl | cmp` for all 34 files on https://whodunit-game.vercel.app/assets/audio/). Loudness via ffmpeg `ebur128=peak=true`, peak via `astats`.

**What is weak or missing, by area**

- **Opening the case (title Start): wrong mood.** START CASE plays `fanfare` (brass victory). Players read it as "you won" before the game starts.
- **Ambience:** one bed for everything (`rain_loop`), none on the title, no manor/library distinction. It is **943 KB ogg / 1.0 MB mp3** (stereo, 168 kbps, 45 s), the single biggest file (68 % of the ogg payload), for a quiet noise bed. No manor creaks/wind/music-box, no library clock/thunder character.
- **UI taps:** every button plays `dialogue_pop_2` at 0.3: a cartoon bloop (-18.5 LUFS file, effective about -29), identical to the dialogue blip. Notebook, search and evidence actions are silent. No typewriter/paper/foley.
- **Emotion stings:** the pose stings are slapstick-only (`door_slam`, `slide_whistle_down`, `boing`, `boing`, `wah_wah`); they do not distinguish fear from surprise in a noir way; **`sad` plays the 3.3 s "you lose" `wah_wah` on every sad reply**.
- **Stress / breakdown:** stress is silent (meter only); breakdown = `thunder` + `surprise_sting` with no lightning (thunder without a flash is a non sequitur).
- **Contradiction:** `impact` + `surprise_sting` fired 180 ms apart, two long tails smeared.
- **Confrontation:** a single `impact` bonk; no tension build.
- **Accusation:** a lone 0.6 s `impact`; no drum roll, no gavel/cymbal, nothing that says "this is the verdict".
- **Solved ending:** thunder + `fanfare`: correct, but nothing carries into the end screen (silence after 3 s).
- **Wrong ending:** `siren` (4 s) starts at 700 ms and `wah_wah` at 1000 ms, so they overlap; a police siren also says "justice arrives", the opposite of a lost case. An extra `wah_wah` fires again on the "escaped" line.
- **Loudness balance (measured, before):** file loudness -15.9 to -20.4 LUFS (a 4.5 LU spread, bed excluded; most "-16" claims are right, `impact` -20.4, `footsteps_sneak` -18.3, `door_slam` -18.5). True peaks above the -1 dBTP target: `thunder_1` **-0.4**, `fanfare` -0.7, `surprise_sting` -0.8, `footsteps_sneak` -0.8, `thunder_2` -0.9, `impact` -0.9, `dialogue_pop_1` -0.9 (mp3 `thunder_1` -0.8, `surprise_sting` -0.7). Nothing clips (no sample at full scale), but they have no headroom for lossy overshoot. `rain_loop` -20.3 LUFS is a bed but sits only ~4 LU under the stings **at gain 1.0**, which is what iOS plays (see mobile).
- **Sizes:** 17 cues x 2 formats = **2.78 MB** total (ogg 1.33 MB, mp3 1.45 MB); every cue is 96 kbps (stereo thunder/rain 160 kbps); one-shots of 0.1 s are 320 kbps (codec header dominated). `unlock()` preloads all of it on the first tap.
- **Mobile:** see section 7 (iOS ignores `volume`; no `visibilitychange`; ogg choice on Safari 17.4-18.3; unlock only on pointerdown/keydown).

## 3. Sound-to-event map

"NOW" is read from the source (`components/...` line numbers refer to main at b707dd7). "INSTEAD" keys are the new cues; the old keys stay valid.

| # | Event | Plays NOW (cue key, where) | Should play INSTEAD (cue key + description) | Flag |
|---|---|---|---|---|
| 1 | Title screen idle (before the first tap) | Silence (browsers block audio; `Game.tsx:218` stops the bed on `title`) | Silence until the first gesture. Then `rain_loop` very quietly + `theme_noir_minor` once (muted trumpet, brush jazz, minor key) | Title has no mood at all |
| 2 | **Title Start / opening the case** | **`fanfare` gain 0.8** (`TitleScreen.tsx:48`): a C-major brass "ta-ta-ta-DAAA" + timpani. Why it sounds like a win: the cue README listed `fanfare` for "case solved / culprit revealed / **title card**", and ART_BIBLE §6 used it for "Clue discovered", so the code wired it as the START CASE sting | `case_open`: door creak, two clock ticks, then a low cello/bass sting under a muted-piano Cm(add9) chord; 6.7 s, unresolved, not triumphant. Rain bed continues | **MISMATCH (victory sound at the opening)** |
| 3 | Intro screen | Single `rain_loop` bed @0.22 starts on the first non-title screen (`Game.tsx:218-220`) | `bed_manor` (drone, wind, creaks, distant music box) | Bed is not scene-aware; same bed everywhere |
| 4 | Suspect select / manor hall | Same `rain_loop`; picking a suspect plays `slide_whistle_up` (`Game.tsx:576`) | `bed_manor`; entering a room = `door_creak` (whistle only as 0.2-gain seasoning) | Cartoon zip as a room entrance |
| 5 | Entering a scene (interrogation / library) | `rain_loop` + `slide_whistle_up` + `ui_click` | `bed_library` crossfade (indoor rain, distant thunder, clock tick) + `door_creak` | |
| 6 | Searching a location | **Silence** while the request runs (only `ui_click` on the button) | `search_rustle` at request start (tiptoe steps, drawer/paper rustle, small magnifier tink); `ui_tap` if nothing is found | **Missing** |
| 7 | Finding a clue | `clue_ding` (`DiscoverySting.tsx:19`): bright glockenspiel ding-DING | `clue_stinger` (low felt-piano "dun-dun" + vibraphone shimmer), then `typewriter_tap` ~700 ms later (note written) | Tone mismatch (cheerful for a noir reveal) |
| 8 | Hint button | `clue_ding` if a hint exists, else `boing` (`Game.tsx:528`) | `clue_stinger` gain 0.6 / `ui_tap` | `boing` is off-theme |
| 9 | Opening / closing the notebook | Silence (only `ui_click` if it goes through `CartoonButton`) | `ui_paper` (paper rustle + flap); `typewriter_return` for "entry added" | **Missing** |
| 10 | Interrogation question asked (send) | `ui_click` (= `dialogue_pop_2` @0.3, a cartoon bloop) | `ui_tap` (soft wooden desk tick, quietest cue) | Cartoon blip on every button |
| 11 | Reply arrives, same pose | `dialogue_pop` x3 @0.5 (`replySfx`) | Keep, gain 0.35 (it plays every line; make it recede) | OK |
| 12 | Emotion: neutral / talking (calm, relieved, amused->talking) | `dialogue_pop` | `dialogue_pop` (unchanged) | OK |
| 13 | Emotion: angry (angry; defensive->angry; suspicious->angry) | `door_slam` | `emo_angry`: growling plunger-muted trombone (Ab2) + wood thump | Door slam = exit sound, not anger |
| 14 | Emotion: nervous (nervous, scared, flustered) | `slide_whistle_down` | `emo_nervous`: high violin shiver + two skittish pizzicato ticks | Cartoon slide whistle |
| 15 | Emotion: shocked (shocked, panicked) | `boing` | `emo_shocked`: orchestral mini-stab (tritone) + quick xylophone zip (the slapstick seasoning) | OK-ish, now noir + gag |
| 16 | Emotion: smug (smug, amused, suspicious) | `boing` gain 0.32 | `emo_smug`: lazy muted-trumpet slide-up "waaah-hah" + finger-snap tick | |
| 17 | Emotion: sad | **`wah_wah`** (3.3 s full sad trombone, `emotion-map.ts` POSE_CUES.sad) | `emo_sad`: two soft muted-trombone notes sagging down (1.8 s) | **MISMATCH: the "you lose" cue plays on every sad reply** |
| 18 | Stress rising | **Silence** (meter only) | `heartbeat_slow` (31-60) -> `heartbeat_mid` (61-80) -> `heartbeat_fast` (81-100) loops | **Missing** |
| 19 | Breakdown (stress 96+) | `thunder` + `surprise_sting`@180 ms (`ContradictionBeat.tsx:27-28`) | `breakdown_crack`: glass crack + shrieking string cluster + falling slide whistle + timpani; stop heartbeat | Thunder with no lightning flash |
| 20 | Presenting evidence | Silence at the press, then the normal reply | `ui_paper` on press, then the reply's emotion cue | **Missing** |
| 21 | Contradiction (a lie breaks) | `impact` + `surprise_sting` gain 0.7 @180 ms (stack of two) | `contradiction_stab`: muted-brass "dun-DUN" tritone + piano + timpani, one cue | Two cues smeared together |
| 22 | Confrontation (two suspects) | `impact` (`Game.tsx:599`) | `confront_sting`: stalking pizzicato then a dissonant string stab + timpani | Bonk is slapstick, not tension |
| 23 | Accusation (verdict starts) | `impact` @0 + shake @120 ms (`sequence.ts:119`) | `accusation_roll`: 1.2 s snare roll + timpani + cymbal swell landing on a gavel bang (2.9 s); shake at 1200 ms | Thin for the biggest moment |
| 24 | Solved ending | `thunder` @700 + flash, `fanfare` @1600 + punch-in/hop | thunder @1300 (+flash), `fanfare` @2400, `theme_resolved` @5800; bed ducked then faded | **The only place for the fanfare** |
| 25 | Wrong accusation ending | `siren` @700 (4 s) overlapping `wah_wah` @1000 | `wah_wah` @1500 (muted sad trombone), `theme_noir_minor` @4900; no siren | **MISMATCH: siren (justice arrives) over a lost case; two long cues overlap** |
| 26 | Ending line "escaped" | `footsteps_sneak`, then another `wah_wah` @900 ms | `footsteps_sneak` only (wah already played) | Double sad trombone |
| 27 | Ending line citing evidence | `clue_ding` | `clue_stinger` gain 0.5 | |
| 28 | Storm flash in the library (idle) | `thunder` (alternating close crack / roll) with flash (`InterrogationStage.tsx:47`) | Unchanged with flashes; **reduced motion: `thunder_2` only @0.35** | Under reduced motion the loud crack plays with no flash |
| 29 | Mute toggle / hidden tab | Mute pauses everything and persists; **hidden tab: nothing pauses** | Mute as is; hidden tab pauses beds + heartbeat | **Missing visibilitychange** |

Pose -> engine emotion coverage (`emotion-map.ts`): neutral = calm, relieved; talking = any line being typed; angry = angry, defensive, suspicious (fallbacks); nervous = nervous, scared, flustered, panicked fallback; shocked = shocked, panicked; smug = smug, amused, suspicious; sad = sad. A sting only plays when the settled pose *changes*; otherwise `dialogue_pop`.

## 4. Cue table, new cues

Duration, size (ogg / mp3), integrated loudness (file level), max short-term LUFS (only for cues >= 3 s), true peak (ogg / mp3), loudness class, recommended manager `volume`, purpose.

| Cue | Dur (s) | ogg / mp3 KB | LUFS (I) | LUFS S-max | TP ogg / mp3 (dBTP) | class | rec. `volume` | What / where |
|---|---|---|---|---|---|---|---|---|
| `accusation_roll` | 2.91 | 27.2 / 20.4 | -18.3 | n/a (<3 s) | -1.9 / -2.8 | sting | 0.65 | ACCUSATION: 1.2 s accelerating snare roll + timpani tremolo + cymbal swell, landing on a gavel bang, low hit and cymbal crash (2.6 s). Replaces the lone `impact` bonk; the verdict cue (thunder/fanfare or wah-wah) should start after ~1.4 s. |
| `bed_library` | 30.00 | 97.3 / 176.2 | -23.9 | -22.9 | -10.9 / -11.1 | bed | 0.39 | LIBRARY BED: indoor rain on tall windows (muffled wash, glass drops), two distant thunder rolls and a faint wall-clock tick. 30 s mono, exactly periodic. |
| `bed_manor` | 36.00 | 88.9 / 211.4 | -24.1 | -22.8 | -9.0 / -9.2 | bed | 0.40 | MANOR BED: low open-fifth drone, hollow wind with a faint howl, 4 slow creaks, a distant music-box lullaby and two theremin-ish whispers. 36 s mono, exactly periodic. |
| `breakdown_crack` | 2.40 | 16.7 / 16.8 | -16.2 | n/a (<3 s) | -1.1 / -2.6 | sting | 0.51 | BREAKDOWN (stress hits 100, the suspect cracks): glass-crack ping, shrieking string cluster, a falling slide whistle (the slapstick seasoning) and a low timpani (2.3 s). |
| `case_open` | 6.71 | 35.0 / 46.3 | -16.6 | -15.6 | -1.2 / -2.3 | sting | 0.54 | OPENING THE CASE (title Start). Door creak -> two clock ticks -> low cello/bass sting under a muted-piano Cm(add9) chord that decays into the room. Moody, unresolved, NOT triumphant. |
| `clue_stinger` | 3.14 | 13.6 / 22.0 | -16.1 | -17.3 | -1.8 / -2.4 | sting | 0.51 | CLUE FOUND. Noir 'dun-dun': two low felt-piano notes (C3 then Ab2) under a vibraphone shimmer (C5, Eb5). Intriguing, not a victory. |
| `confront_sting` | 3.43 | 22.3 / 24.0 | -15.9 | -17.0 | -2.0 / -2.3 | sting | 0.50 | CONFRONTATION (two suspects face to face): tense stalking pizzicato (C - Db - C - Gb) into a dissonant string stab and low timpani (2.2 s). |
| `contradiction_stab` | 2.28 | 12.6 / 16.1 | -16.0 | n/a (<3 s) | -2.1 / -2.5 | sting | 0.50 | CONTRADICTION found (lie broken): muted-brass 'dun-DUN' stab on a Cm / Gb tritone + piano + timpani (1.4 s). Replaces impact + surprise_sting stack. |
| `door_creak` | 2.01 | 13.4 / 14.3 | -20.4 | n/a (<3 s) | -1.9 / -2.3 | foley | 0.42 | Slow wooden door creak (hinge stick-slip). Scene/room entrance foley (instead of a slide-whistle cartoon zip). |
| `emo_angry` | 0.92 | 8.2 / 6.8 | -18.7 | n/a (<3 s) | -1.3 / -1.4 | accent | 0.54 | ANGRY: growling muted trombone on Ab2 with a closing plunger and a wooden thump (0.8 s). |
| `emo_nervous` | 1.60 | 11.0 / 11.5 | -17.9 | n/a (<3 s) | -8.8 / -9.3 | accent | 0.50 | NERVOUS: high violin shiver (fast tremolo, drooping pitch) plus two skittish pizzicato ticks (1.0 s). |
| `emo_sad` | 1.77 | 12.6 / 12.5 | -18.0 | n/a (<3 s) | -5.9 / -6.3 | accent | 0.50 | SAD: two soft muted-trombone notes sagging down (Eb3 -> D3) 'wah-wahhh' (1.4 s). The long `wah_wah` stays for the wrong-accusation ending. |
| `emo_shocked` | 1.01 | 9.3 / 7.4 | -18.1 | n/a (<3 s) | -2.1 / -2.5 | accent | 0.51 | SHOCKED: orchestral mini-stab (tritone) then a quick xylophone zip up (slapstick) (0.9 s). |
| `emo_smug` | 1.20 | 11.1 / 8.6 | -18.0 | n/a (<3 s) | -5.7 / -6.4 | accent | 0.50 | SMUG: lazy muted-trumpet slide-up 'waaah-hah' (Bb3 -> D4) with a cool finger-snap-ish tick (0.9 s). |
| `gavel_bang` | 1.10 | 10.7 / 7.9 | -21.8 | n/a (<3 s) | -3.3 / -4.2 | accent | 0.78 | Gavel / judge's-block bang: wooden crack with a low thump and room. Short dramatic accent. |
| `heartbeat_fast` | 3.64 | 15.6 / 14.6 | -20.0 | -19.7 | -2.6 / -3.0 | foley | 0.32 | STRESS loop, bands 'panicking'/'breakdown' (81-100): ~132 bpm lub-dub, 8 beats, exactly loopable. |
| `heartbeat_mid` | 2.86 | 9.7 / 11.5 | -20.4 | n/a (<3 s) | -1.9 / -2.4 | foley | 0.33 | STRESS loop, band 'nervous' (61-80): ~84 bpm lub-dub, 4 beats, exactly loopable. |
| `heartbeat_slow` | 4.44 | 12.0 / 17.8 | -20.7 | -21.5 | -1.9 / -2.4 | foley | 0.34 | STRESS loop, band 'defensive' (31-60): slow ~54 bpm lub-dub, 4 beats, exactly loopable. |
| `search_rustle` | 2.39 | 19.1 / 16.8 | -19.9 | n/a (<3 s) | -2.7 / -1.0 | foley | 0.39 | SEARCHING a location: soft tiptoe footsteps, drawer/paper rustle and a small magnifier-glass tink. |
| `theme_noir_minor` | 10.22 | 73.1 / 70.4 | -16.0 | -14.9 | -2.0 / -2.2 | sting | 0.50 | TITLE / WRONG-ENDING THEME. 66 bpm C-minor smoky jazz: Harmon-muted trumpet over felt piano, walking pizzicato bass and brushes. Cm7 - Fm7 - G7b9 - Cm(add9), melody falls and stays unresolved. |
| `theme_resolved` | 7.96 | 62.7 / 54.9 | -16.0 | -14.9 | -2.2 / -2.3 | sting | 0.50 | SOLVED-ENDING THEME (plays under/after the fanfare). 100 bpm C-major jazz: same muted trumpet + piano + bass, resolves to a C6/9 chord with a brush-cymbal swell. Warm and satisfied, not a brass victory blast. |
| `typewriter_return` | 1.45 | 9.2 / 10.4 | -20.4 | n/a (<3 s) | -9.8 / -11.9 | foley | 0.42 | Notebook: carriage-return slide and bell 'ding' (new entry written / page full). |
| `typewriter_tap` | 0.67 | 8.3 / 5.0 | -24.9 | n/a (<3 s) | -1.0 / -2.2 | foley | 0.70 | Notebook: a short burst of 4 typewriter keystrokes (note added / clue written down). |
| `ui_paper` | 0.55 | 7.5 / 4.3 | -20.9 | n/a (<3 s) | -1.4 / -3.1 | foley | 0.44 | Notebook / case-file open or close: paper rustle with a soft flap. |
| `ui_tap` | 0.09 | 3.7 / 1.1 | -25.3 | n/a (<3 s) | -2.2 / -2.2 | tap | 0.46 | UI button tap: a soft wooden desk-tick (replaces the cartoon pop for buttons; very quiet). |

### Existing cues, re-mastered (same keys and file names)

| Cue | Dur (s) | ogg / mp3 KB | LUFS (I) | LUFS S-max | TP ogg / mp3 (dBTP) | class | rec. `volume` | What / where |
|---|---|---|---|---|---|---|---|---|
| `boing` | 0.95 | 10.2 / 7.0 | -18.0 | n/a (<3 s) | -2.8 / -2.9 | accent | 0.50 | Bouncy spring gag; slapstick seasoning (hint miss, shocked beats at low gain). |
| `clue_ding` | 2.15 | 13.0 / 15.2 | -18.0 | n/a (<3 s) | -7.2 / -7.8 | accent | 0.50 | Glockenspiel ding-DING (small positive blip; no longer the clue-found cue). |
| `dialogue_pop_1` | 0.11 | 3.5 / 1.3 | -20.1 | n/a (<3 s) | -2.8 / -2.9 | foley | 0.40 | Per-line dialogue blip (rotate 1-3). |
| `dialogue_pop_2` | 0.11 | 3.5 / 1.3 | -19.9 | n/a (<3 s) | -2.7 / -3.0 | foley | 0.39 | Dialogue blip variant. |
| `dialogue_pop_3` | 0.11 | 3.5 / 1.3 | -19.9 | n/a (<3 s) | -2.7 / -2.9 | foley | 0.39 | Dialogue blip variant. |
| `door_slam` | 0.98 | 10.3 / 7.2 | -19.0 | n/a (<3 s) | -2.0 / -1.7 | accent | 0.56 | Door slam: a character storming out. |
| `fanfare` | 3.27 | 24.3 / 22.9 | -16.1 | -17.5 | -1.9 / -2.2 | sting | 0.51 | Brass victory fanfare. SOLVED ENDING ONLY. |
| `footsteps_sneak` | 2.79 | 19.6 / 19.5 | -20.1 | n/a (<3 s) | -2.5 / -2.9 | foley | 0.40 | Tiptoe footsteps + pizzicato (the culprit sneaks off). |
| `impact` | 0.59 | 7.0 / 4.5 | -20.6 | n/a (<3 s) | -2.0 / -2.4 | accent | 0.68 | Bonk / collision (legacy accusation + confrontation cue; now a slapstick accent). |
| `rain_loop` | 30.00 | 144.2 / 176.2 | -23.6 | -22.5 | -11.2 / -12.1 | bed | 0.38 | RAIN BED (existing key, rebuilt): 30 s mono, exactly periodic (no crossfade seam). Outdoor storm wash, drops, gusts and one distant roll. Title screen / generic. |
| `siren` | 4.03 | 33.3 / 28.1 | -16.0 | -15.7 | -6.0 / -6.1 | sting | 0.50 | Police siren (no longer in the wrong ending; optional chase gag). |
| `slide_whistle_down` | 0.80 | 9.4 / 5.9 | -19.0 | n/a (<3 s) | -11.8 / -12.4 | accent | 0.56 | Falling slide whistle; deflating plan; seasoning only. |
| `slide_whistle_up` | 0.75 | 9.0 / 5.6 | -19.0 | n/a (<3 s) | -11.5 / -12.3 | accent | 0.56 | Rising whoop; light slapstick accent (character entrance). |
| `surprise_sting` | 2.32 | 19.1 / 16.3 | -16.7 | n/a (<3 s) | -1.4 / -2.0 | sting | 0.54 | Orchestral hit (legacy contradiction/breakdown stack). |
| `thunder_1` | 7.99 | 38.5 / 55.0 | -19.0 | -18.4 | -1.3 / -1.5 | sting | 0.71 | Close lightning crack + rumble (flash-synced thunder). |
| `thunder_2` | 8.46 | 32.1 / 58.3 | -18.6 | -17.0 | -1.7 / -2.3 | sting | 0.68 | Distant rolling thunder (use this one under reduced motion). |
| `wah_wah` | 3.32 | 22.7 / 23.3 | -16.0 | -16.1 | -2.2 / -2.8 | sting | 0.50 | Muted sad trombone: WRONG ACCUSATION ending only. |

## 5. Loudness policy and before/after

**Targets (integrated LUFS of the file, i.e. at gain 1.0):** stings -16, accents -18, foley/pops/loops -20, UI tap -22, beds -24. True peak is held at or below -1.0 dBTP for **both** the ogg and the mp3 (the mastering script re-encodes with less gain until the decoded lossy file is under -1.0 dBTP). No file has samples at full scale (`astats` peak <= -1.0 dBFS everywhere).

Cues with transients cannot reach their class target without squashing the sound: `gavel_bang` (-21.8), `typewriter_tap` (-24.9), `ui_tap` (-25.3), `accusation_roll` (-18.3), `thunder_*` (-19.0/-18.6, previously -17.3/-17.2 at a hotter, less safe peak) land below their target on purpose. Sub-second cues are within about 1 LU of the target because BS.1770 gating on <1 s files is coarse (the build measures with pyloudnorm, the report with ffmpeg).

Why beds are -24 and not -30 at file level: the manager multiplies the file by `volume`. With the recommended bed gain 0.40 the bed plays at about -32 LUFS effective and ducks to 0.16 (about -40 LUFS). On iOS Safari the HTMLAudio `volume` is ignored, so the bed plays at file level (-24, still 8 LU under the stings) rather than blasting; shipping beds at -30 file level would have made them inaudible on desktop with the existing 0.22 volume.

Full before/after table (ogg as shipped; "new" = no before):

| Cue | class (target LUFS) | I before | I after | TP before | TP after ogg | TP after mp3 | dur before → after (s) | ogg KB before → after |
|---|---|---|---|---|---|---|---|---|
| `accusation_roll` | sting (-16) | new | -18.3 | new | -1.9 | -2.8 | new → 2.91 | new → 27.2 |
| `bed_library` | bed (-24) | new | -23.9 | new | -10.9 | -11.1 | new → 30.00 | new → 97.3 |
| `bed_manor` | bed (-24) | new | -24.1 | new | -9.0 | -9.2 | new → 36.00 | new → 88.9 |
| `breakdown_crack` | sting (-16) | new | -16.2 | new | -1.1 | -2.6 | new → 2.40 | new → 16.7 |
| `case_open` | sting (-16) | new | -16.6 | new | -1.2 | -2.3 | new → 6.71 | new → 35.0 |
| `clue_stinger` | sting (-16) | new | -16.1 | new | -1.8 | -2.4 | new → 3.14 | new → 13.6 |
| `confront_sting` | sting (-16) | new | -15.9 | new | -2.0 | -2.3 | new → 3.43 | new → 22.3 |
| `contradiction_stab` | sting (-16) | new | -16.0 | new | -2.1 | -2.5 | new → 2.28 | new → 12.6 |
| `door_creak` | foley (-20) | new | -20.4 | new | -1.9 | -2.3 | new → 2.01 | new → 13.4 |
| `emo_angry` | accent (-18) | new | -18.7 | new | -1.3 | -1.4 | new → 0.92 | new → 8.2 |
| `emo_nervous` | accent (-18) | new | -17.9 | new | -8.8 | -9.3 | new → 1.60 | new → 11.0 |
| `emo_sad` | accent (-18) | new | -18.0 | new | -5.9 | -6.3 | new → 1.77 | new → 12.6 |
| `emo_shocked` | accent (-18) | new | -18.1 | new | -2.1 | -2.5 | new → 1.01 | new → 9.3 |
| `emo_smug` | accent (-18) | new | -18.0 | new | -5.7 | -6.4 | new → 1.20 | new → 11.1 |
| `gavel_bang` | accent (-18) | new | -21.8 | new | -3.3 | -4.2 | new → 1.10 | new → 10.7 |
| `heartbeat_fast` | foley (-20) | new | -20.0 | new | -2.6 | -3.0 | new → 3.64 | new → 15.6 |
| `heartbeat_mid` | foley (-20) | new | -20.4 | new | -1.9 | -2.4 | new → 2.86 | new → 9.7 |
| `heartbeat_slow` | foley (-20) | new | -20.7 | new | -1.9 | -2.4 | new → 4.44 | new → 12.0 |
| `search_rustle` | foley (-20) | new | -19.9 | new | -2.7 | -1.0 | new → 2.39 | new → 19.1 |
| `theme_noir_minor` | sting (-16) | new | -16.0 | new | -2.0 | -2.2 | new → 10.22 | new → 73.1 |
| `theme_resolved` | sting (-16) | new | -16.0 | new | -2.2 | -2.3 | new → 7.96 | new → 62.7 |
| `typewriter_return` | foley (-20) | new | -20.4 | new | -9.8 | -11.9 | new → 1.45 | new → 9.2 |
| `typewriter_tap` | foley (-20) | new | -24.9 | new | -1.0 | -2.2 | new → 0.67 | new → 8.3 |
| `ui_paper` | foley (-20) | new | -20.9 | new | -1.4 | -3.1 | new → 0.55 | new → 7.5 |
| `ui_tap` | tap (-22) | new | -25.3 | new | -2.2 | -2.2 | new → 0.09 | new → 3.7 |
| `boing` | accent (-18) | -16.1 | -18.0 | -1.0 | -2.8 | -2.9 | 0.9 → 0.95 | 13.6 → 10.2 |
| `clue_ding` | accent (-18) | -15.9 | -18.0 | -5.1 | -7.2 | -7.8 | 2.3 → 2.15 | 18.7 → 13.0 |
| `dialogue_pop_1` | foley (-20) | -18.5 | -20.1 | -0.9 | -2.8 | -2.9 | 0.1 → 0.11 | 4.3 → 3.5 |
| `dialogue_pop_2` | foley (-20) | -18.5 | -19.9 | -1.1 | -2.7 | -3.0 | 0.1 → 0.11 | 4.3 → 3.5 |
| `dialogue_pop_3` | foley (-20) | -18.4 | -19.9 | -1.1 | -2.7 | -2.9 | 0.1 → 0.11 | 4.3 → 3.5 |
| `door_slam` | accent (-18) | -18.5 | -19.0 | -1.0 | -2.0 | -1.7 | 1.0 → 0.98 | 12.9 → 10.3 |
| `fanfare` | sting (-16) | -16.1 | -16.1 | -0.7 | -1.9 | -2.2 | 3.3 → 3.27 | 38.6 → 24.3 |
| `footsteps_sneak` | foley (-20) | -18.3 | -20.1 | -0.8 | -2.5 | -2.9 | 2.8 → 2.79 | 28.7 → 19.6 |
| `impact` | accent (-18) | -20.4 | -20.6 | -0.9 | -2.0 | -2.4 | 0.6 → 0.59 | 8.9 → 7.0 |
| `rain_loop` | bed (-24) | -20.3 | -23.6 | -8.1 | -11.2 | -12.1 | 45.0 → 30.00 | 921.5 → 144.2 |
| `siren` | sting (-16) | -16.0 | -16.0 | -6.0 | -6.0 | -6.1 | 4.1 → 4.03 | 45.2 → 33.3 |
| `slide_whistle_down` | accent (-18) | -16.9 | -19.0 | -10.1 | -11.8 | -12.4 | 0.8 → 0.80 | 12.0 → 9.4 |
| `slide_whistle_up` | accent (-18) | -17.0 | -19.0 | -10.0 | -11.5 | -12.3 | 0.8 → 0.75 | 11.6 → 9.0 |
| `surprise_sting` | sting (-16) | -16.6 | -16.7 | -0.8 | -1.4 | -2.0 | 2.3 → 2.32 | 24.3 → 19.1 |
| `thunder_1` | sting (-16) | -17.3 | -19.0 | -0.4 | -1.3 | -1.5 | 8.0 → 7.99 | 95.0 → 38.5 |
| `thunder_2` | sting (-16) | -17.2 | -18.6 | -0.9 | -1.7 | -2.3 | 8.5 → 8.46 | 85.7 → 32.1 |
| `wah_wah` | sting (-16) | -15.9 | -16.0 | -2.3 | -2.2 | -2.8 | 3.4 → 3.32 | 32.4 → 22.7 |

Chart: `sound_pass_overview.png` (in the preview folder, not in the repo).

## 6. Beds, heartbeat and ducking

| Bed | File | Length | Where | Character |
|---|---|---|---|---|
| `rain_loop` | rain_loop.ogg/.mp3 | 30 s mono | title (after the first tap) | outdoor storm wash, drops, gusts, one distant roll |
| `bed_library` | bed_library.ogg/.mp3 | 30 s mono | interrogation, confrontation, accuse | rain on tall windows (muffled), two distant thunder rolls, faint wall-clock tick |
| `bed_manor` | bed_manor.ogg/.mp3 | 36 s mono | intro, suspects, investigate | low open-fifth drone, hollow wind with a faint howl, 4 creaks, distant music-box lullaby, 2 theremin-ish whispers |

All three are **exactly periodic by construction** (random-phase spectrum -> iFFT, drone frequencies snapped to whole cycles per loop, events and reverb tails wrapped around the end, filters run on a tiled signal), so no crossfade is needed and there is no seam. Verified numerically, see section 7.

| Situation | Bed gain (1.0 = file level, -24 LUFS) | Effective LUFS |
|---|---|---|
| normal | **0.40** (the brief's 0.25 assumed a -20 LUFS file; same result) | about -32 |
| speech / TTS playing (none exists yet) | **0.16** | about -40 |
| long sting playing (case_open, accusation_roll, breakdown_crack, wah_wah, fanfare, theme_*) | 0.16 for its duration + 300 ms | about -40 |
| heartbeat loop running | 0.25 | about -36 |
| ending, end screen visible | fade to 0 over 3 s | |

Attack 150 ms, release 600 ms; bed-to-bed crossfade 1.2 s.

**Heartbeat levels** (engine `STRESS_BANDS`): none (calm 0-30), `heartbeat_slow` 54 bpm (defensive 31-60), `heartbeat_mid` 84 bpm (nervous 61-80), `heartbeat_fast` 132 bpm (panicking 81-95 and breakdown 96-100). Each is a lub-dub with a 100-300 Hz body so it is audible on phone speakers (a pure 50 Hz thump would vanish). Loops are exactly 4 / 4 / 8 beats, tails wrapped, seamless. Suggested volume 0.35.

## 7. Mobile (Safari and Chrome) review

Verified = read in the code or run in a browser here. **Headless Chromium (desktop and a Pixel-7 mobile emulation) was available; WebKit/Safari was not** (the box only has Chromium), so nothing below about Safari was run.

| Concern | Finding | How verified |
|---|---|---|
| Unlock after the first tap | `useAudioUnlock` (`MuteToggle.tsx`) listens for `pointerdown` and `keydown` once and calls `unlock()`; `TitleScreen` also calls `unlock()` + `play("fanfare")` inside the START click. `unlock()` only calls `load()` on each element; it never starts them and never resumes an `AudioContext` (the manager does not use WebAudio). On desktop Chrome/Firefox and Android Chrome a gesture-initiated `play()` on any element later works once the page has user activation, so this is fine there. **On iOS Safari an `HTMLAudioElement` may only start from a gesture if that element was started inside one;** replies arrive from `fetch` callbacks and timers, so every cue other than the one played in the START click can be blocked (the `play()` rejection is swallowed by `.catch(() => {})`). iOS also wants `touchend`/`click` rather than `pointerdown` historically. Widely reported WebKit behaviour, not reproduced here; high risk, needs a real iPhone | Code reading; unit tests in `tests/components/audio.test.ts` cover the manager with fakes. **Not tested on iOS** |
| ogg vs mp3 selection | `extension()` probes `canPlayType('audio/ogg; codecs="vorbis"')` and takes ogg on any truthy string. caniuse: Ogg Vorbis in `<audio>` is **partial on Safari 14.1-18.3 (iOS 17.4-18.3), unsupported on iOS <= 17.3, full on Safari/iOS 18.4+**. A "maybe/probably" from a partial-support build would select a file that may not play, with no fallback on `error`. Fix in the Dexter ask: prefer mp3 on Safari < 18.4 and swap to mp3 on an `error` event | Code reading + caniuse (searched 2026-10-04). Chromium: `canPlayType` = "probably" for both; **all 42 ogg and 42 mp3 files decode with `decodeAudioData` and load/play in `<audio>`** in desktop and mobile-emulated Chromium (`scripts/audio/decode_test.cjs`: 42/42 ogg and 42/42 mp3 OK in both; the decoded mp3 length equals the ogg length to the millisecond, i.e. Chromium trims the mp3 padding in `decodeAudioData`; max decoded peak 0.894 = -1.0 dBFS, no clipping; decode <= 61 ms per file) |
| Gain control | **iOS Safari does not honour `HTMLMediaElement.volume`** (read-only, reads 1). The manager sets `el.volume` for every cue, the 0.22 bed level and the 1 s fades, so on iPhone all gains/fades/ducking are no-ops: the bed would play at file level. Recorded in the ask: route through WebAudio `GainNode`s (note WebKit bug 276813: GainNode on a media element playing WebM/Opus is ignored, MP4/AAC works; with `decodeAudioData` buffers there is no issue) | MDN/Apple docs + search; code reading |
| Mute respected | `setMuted(true)` pauses every element and stops fades; `play()` returns false when muted; unmuting restarts the bed if requested; the flag persists in `localStorage`. Good. A heartbeat/bed API must go through the same flag | Code reading + existing unit tests |
| `prefers-reduced-motion` | `audio.ts` knows nothing about it. Visual effects respect it (`useReducedMotion`, `verdictEvents(won, reduced)`), but **thunder is explicitly kept ("audio only")**: `InterrogationStage.useStorm` still plays the close `thunder_1` crack every storm with no flash, and `verdictEvents` keeps the flash-synced thunder. Decision: under reduced motion play only the distant `thunder_2` at gain 0.35 and drop flash-synced booms; scale slapstick stings x0.6. **Ambience never autoplays**: it needs a gesture and the title is silent | Code reading |
| Page hidden (`visibilitychange`) | **Not implemented anywhere** (`rg visibilitychange` finds nothing in `app components lib engine`). The bed keeps playing when the user switches tabs/apps on Chrome Android and can on iOS; with the new heartbeat loops this matters more. Ask: pause beds/heartbeat on hidden, resume on visible if not muted | Code reading + `rg` |
| Loop quality | HTMLAudio `loop = true` is not sample-accurate; mp3 adds encoder padding (about 25-50 ms), so an mp3 bed or heartbeat has a tiny gap per loop. The beds are exactly periodic by construction (no crossfade needed) and the **ogg** decodes with a seam jump no larger than the signal's own sample differences; WebAudio `loop = true` removes the gap in both formats. | `scripts/audio/loopcheck.py` (numbers below) |
| Data / preload | `unlock()` preloads every cue. After this pass all 42 ogg total ~1.0 MB (was 1.39 MB for 17), mp3 1.29 MB (was 1.52). Recommended preload groups: core ~270 KB, rest per screen. Beds are 89-144 KB ogg each (mp3 176-211 KB) | `measure.py` |
| Autoplay with sound before a gesture | None: `getAudio()` is a never-unlocked stub during SSR; the first sound is after the START click | Code reading |

Loop-seam check (decoded files joined end to start; "seam jump" is |last - first| sample; a click would be several times the 99.9th percentile of normal sample-to-sample differences):

| File | seam jump | p99.9 normal diff | RMS end / start (dBFS) | verdict |
|---|---|---|---|---|
| `bed_manor.wav` (master) | 0.0008 | 0.0149 | -23.2 / -22.3 | seamless (periodic by construction) |
| `bed_manor.ogg` / `.mp3` | 0.0014 / 0.0136 | 0.0146 / 0.0142 | -23.4 / -22.3 ; -23.7 / -22.8 | no click |
| `bed_library.wav` / `.ogg` | 0.0007 / 0.0345 | 0.0447 / 0.0462 | -24.1 / -23.8 ; -24.3 / -23.9 | no click (noise bed; seam inside normal range) |
| `rain_loop.wav` / `.ogg` | 0.0471 / 0.0280 | 0.0807 / 0.0891 | -24.9 / -25.0 ; -24.5 / -24.8 | no click |
| `heartbeat_slow/mid/fast.ogg` | 0.006 / 0.005 / 0.001 | 0.012 | tail decays to silence at the seam | no click |

## 8. Ask for Dexter (ready to paste)

```text
Hi Dexter, Toon's sound pass adds 25 new cues (assets/audio/*.ogg|mp3, branch toon/sound-pass). All existing keys and file names still work; nothing is renamed.
The wiring below is the part I did NOT touch (components/*). Do it when your mobile layout pass lands. Full rationale: docs/SOUND_NOTES.md.

A. Add the new keys to `AudioCue` (components/effects/emotion-map.ts) and to `CUES` (components/effects/audio.ts). File stem == key:
   AudioCue += "accusation_roll" | "bed_library" | "bed_manor" | "breakdown_crack" | "case_open" | "clue_stinger" | "confront_sting" | "contradiction_stab" | "door_creak" | "emo_angry" | "emo_nervous" | "emo_sad" | "emo_shocked" | "emo_smug" | "gavel_bang" | "heartbeat_fast" | "heartbeat_mid" | "heartbeat_slow" | "search_rustle" | "theme_noir_minor" | "theme_resolved" | "typewriter_return" | "typewriter_tap" | "ui_paper" | "ui_tap"
   CUES += {
  accusation_roll: { files: ["accusation_roll"], volume: 0.65, minGapMs: 3000 },
  bed_library: { files: ["bed_library"], volume: 0.40, minGapMs: 0, loop: true },
  bed_manor: { files: ["bed_manor"], volume: 0.40, minGapMs: 0, loop: true },
  breakdown_crack: { files: ["breakdown_crack"], volume: 0.51, minGapMs: 2500 },
  case_open: { files: ["case_open"], volume: 0.54, minGapMs: 4000 },
  clue_stinger: { files: ["clue_stinger"], volume: 0.51, minGapMs: 800 },
  confront_sting: { files: ["confront_sting"], volume: 0.50, minGapMs: 2000 },
  contradiction_stab: { files: ["contradiction_stab"], volume: 0.50, minGapMs: 1500 },
  door_creak: { files: ["door_creak"], volume: 0.42, minGapMs: 800 },
  emo_angry: { files: ["emo_angry"], volume: 0.54, minGapMs: 900 },
  emo_nervous: { files: ["emo_nervous"], volume: 0.50, minGapMs: 900 },
  emo_sad: { files: ["emo_sad"], volume: 0.50, minGapMs: 1200 },
  emo_shocked: { files: ["emo_shocked"], volume: 0.51, minGapMs: 900 },
  emo_smug: { files: ["emo_smug"], volume: 0.50, minGapMs: 900 },
  gavel_bang: { files: ["gavel_bang"], volume: 0.78, minGapMs: 500 },
  heartbeat_fast: { files: ["heartbeat_fast"], volume: 0.32, minGapMs: 0, loop: true },
  heartbeat_mid: { files: ["heartbeat_mid"], volume: 0.33, minGapMs: 0, loop: true },
  heartbeat_slow: { files: ["heartbeat_slow"], volume: 0.34, minGapMs: 0, loop: true },
  search_rustle: { files: ["search_rustle"], volume: 0.39, minGapMs: 1500 },
  theme_noir_minor: { files: ["theme_noir_minor"], volume: 0.50, minGapMs: 8000 },
  theme_resolved: { files: ["theme_resolved"], volume: 0.50, minGapMs: 8000 },
  typewriter_return: { files: ["typewriter_return"], volume: 0.42, minGapMs: 800 },
  typewriter_tap: { files: ["typewriter_tap"], volume: 0.70, minGapMs: 400 },
  ui_paper: { files: ["ui_paper"], volume: 0.44, minGapMs: 300 },
  ui_tap: { files: ["ui_tap"], volume: 0.46, minGapMs: 60 },
   }
   (rec. `volume` = the gain that lands each class at a coherent in-game level: stings ~-22 LUFS, accents ~-24, foley ~-28, taps ~-32, beds ~-32; existing cue volumes can stay.)
   Loops: heartbeat_*, bed_library, bed_manor, rain_loop (use .ogg where it decodes; mp3 loops have ~25-50 ms encoder padding unless decoded via WebAudio).

B. Remap events (do not rename keys; just change which key each event plays):
   - TitleScreen.tsx START: `fanfare` gain 0.8  ->  `case_open` (moody; NEVER fanfare here). `fanfare` is for the SOLVED ending only.
   - POSE_CUES stings: angry `door_slam` -> `emo_angry`; nervous `slide_whistle_down` -> `emo_nervous`; shocked `boing` -> `emo_shocked`;
     smug `boing` gain 0.32 -> `emo_smug` (gain 1); sad `wah_wah` -> `emo_sad` (the long `wah_wah` is reserved for the wrong-accusation ending). neutral/talking keep `dialogue_pop` (lower gain to 0.35).
   - CartoonButton `ui_click` (dialogue_pop_2 @0.3) -> `ui_tap` (keep the key `ui_click`, change its file to `ui_tap`, volume 0.32).
   - DiscoverySting `clue_ding` -> `clue_stinger`, then `typewriter_tap` ~700 ms later (note written). Hint found -> `clue_stinger` gain 0.6; no hint (`boing`) -> `ui_tap`.
   - onSearch (Game.tsx): play `search_rustle` when the request starts (today searching is silent).
   - Notebook open/close and "present evidence" press -> `ui_paper`.
   - Select suspect/enter interrogation (Game.tsx:576) `slide_whistle_up` -> `door_creak` (or keep the whistle at gain 0.2 as seasoning).
   - ContradictionBeat: contradiction -> single `contradiction_stab` (drop impact + surprise_sting@180ms); breakdown -> `breakdown_crack` (drop `thunder`: thunder with no lightning flash is a mismatch).
   - Confrontation start (Game.tsx:599) `impact` -> `confront_sting`.
   - Ending (components/ending/sequence.ts verdictEvents), offsets in ms from verdict start (the roll lands at 1200 ms; move shake/gavel there):
       all:    {at:0, sfx:"accusation_roll"}, {at:1200, fx:"shake"}
       solved: {at:1300, sfx:"thunder", fx:"whiteFlash"}, {at:2400, sfx:"fanfare", fx:"punchIn"}, {at:2400, fx:"hop"}, {at:5800, sfx:"theme_resolved"}
       wrong:  {at:1500, sfx:"wah_wah", fx:"desaturate"}, {at:4900, sfx:"theme_noir_minor"}      // remove `siren` (4 s, overlapped wah_wah, wrong mood)
     EndingScene "escaped" line: keep `footsteps_sneak`, delete the extra `wah_wah` @900 ms (it already played in the verdict).
     Ending lines with evidence: `clue_ding` -> `clue_stinger` gain 0.5.
   - Title: after the first gesture (unlock) start `rain_loop` quietly (bed gain 0.25) and play `theme_noir_minor` once. Never autoplay before a gesture.

C. Beds per scene (one bed at a time, 1.0-1.2 s crossfade; each bed fades in at `bed gain` below):
     title -> rain_loop | intro, suspects, investigate -> bed_manor | interrogation, confront, accuse -> bed_library
     ending -> keep bed_library ducked, fade out over 3 s once the end screen shows (so the theme sits alone) | muted/hidden tab -> paused
   Replace the single `wantAmbient`/`fade` with a `setBed(name | null)` API and a per-element fade map (today one shared `fade` handle cannot crossfade or fade heartbeat).

D. Heartbeat (stress): loop one of heartbeat_slow / heartbeat_mid / heartbeat_fast by the engine band of the suspect on screen (engine/stress.ts STRESS_BANDS):
     calm 0-30: none | defensive 31-60: heartbeat_slow | nervous 61-80: heartbeat_mid | panicking 81-95 and breakdown 96-100: heartbeat_fast
     fade in/out 400 ms; switch on band change only; stop on leaving the interrogation/confront screen, on mute, on hidden tab, and when breakdown_crack plays (resume nothing after the breakdown).
     Add `setHeartbeat(level: 0 | 1 | 2 | 3)`. Volume ~0.35; while it runs duck the bed to 0.25 (see E).

E. Ducking API: `duck(target = 0.4, ms = 150)`/`unduck(ms = 600)` on the bed bus. Bed gain 1.0 = file level (-24 LUFS). Normal bed 0.40 (~-32 LUFS effective);
     duck to 0.16 (~-40) while: any speech/TTS plays (none exists today), a long sting plays (case_open, accusation_roll, breakdown_crack, wah_wah, fanfare, theme_*) for its duration + 300 ms;
     bed 0.25 while a heartbeat loop runs. Attack 150 ms, release 600 ms.

F. prefers-reduced-motion (read `matchMedia("(prefers-reduced-motion: reduce)")` once and on change, expose `setReducedMotion(bool)`):
     - `thunder` -> only `thunder_2` (distant roll) at gain 0.35, never the close crack, and never synced to a flash (there is none). Storm scheduler: >= 45 s apart.
     - verdictEvents (reduced): drop the flash-synced `thunder` entirely; keep accusation_roll (gain 0.8), fanfare, themes.
     - Slapstick/loud stings (emo_shocked, emo_angry, breakdown_crack, contradiction_stab, door_slam, impact, boing): gain x0.6.
     - Ambient beds are NOT a motion effect; they stay (they only start after a user gesture, never on the title before a tap).

G. Mobile robustness (details in SOUND_NOTES.md section 7):
     1. iOS Safari ignores `HTMLAudioElement.volume` (always 1): every gain/duck/fade above is a no-op there. Route audio through WebAudio
        (`fetch` + `decodeAudioData` -> AudioBufferSourceNode -> GainNode(per cue) -> bus GainNode(bed/sfx) -> destination). Loops via `source.loop = true` (sample-accurate, gapless for ogg AND mp3).
     2. Unlock on `pointerdown`, `touchend` and `click` (iOS wants touchend/click): `await ctx.resume()`, play a 1-sample silent buffer. Re-resume on `visibilitychange` -> visible (iOS suspends after a call/lock) and on `statechange` = "interrupted".
        With HTMLAudio, iOS only lets an element play later (from a timer/fetch callback, as replies do) if THAT element was started inside a gesture: WebAudio avoids this; otherwise unlock every element with a muted play()/pause() on the first tap.
     3. Format pick: use ogg only if `canPlayType('audio/ogg; codecs="vorbis"') === "probably"` AND not Safari < 18.4 (caniuse: Safari 14.1-18.3 / iOS 17.4-18.3 are only *partial* Vorbis); otherwise mp3. Also fall back to mp3 on any decode/`error` event.
     4. `document.addEventListener("visibilitychange")` + `pagehide`: hidden -> pause/suspend beds + heartbeat (ctx.suspend()), visible -> resume if not muted. (Not implemented anywhere today.)
     5. Preload in groups, not "every cue on unlock": core now (ui_tap, dialogue_pop_*, case_open, rain_loop, theme_noir_minor ~270 KB ogg), the bed/stings for a screen when entering it, ending cues when /accuse opens.
     6. Keep mute: setMuted already pauses everything; with WebAudio set the master gain to 0 and ctx.suspend().
```

## 9. What was verified and what was not

Verified by running something: loudness/peak/duration/size of all 84 files (ffmpeg ebur128 + astats, `scripts/audio/measure.py`); no sample at full scale; true peak <= -1.0 dBTP on both formats; loop seams (numeric); every file decodes (`decodeAudioData`) and plays (`<audio>`) in headless Chromium desktop and Pixel-7 emulation; `typecheck`, `lint`, `test`, `build`; `sync-assets` copies every file.

Verified only by reading code: everything about unlock, gain, mute, reduced motion and `visibilitychange` behaviour on real Safari/Chrome mobile.

**Not verified:** how any of it *sounds*. I cannot listen. Pitch choices, mix balance between layers, whether the muted trumpet reads as a muted trumpet, whether the creaks sound like wood rather than a synth, whether the heartbeat is annoying after 30 s, whether the ambience is pleasant: all unknown. Also not tested: any WebKit/Safari/iOS playback, ogg-vs-mp3 selection on Safari 17.4-18.3, mp3 gapless looping, real phone-speaker response, and the in-game mix (the manager's `volume` values are computed, not auditioned).

## 10. Rebuild

```bash
cd scripts/audio
python3 -m venv .venv && .venv/bin/pip install numpy scipy soundfile pyloudnorm
./fetch_sources.sh                       # Kenney CC0 packs (only for impact, door_slam, footsteps_sneak)
.venv/bin/python make_sfx.py             # legacy cues -> masters/
WHODUNIT_MASTERS=$PWD/masters .venv/bin/python make_noir.py   # new cues -> masters/
.venv/bin/python master_all.py --legacy masters --new masters # normalise + encode into ../../assets/audio + after_report.json
python3 measure.py ../../assets/audio > after.json            # loudness / peak / size report
python3 loopcheck.py ../../assets/audio/bed_manor.ogg         # loop-seam check
```
