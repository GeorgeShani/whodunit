# WHODUNIT?! SFX kit

Theme: **1940s detective noir** (rainy night, smoky jazz, shadows) with Looney Tunes slapstick only as light seasoning. 42 cues, each as `.ogg` (Vorbis, mono, 48-64 kbps, primary) and `.mp3` (mono, fallback). Use ogg where it decodes, mp3 otherwise (Safari before 18.4 only has partial Vorbis support). For loops prefer WebAudio `source.loop` (mp3 `<audio loop>` leaves a ~25-50 ms padding gap).

**Rule: victory/fanfare is for the SOLVED ending only.** Opening the case uses `case_open`, never `fanfare`.

Full documentation (audit, event map, loudness policy, ducking, mobile notes, the ask for the audio manager): `docs/SOUND_NOTES.md`. Licenses: `LICENSES.md` (all cues synthesized in code or CC0). Build scripts: `scripts/audio/`.

## Loudness policy (file level, integrated LUFS; true peak <= -1 dBTP on ogg AND mp3, no clipping)

| Class | Target | Cues |
|---|---|---|
| sting | -16 | themes, case_open, clue_stinger, accusation_roll, confront_sting, contradiction_stab, breakdown_crack, wah_wah, fanfare, siren, surprise_sting, thunder_* |
| accent | -18 | emo_*, gavel_bang, boing, slide_whistles, impact, door_slam, clue_ding |
| foley | -20 | dialogue_pop_*, footsteps_sneak, door_creak, ui_paper, typewriter_*, search_rustle, heartbeat_* |
| tap | -22 | ui_tap |
| bed | -24 | rain_loop, bed_library, bed_manor (play at gain ~0.4, duck to ~0.16) |

Transient-heavy cues land below their class target on purpose (`gavel_bang`, `typewriter_tap`, `ui_tap`, `accusation_roll`, `thunder_*`); see the table.

## Cues (new first, then the re-mastered originals)

Columns: duration, size ogg / mp3 (KB), integrated LUFS, max short-term LUFS (>= 3 s only), true peak ogg / mp3 (dBTP), class, recommended manager `volume`, what/where.

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

## Notes

- `dialogue_pop_1..3`: pick one at random per line (optionally +-5 % `playbackRate`).
- Loops: `rain_loop`, `bed_library`, `bed_manor`, `heartbeat_slow`, `heartbeat_mid`, `heartbeat_fast`. All are exactly periodic (no crossfade seam); loop the ogg or use WebAudio.
- `thunder_1` (close crack, flash-synced) vs `thunder_2` (distant roll; the only thunder to use under `prefers-reduced-motion`, at gain ~0.35).
- Every cue is mono; the old stereo `thunder_*` / `rain_loop` were downmixed (they were decorrelated stereo noise; mono saves 40-85 % of their size).
