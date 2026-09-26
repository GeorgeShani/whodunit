# WHODUNIT?! SFX kit

1940s theatrical slapstick cartoon cues. Use `.ogg` first, `.mp3` as fallback, e.g. `new Audio()` with `canPlayType('audio/ogg')`, or Howler `src: ['x.ogg','x.mp3']`.

Mastering: mono 44.1 kHz (stereo for thunder_* and rain_loop), leading/trailing silence trimmed, integrated loudness about -16 LUFS for one-shots (peak-limited to -1 dBFS; very transient cues land at -17 to -19 LUFS because the limiter was capped to protect punch; pure-tone cues like slide whistles reach -16 LUFS with peaks well below -1 dBFS). rain_loop is an ambience bed at about -20 LUFS. Lossy encoding may nudge true peaks up to about -0.4 dBTP; no clipping.

| Cue | Files | Duration | Ch | LUFS | Peak dBFS | Intended use |
|---|---|---|---|---|---|---|
| boing | `boing.ogg` / `.mp3` | 0.95 s | mono | -16.2 | -1.05 | Bouncy pratfall, someone springing up/jumping in shock, spring-loaded gag props. |
| slide_whistle_up | `slide_whistle_up.ogg` / `.mp3` | 0.75 s | mono | -16.0 | -10.1 | Something/someone rising, sneaking up, eyebrows going up, a 'whoop' reveal. |
| slide_whistle_down | `slide_whistle_down.ogg` / `.mp3` | 0.80 s | mono | -16.0 | -10.14 | Falling, deflating, a plan collapsing, a suspect sliding under a table. |
| impact | `impact.ogg` / `.mp3` | 0.60 s | mono | -18.8 | -0.9 | Bonk on the head, collisions, a body (comically) hitting the floor, emphatic hits. |
| wah_wah | `wah_wah.ogg` / `.mp3` | 3.35 s | mono | -16.0 | -2.31 | Failure / wrong accusation / red herring 'sad trombone'. |
| thunder_1 | `thunder_1.ogg` / `.mp3` | 8.00 s | stereo | -17.3 | -0.48 | Dramatic reveal sting, lightning flash at the mansion, 'the lights go out'. |
| thunder_2 | `thunder_2.ogg` / `.mp3` | 8.46 s | stereo | -17.2 | -0.87 | Distant storm rumble under scene transitions / ominous pauses. |
| door_slam | `door_slam.ogg` / `.mp3` | 0.98 s | mono | -17.6 | -1.02 | Someone storming out, a door slammed in a detective's face, scene exits. |
| fanfare | `fanfare.ogg` / `.mp3` | 3.29 s | mono | -16.1 | -0.7 | Case solved / culprit revealed / title card. |
| siren | `siren.ogg` / `.mp3` | 4.05 s | mono | -16.0 | -5.96 | Police arriving, the inspector's car, chase gags. |
| dialogue_pop_1 | `dialogue_pop_1.ogg` / `.mp3` | 0.13 s | mono | -18.6 | -0.9 | Per-line dialogue blip (rotate 1/2/3 randomly to avoid machine-gun repetition). |
| dialogue_pop_2 | `dialogue_pop_2.ogg` / `.mp3` | 0.13 s | mono | -18.5 | -1.1 | Dialogue blip variant (+1 semitone). |
| dialogue_pop_3 | `dialogue_pop_3.ogg` / `.mp3` | 0.13 s | mono | -18.5 | -1.15 | Dialogue blip variant (-1 semitone). |
| footsteps_sneak | `footsteps_sneak.ogg` / `.mp3` | 2.80 s | mono | -18.3 | -0.87 | Detective or suspect tiptoeing / sneaking around. |
| surprise_sting | `surprise_sting.ogg` / `.mp3` | 2.33 s | mono | -16.2 | -0.85 | Surprise/shock orchestral hit (gasp-free): body discovered, twist revealed. |
| rain_loop | `rain_loop.ogg` / `.mp3` | 45.00 s | stereo | -20.3 | -8.1 | Storm ambience bed for the mansion (loop it; use the .ogg for gapless looping). |
| clue_ding | `clue_ding.ogg` / `.mp3` | 2.25 s | mono | -16.0 | -5.11 | Clue found / evidence added to notebook. |

## Notes

