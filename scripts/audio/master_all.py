"""Loudness-normalise every cue to its class target, encode mono ogg + mp3, verify true peak, write a report.

    python3 master_all.py [--out ../../assets/audio] [--legacy <dir with the 16 pre-pass float WAV masters>] [--new <dir from make_noir.py>]

Loudness classes (integrated LUFS of the FILE, i.e. at manager gain 1.0; the in-game `volume` multiplies this):
  sting  -16  hero cues: themes, fanfare, accusation, stings, thunder, siren, wah-wah
  accent -18  emotion stings, doors, impacts, short musical accents
  foley  -20  UI/dialogue pops, typewriter, paper, rustle, footsteps, creak, heartbeat loops
  tap    -22  ui_tap (quietest, plays on every button)
  bed    -24  ambient loops (sit ~10 dB under the stings at gain 1; duck further with the manager)
True peak is held under -1.0 dBTP after lossy encoding (iterates the gain down if ogg or mp3 overshoots).
"""
import argparse, json, os, subprocess, sys
import numpy as np
import soundfile as sf
from dsp import SR, master, loudness
from measure import measure

CLASSES = {
    "sting": -16.0, "accent": -18.0, "foley": -20.0, "tap": -22.0, "bed": -24.0,
}
CUE_CLASS = {
    # legacy cues (keys/filenames unchanged)
    "boing": "accent", "slide_whistle_up": "accent", "slide_whistle_down": "accent", "impact": "accent", "door_slam": "accent",
    "wah_wah": "sting", "thunder_1": "sting", "thunder_2": "sting", "fanfare": "sting", "siren": "sting",
    "surprise_sting": "sting", "clue_ding": "accent",
    "dialogue_pop_1": "foley", "dialogue_pop_2": "foley", "dialogue_pop_3": "foley", "footsteps_sneak": "foley",
    "rain_loop": "bed",
    # new noir cues
    "case_open": "sting", "theme_noir_minor": "sting", "theme_resolved": "sting", "accusation_roll": "sting",
    "confront_sting": "sting", "contradiction_stab": "sting", "breakdown_crack": "sting", "clue_stinger": "sting",
    "gavel_bang": "accent", "emo_angry": "accent", "emo_nervous": "accent", "emo_shocked": "accent", "emo_smug": "accent", "emo_sad": "accent",
    "door_creak": "foley", "ui_paper": "foley", "typewriter_tap": "foley", "typewriter_return": "foley", "search_rustle": "foley",
    "heartbeat_slow": "foley", "heartbeat_mid": "foley", "heartbeat_fast": "foley",
    "ui_tap": "tap",
    "bed_library": "bed", "bed_manor": "bed",
}
MAX_GR = {"thunder_1": 9.0, "thunder_2": 9.0, "gavel_bang": 10.0, "accusation_roll": 9.0, "emo_angry": 8.0, "typewriter_tap": 8.0, "ui_tap": 8.0, "case_open": 5.0}
LOOPS = {"rain_loop", "bed_library", "bed_manor", "heartbeat_slow", "heartbeat_mid", "heartbeat_fast"}
BEDS = {"rain_loop", "bed_library", "bed_manor"}


def encode(x, name, out, tmp):
    wav = os.path.join(tmp, name + ".wav")
    sf.write(wav, x.astype(np.float32), SR, subtype="FLOAT")
    kb = "48k" if name in BEDS else "64k"                         # ogg: mono ~48 kbps beds / ~64 kbps cues
    mk = "48k" if name in BEDS else ("32k" if name.startswith("heartbeat") else "56k")  # mp3 fallback
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "44100", "-c:a", "libvorbis", "-b:a", kb, os.path.join(out, name + ".ogg")], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", mk, os.path.join(out, name + ".mp3")], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="../../assets/audio")
    ap.add_argument("--legacy", default="masters")
    ap.add_argument("--new", default="masters")
    ap.add_argument("--only")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    tmp = os.path.join(a.new, "_enc"); os.makedirs(tmp, exist_ok=True)
    rep = {}
    for name, cls in CUE_CLASS.items():
        if a.only and name not in a.only.split(","):
            continue
        src = os.path.join(a.new, name + ".wav")
        if not os.path.exists(src):
            src = os.path.join(a.legacy, name + ".wav")
        x, fs = sf.read(src, always_2d=True)
        assert fs == SR
        x = x.mean(1)  # everything ships mono
        target = CLASSES[cls]
        peak_db = -2.0
        for it in range(6):
            y, gr = master(x, target_lufs=target, peak_db=peak_db, max_gr_db=MAX_GR.get(name, 6.0), do_trim=name not in LOOPS)
            if name in LOOPS:
                pass
            encode(y, name, a.out, tmp)
            mo, mm = measure(os.path.join(a.out, name + ".ogg")), measure(os.path.join(a.out, name + ".mp3"))
            worst = max(mo["TP"], mm["TP"])
            if worst <= -1.0:
                break
            peak_db -= (worst + 1.0) + 0.15
        rep[name] = dict(cls=cls, target=target, limiter_gr_db=round(float(gr), 2), ogg=mo, mp3=mm)
        print(f"{name:20s} {cls:6s} tgt {target:6.1f}  ogg I {mo['I']:6.1f} TP {mo['TP']:5.1f} {mo['bytes']/1024:6.1f}KB {mo['dur']:6.2f}s  mp3 I {mm['I']:6.1f} TP {mm['TP']:5.1f} {mm['bytes']/1024:6.1f}KB  GR {gr:.1f}")
    json.dump(rep, open(os.path.join(a.new, "after_report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
