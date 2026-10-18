# S.S. Tallyho: sound (v0.1)

Owner: Toon. Files: `assets/cases/_tallyho/audio/` (decision Q14: case audio lives in the case's own folder, like the art). Blackwood's sounds in `assets/audio/` are the default set and are unchanged. Licenses: `assets/cases/_tallyho/audio/LICENSES.md` (all original synthesis, CC0). Build: `scripts/audio/make_tallyho.py`.

Mood: a 1936 steam yacht wallowing in a summer thunderstorm at night. The shared noir layer (muted-trumpet themes, stings, heartbeat, typewriter, paper and UI foley) stays; only the cues that say "country house" get a ship version, and the beds move from the manor to the sea.

## 1. Files

All mono, `.ogg` (Vorbis, primary) + `.mp3` (LAME CBR, fallback), shared loudness classes from `scripts/audio/master_all.py`. Measured on the encoded files (ffmpeg ebur128, true peak 4x oversampled).

| Stem | Class (target LUFS) | Duration | Size ogg / mp3 | Integrated LUFS ogg / mp3 | True peak dBTP ogg / mp3 |
|---|---|---|---|---|---|
| `case_open` | sting (-16) | 8.34 s | 40.3 KB / 57.5 KB | -15.9 / -16.3 | -2.1 / -2.5 |
| `door_creak` | foley (-20) | 2.42 s | 13.8 KB / 17.0 KB | -20.3 / -20.4 | -3.6 / -3.7 |
| `door_slam` | accent (-18) | 1.70 s | 11.7 KB / 12.2 KB | -18.7 / -19.1 | -1.8 / -2.4 |
| `bed_ship_deck` | bed (-24) | 32.00 s loop | 155.7 KB / 187.9 KB | -24.0 / -24.4 | -9.0 / -9.7 |
| `bed_ship_interior` | bed (-24) | 32.00 s loop | 97.6 KB / 187.9 KB | -24.1 / -24.4 | -6.9 / -7.5 |
| `bed_engine_room` | bed (-24) | 24.00 s loop | 132.4 KB / 141.0 KB | -24.0 / -24.4 | -7.4 / -8.0 |

Total: about 451 KB ogg (about 604 KB mp3). Loop seams checked with `scripts/audio/loopcheck.py` on all six decoded bed files (ogg and mp3): no click (seam jump below the signal's own 99.9th-percentile step in every file).

### Cue overrides (same key and file stem as the shared cue)

- **`case_open`** (title START): a wave wash, two strikes of a ship's bell, a distant steam-whistle foghorn, then the shared low tritone sting under a muted-piano Cm(add9). Replaces the door creak and clock ticks. Not triumphant.
- **`door_creak`** (scene / character entrance): a bulkhead door's steel dog lever clanks twice and the heavy hinge groans open. Replaces the wooden door.
- **`door_slam`**: a steel hatch bangs shut (low thump, ringing plate, latch).

Everything else (themes, stings, emotions, heartbeat, typewriter, paper, rustle, gavel, fanfare, wah-wah, thunder) keeps the shared files.

### Beds (new stems, exactly periodic by construction)

- **`bed_ship_deck`**: storm at sea. Gusting wind with a rigging whistle, swells that break and hiss about every 8 s, rain on the deck, timber and rope creaks, one distant thunder roll.
- **`bed_ship_interior`**: below decks. A muffled engine throb (2.5 beats/s), the hull's slow roll every 8 s with wooden creaks and two low groans, distant waves through the plating, faint rain above.
- **`bed_engine_room`**: close to the machinery. Two-cylinder steam chuff, boiler roar, steam hiss, valve-gear clicks on the beat, a faint gauge whine.

## 2. Mapping

**Screens** (works with today's `audio.beds` schema once the loader can find case files, see 3):

| Screen | Bed |
|---|---|
| title | `bed_ship_deck` |
| intro, suspects, investigate, interrogation, confront, accuse, ending (scene part) | `bed_ship_interior` |

**Rooms** (needs the small room hook in 3.3):

| Location id | Bed |
|---|---|
| `cabin-deck`, `ballroom`, `bridge`, `galley` | `bed_ship_interior` |
| `engine-room` | `bed_engine_room` |
| `boat-deck` | `bed_ship_deck` |

`case.json` block for Agatha, to add **after** the loader lands (today's validator only looks in `assets/audio/` and would reject these stems):

```json
"audio": {
  "beds": {
    "title": "bed_ship_deck", "intro": "bed_ship_interior", "suspects": "bed_ship_interior", "investigate": "bed_ship_interior",
    "interrogation": "bed_ship_interior", "confront": "bed_ship_interior", "accuse": "bed_ship_interior", "ending": "bed_ship_interior"
  },
  "rooms": { "cabin-deck": "bed_ship_interior", "ballroom": "bed_ship_interior", "bridge": "bed_ship_interior", "galley": "bed_ship_interior", "engine-room": "bed_engine_room", "boat-deck": "bed_ship_deck" }
}
```

The three cue overrides need **no** data entry: their stems equal the shared cue files, so a folder-first lookup finds them.

## 3. Loader ask for Dexter (ready to paste)

State on `main` today: the #31 wiring has landed (`CUES` holds the noir keys, `AudioManager.setBed` with a ~1.1 s crossfade, a WebAudio engine with an HTMLAudio fallback, ducking, mute, reduced-motion x0.6 on loud cues, `CORE_FILES` / `REST_GROUPS` preloading). Per-case audio exists only as data: `case.json` `audio.beds` (per screen) and `audio.cues` (file-stem overrides), registered by `registerCaseAudio(view.audio)` in `Game.tsx`. Every URL is still built as `/assets/audio/<stem>.<ext>` (`HtmlEngine.element`, `WebAudioEngine.load`), and `checkPresentationAssets` only looks there, so nothing in `assets/cases/<id>/audio/` can be played or validated yet.

> **Dexter: per-case audio folder (Q14), please.** No change to cue keys or call sites.
>
> 1. **Build-time file list.** Like `caseSpriteFiles`, list the stems in `assets/cases/<caseId>/audio/` that have **both** `.ogg` and `.mp3`, and send them in the public view (e.g. `view.audioFiles: string[]`). Missing folder = `[]`.
> 2. **One URL resolver.** `registerCaseAudio(view.audio, { caseId, files: view.audioFiles })` records the set; a single `audioUrl(stem, ext)` returns `/assets/cases/<caseId>/audio/<stem>.<ext>` when the stem is in the set, else `/assets/audio/<stem>.<ext>`. Use it in `HtmlEngine.element` and `WebAudioEngine.load` (the two places that build URLs today). Lookup order per stem: case folder (ogg, then mp3 on the existing ogg fallback), then `assets/audio/`.
>    - Overrides are then automatic: Tallyho's `case_open`, `door_creak`, `door_slam` replace the shared files because the stems match. `CORE_FILES` / `REST_GROUPS` stay as they are (they name stems).
>    - **Cache key:** `elements` and `buffers` are keyed by stem today. Key them by URL (or clear them in `registerCaseAudio` when the case changes), or a player who goes from Blackwood to Tallyho keeps hearing Blackwood's `case_open`.
> 3. **Beds per room (small).** Add optional `audio.rooms: Record<locationId, stem>` to `CaseAudioSchema`. `bedForScreen(screen, endingPart, caseAudio, locationId?)`: when a room is current (investigate with a room open; interrogation/confront if the stage has a room), return `rooms[locationId]`, else `beds[screen]`, else today's default. `setBed`'s crossfade is unchanged. Room beds register as looping `CueDef`s exactly like `beds` (same `BED_VOLUME`, ducking, iOS gain path).
> 4. **Validator.** `checkPresentationAssets`: a stem named in `audio.beds`, `audio.rooms` or `audio.cues` passes if `.mp3` and `.ogg` exist in the case folder **or** in `assets/audio/`; `audio.rooms` keys must be location ids. Optional warning: a file in the case folder whose stem is neither a shared cue file nor named in `audio` (dead file).
> 5. **Tests.** Resolver order (case first, then global, then mp3 fallback), cache separation across two cases, `bedForScreen` with `rooms`, validator with case-folder stems.
>
> `scripts/sync-assets.ts` already copies `assets/` recursively (only `.md` is skipped), so `assets/cases/_tallyho/audio/*.ogg|mp3` is served at `/assets/cases/_tallyho/audio/…` with no change.

## 4. Verified and not verified

- Verified by measurement: loudness per class (within 0.7 LU on the ogg), true peak at or below -1.8 dBTP on both encodings, loop seams (no click), mono, sizes.
- **Not listened to.** All judgement of tone (whether the bell reads as a ship's bell, the foghorn as a foghorn, the throb as an engine) is unverified. Please play `/workspace/toon-drafts/tallyho_audio_preview.zip` before approving.
- Not played in the game (no loader yet), so ducking under speech and mobile Safari/Chrome unlock are untested for these files; they use the existing manager paths once wired.