- `dialogue_pop_1..3`: pick one at random per line (optionally ±5% `playbackRate`) so rapid lines don't sound robotic.
- `rain_loop`: loop the **.ogg** (`loop = true` / Howler `loop: true`). MP3 encoders add padding, so the mp3 may show a tiny gap at the seam. Fade it in/out over ~1 s.
- `thunder_1` (close crack) vs `thunder_2` (distant roll): alternate them, maybe with random `playbackRate` 0.9–1.1.
- Sources, licenses and build scripts: see `LICENSES.md` and `toon-drafts/audio_tools/`.

## How each cue was made

- **boing**: Band-limited sawtooth whose pitch springs 150->~285 Hz then wobbles at 11 Hz (decaying), through a sweeping resonant band-pass (jaw-harp 'oi-ng' formant) plus a sine core and a tiny click; ~0.3 s exponential decay.
- **slide_whistle_up**: Sine (+ faint 2nd/3rd harmonics) gliding exponentially 480->1900 Hz with smoothstep timing, 6.2 Hz vibrato, pitch-tracking band-passed breath noise and a short air 'chiff' at onset.
- **slide_whistle_down**: Same slide-whistle model gliding 1900->420 Hz.
- **impact**: Hybrid: Kenney CC0 punch + wood knock for the real-world transient, a kick-drum-style synthesized thump for cartoon weight.
- **wah_wah**: Generic descending-semitone cliché Bb3-A3-Ab3-G3 (3 short + 1 long). Two slightly detuned band-limited saws with a lip 'scoop' into each note, through a time-varying resonant low-pass acting as a plunger mute (opens/closes per note, pulses 'wah-ah-ah' at 5.2 Hz on the last note which also sags flat with growing vibrato); light reverb. Not modeled on any specific recording.
- **thunder_1**: Stereo. Close strike: short band-limited noise crack + 300-3000 Hz 'tear', then a rolling rumble of low-passed brown+pink noise (260 Hz) amplitude-shaped by 5 random gaussian 'rolls' under a 1.6 s decay, sparse crackle, slow L/R drift, 2.5 s dark reverb.
- **thunder_2**: Stereo. Distant roll: no crack, 0.35 s swell, darker (160 Hz low-pass) and longer (2.2 s decay, 7 random rolls).
- **door_slam**: Hybrid of two Kenney CC0 recordings made bigger with a synthesized thump and hallway reverb.
- **fanfare**: Brass section: three quick G4+C5 pickups, E5/C5 'ta', then a held C-major chord (C4-G5, 6 voices) with vibrato. Each voice = 3 detuned band-limited saws through a low-pass whose envelope gives a brassy 'blat' attack; timpani G2 then C2 under the final chord; hall reverb. Original figure.
- **siren**: 1940s mechanical wailing siren (period-appropriate rather than modern hi-lo): square+saw rotor tone sweeping ~280->950 Hz and back, 2 cycles in 3.4 s with spin-up, rotor-port amplitude chop, air noise, light reverb.
- **dialogue_pop_1**: 105 ms soft sine 'bloop' rising 420->~900 Hz in ~12 ms with 3 ms attack and 28 ms decay, a touch of 2nd harmonic.
- **dialogue_pop_2**: As dialogue_pop_1 at x1.06 pitch.
- **dialogue_pop_3**: As dialogue_pop_1 at x0.944 pitch.
- **footsteps_sneak**: Hybrid: CC0 footsteps + original pizzicato 'sneak' line (generic, not quoting any tune).
- **surprise_sting**: Orchestral hit: dissonant C-minor+tritone stab (C2..C5) played by brass voices + detuned string saws, a pitch-dropping bass drum, timpani C2, filtered noise crash with metallic partials, 2 s hall reverb.
- **rain_loop**: Stereo 45 s. Decorrelated band-passed pink+white rain wash per channel, sparse random drop impulses (1.5-6 kHz) and denser darker roof patter, slow random gust swells with band-passed wind, one soft distant thunder roll at ~19 s; seamlessly wrapped by equal-power crossfading a 3 s tail over the head. Mastered to about -20 LUFS (ambience bed, sits under dialogue).
- **clue_ding**: Glockenspiel 'ding-DING!' E6 then B6 (120 ms apart) using inharmonic bar partials (1, 2.76, 5.40, 8.93) with individual decays, a 4-note high sparkle shimmer, light reverb.
