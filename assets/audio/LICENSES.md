# WHODUNIT?! SFX kit — licenses & provenance

Every file exists as `.ogg` (Vorbis q5, primary) and `.mp3` (LAME V2 VBR, fallback). Both files of a cue share the same source and license.

**Summary:** 13 cues are fully synthesized in original code (no samples); 3 cues (impact, door_slam, footsteps_sneak) are hybrids built from Kenney CC0 recordings plus synthesis. No CC-BY, CC-BY-NC, 'personal use', Sonniss, or ripped/imitated copyrighted audio is used. Attribution is not legally required for any file.

| Cue | Files | Source | Author | License | Modifications |
|---|---|---|---|---|---|
| boing | `boing.ogg`, `boing.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 (dedicated by project) | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| slide_whistle_up | `slide_whistle_up.ogg`, `slide_whistle_up.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| slide_whistle_down | `slide_whistle_down.ogg`, `slide_whistle_down.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| impact | `impact.ogg`, `impact.mp3` | https://kenney.nl/assets/impact-sounds (impactPunch_heavy_000.ogg, impactWood_heavy_000.ogg) + synthesis | Kenney (kenney.nl) + Toon | CC0 1.0 | Layered: Kenney punch (0.9) + Kenney wood hit (0.35) + synthesized pitch-dropping sine 'bonk' (165->55 Hz); resampled/downmixed to mono, short room reverb, trimmed, loudness-normalized, limited. |
| wah_wah | `wah_wah.ogg`, `wah_wah.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| thunder_1 | `thunder_1.ogg`, `thunder_1.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| thunder_2 | `thunder_2.ogg`, `thunder_2.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| door_slam | `door_slam.ogg`, `door_slam.mp3` | https://kenney.nl/assets/rpg-audio (doorClose_4.ogg) + https://kenney.nl/assets/impact-sounds (impactWood_heavy_000.ogg) + synthesis | Kenney (kenney.nl) + Toon | CC0 1.0 | Layered: Kenney door close + Kenney heavy wood hit aligned to the door's transient + synthesized low body thump (130->70 Hz); 48k->44.1k resample, mono downmix, 0.9 s hallway reverb, trimmed, normalized, limited. |
| fanfare | `fanfare.ogg`, `fanfare.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| siren | `siren.ogg`, `siren.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| dialogue_pop_1 | `dialogue_pop_1.ogg`, `dialogue_pop_1.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| dialogue_pop_2 | `dialogue_pop_2.ogg`, `dialogue_pop_2.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| dialogue_pop_3 | `dialogue_pop_3.ogg`, `dialogue_pop_3.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| footsteps_sneak | `footsteps_sneak.ogg`, `footsteps_sneak.mp3` | https://kenney.nl/assets/impact-sounds (footstep_carpet_000..004.ogg) + synthesis | Kenney (kenney.nl) + Toon | CC0 1.0 | Six Kenney carpet footsteps re-sequenced at 0.36 s tiptoe spacing, each paired with a synthesized Karplus-Strong pizzicato bass pluck (G2 D3 A2 E3 G2 D3); mono, light reverb, normalized, limited. |
| surprise_sting | `surprise_sting.ogg`, `surprise_sting.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| rain_loop | `rain_loop.ogg`, `rain_loop.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |
| clue_ding | `clue_ding.ogg`, `clue_ding.mp3` | synthesized in code by Toon (`audio_tools/make_sfx.py`) | Toon (original) | CC0 1.0 | Original synthesis; mastered (trim, loudness-normalize, limit), encoded |

## Third-party sources

- **Kenney — Impact Sounds (1.0)**, https://kenney.nl/assets/impact-sounds — License: Creative Commons Zero (CC0 1.0), http://creativecommons.org/publicdomain/zero/1.0/ (per the pack's `License.txt`). Download: `kenney_impact-sounds.zip` sha256 029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8.
- **Kenney — RPG Audio**, https://kenney.nl/assets/rpg-audio — License: CC0 1.0 (per the pack's `License.txt`). Download: `kenney_rpg-audio.zip` sha256 6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b.
- Credit is optional under CC0; suggested courtesy credit: "Some sound effects based on CC0 audio by Kenney (www.kenney.nl)."

## Synthesized cues

Synthesized cues were generated from scratch with numpy/scipy by Toon (the project's sound designer) using `toon-drafts/audio_tools/make_sfx.py` + `dsp.py`; the project may treat them as CC0 / wholly owned. Musical figures (fanfare, wah-wah descending semitones, pizzicato sneak, siren wail) are generic idioms, not transcriptions or imitations of any specific recording.
