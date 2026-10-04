"""Generate the data-driven parts of docs/SOUND_NOTES.md tables, assets/audio/README.md and assets/audio/LICENSES.md rows.

    python3 make_docs.py --before before.json --after after.json --report after_report.json

(The prose of SOUND_NOTES.md is hand-written; this script prints/refreshes the tables only: see the markers in that file.)
"""
import argparse, json, math, re

USE = {
    "boing": "Bouncy spring gag; slapstick seasoning (hint miss, shocked beats at low gain).",
    "slide_whistle_up": "Rising whoop; light slapstick accent (character entrance).",
    "slide_whistle_down": "Falling slide whistle; deflating plan; seasoning only.",
    "impact": "Bonk / collision (legacy accusation + confrontation cue; now a slapstick accent).",
    "wah_wah": "Muted sad trombone: WRONG ACCUSATION ending only.",
    "thunder_1": "Close lightning crack + rumble (flash-synced thunder).",
    "thunder_2": "Distant rolling thunder (use this one under reduced motion).",
    "door_slam": "Door slam: a character storming out.",
    "fanfare": "Brass victory fanfare. SOLVED ENDING ONLY.",
    "siren": "Police siren (no longer in the wrong ending; optional chase gag).",
    "dialogue_pop_1": "Per-line dialogue blip (rotate 1-3).", "dialogue_pop_2": "Dialogue blip variant.", "dialogue_pop_3": "Dialogue blip variant.",
    "footsteps_sneak": "Tiptoe footsteps + pizzicato (the culprit sneaks off).",
    "surprise_sting": "Orchestral hit (legacy contradiction/breakdown stack).",
    "rain_loop": "Rain bed, rebuilt: 30 s mono seamless loop (title / generic).",
    "clue_ding": "Glockenspiel ding-DING (small positive blip; no longer the clue-found cue).",
}


def first_sentence(doc):
    doc = " ".join((doc or "").split())
    return doc


def load(a):
    B = {r["file"]: r for r in json.load(open(a.before))}
    A = {r["file"]: r for r in json.load(open(a.after))}
    rep = json.load(open(a.report))
    return B, A, rep


def f1(v):
    return "-" if v is None else f"{v:.1f}"


def tables(a):
    import importlib.util, os, sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    os.environ.setdefault("WHODUNIT_MASTERS", "masters")
    import make_noir  # noqa: F401  (only for docstrings)
    B, A, rep = load(a)
    legacy = {k[:-4] for k in B if k.endswith(".ogg")}
    use = dict(USE)
    for k, fn in make_noir.CUES.items():
        use[k] = first_sentence(fn.__doc__)
    EFF = {"sting": -22, "accent": -24, "foley": -28, "tap": -32, "bed": -32}
    rows_new, rows_old, rows_all = [], [], []
    for n in sorted(rep, key=lambda n: (n in legacy, n)):
        o, m = A[n + ".ogg"], A[n + ".mp3"]
        eff = -30 if n.startswith("heartbeat") else EFF[rep[n]["cls"]]
        vol = min(1.0, round(10 ** ((eff - o["I"]) / 20), 2))
        s = f"{o['S_max']:.1f}" if o["S_max"] is not None else "n/a (<3 s)"
        line = f"| `{n}` | {o['dur']:.2f} | {o['bytes']/1024:.1f} / {m['bytes']/1024:.1f} | {o['I']:.1f} | {s} | {o['TP']:.1f} / {m['TP']:.1f} | {rep[n]['cls']} | {vol:.2f} | {use[n]} |"
        (rows_old if n in legacy else rows_new).append(line)
        b = B.get(n + ".ogg")
        rows_all.append(
            f"| `{n}` | {rep[n]['cls']} ({rep[n]['target']:.0f}) | {f1(b['I']) if b else 'new'} | {o['I']:.1f} | {f1(b['TP']) if b else 'new'} | {o['TP']:.1f} | {m['TP']:.1f} | {f1(b['dur']) if b else 'new'} → {o['dur']:.2f} | {f'{b['bytes']/1024:.1f}' if b else 'new'} → {o['bytes']/1024:.1f} |"
        )
    hdr = "| Cue | Dur (s) | ogg / mp3 KB | LUFS (I) | LUFS S-max | TP ogg / mp3 (dBTP) | class | rec. `volume` | What / where |\n|---|---|---|---|---|---|---|---|---|\n"
    hdr2 = "| Cue | class (target LUFS) | I before | I after | TP before | TP after ogg | TP after mp3 | dur before → after (s) | ogg KB before → after |\n|---|---|---|---|---|---|---|---|---|\n"
    tot = lambda D, ext, keep=None: sum(r["bytes"] for k, r in D.items() if k.endswith(ext) and (keep is None or k[:-4] in keep))
    sizes = dict(
        ogg_b=tot(B, ".ogg"), ogg_a=tot(A, ".ogg"), mp3_b=tot(B, ".mp3"), mp3_a=tot(A, ".mp3"),
        ogg_new=tot(A, ".ogg") - tot(A, ".ogg", legacy), mp3_new=tot(A, ".mp3") - tot(A, ".mp3", legacy),
        ogg_legacy_a=tot(A, ".ogg", legacy), mp3_legacy_a=tot(A, ".mp3", legacy),
    )
    return hdr + "\n".join(rows_new), hdr + "\n".join(rows_old), hdr2 + "\n".join(rows_all), sizes, use, rep, A


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", default="/workspace/toon-drafts/sound_work/before.json")
    ap.add_argument("--after", default="/workspace/toon-drafts/sound_work/after.json")
    ap.add_argument("--report", default="/workspace/toon-drafts/sound_work/masters_new/after_report.json")
    ap.add_argument("--write", help="write JSON of tables to this path")
    a = ap.parse_args()
    new, old, allr, sizes, use, rep, A = tables(a)
    print(new, "\n\n", old, "\n\n", allr, "\n\n", sizes)
    if a.write:
        json.dump(dict(new=new, old=old, all=allr, sizes=sizes, use=use), open(a.write, "w"), indent=1)
