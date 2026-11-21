# S.S. Tallyho audio: licenses and provenance

All six sounds are **synthesized from scratch in original code** by Toon (`scripts/audio/make_tallyho.py`, numpy/scipy, reusing the shared helpers in `scripts/audio/dsp.py`, `make_noir.py` and `make_sfx.py`). No samples, no recordings, no third-party packs, no paid or AI generation services. Each file exists as `.ogg` (Vorbis, mono) and `.mp3` (LAME CBR, mono), both made from the same master.

| Stem | Files | Source | Author | License | Modifications |
|---|---|---|---|---|---|
| case_open | `case_open.ogg`, `case_open.mp3` | synthesized (`make_tallyho.py` `case_open`) | Toon (original) | CC0 1.0 (dedicated by project) | Original synthesis; sting-class master (-16 LUFS, TP <= -1 dBTP), trimmed, encoded mono |
| door_creak | `door_creak.ogg`, `door_creak.mp3` | synthesized (`door_creak`) | Toon (original) | CC0 1.0 | Original synthesis; foley-class master (-20 LUFS), trimmed, encoded mono |
| door_slam | `door_slam.ogg`, `door_slam.mp3` | synthesized (`door_slam`) | Toon (original) | CC0 1.0 | Original synthesis; accent-class master (-18 LUFS), trimmed, encoded mono |
| bed_ship_deck | `bed_ship_deck.ogg`, `bed_ship_deck.mp3` | synthesized (`bed_ship_deck`) | Toon (original) | CC0 1.0 | Original synthesis, exactly periodic 32 s loop; bed-class master (-24 LUFS), not trimmed, encoded mono |
| bed_ship_interior | `bed_ship_interior.ogg`, `bed_ship_interior.mp3` | synthesized (`bed_ship_interior`) | Toon (original) | CC0 1.0 | Original synthesis, exactly periodic 32 s loop; bed-class master, encoded mono |
| bed_engine_room | `bed_engine_room.ogg`, `bed_engine_room.mp3` | synthesized (`bed_engine_room`) | Toon (original) | CC0 1.0 | Original synthesis, exactly periodic 24 s loop; bed-class master, encoded mono |

Attribution is not legally required for any file.
