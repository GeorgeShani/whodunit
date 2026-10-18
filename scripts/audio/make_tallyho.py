"""S.S. Tallyho (case two) sounds: synthesized from scratch in numpy/scipy (original code, CC0). No samples, no paid services.

    WHODUNIT_MASTERS=<dir> python3 make_tallyho.py      # float WAV masters + loudness/true-peak mastering + ogg/mp3
                                                        # -> assets/cases/_tallyho/audio/, report -> <dir>/tallyho_report.json

Beds are exactly periodic by construction (integer-cycle LFOs, FFT noise, wrapped events), so they loop with no seam.
Cue overrides keep the shared cue key as the file stem (case_open, door_creak, door_slam).
Loudness classes are the shared ones from master_all.py (sting -16, accent -18, foley -20, bed -24 LUFS, TP <= -1 dBTP).
"""
import json, os, sys
import numpy as np
import soundfile as sf
from dsp import *
from make_noir import creak, tick, strings, piano, kick, pnoise, band, periodic_lfo, circ_add, pbutter
from make_sfx import thunder
import master_all as M
from measure import measure

HERE = os.path.dirname(os.path.abspath(__file__))
MASTERS = os.environ.get("WHODUNIT_MASTERS", os.path.join(HERE, "masters_tallyho"))
OUT = os.environ.get("TALLYHO_AUDIO_OUT", os.path.join(HERE, "..", "..", "assets", "cases", "_tallyho", "audio"))

# ------------------------------------------------------------------ instruments

def ship_bell(hz=740.0, dur=3.2, amp=1.0):
    """Bronze ship's bell strike: inharmonic church-bell-like partials (hum, prime, tierce, quint, nominal...), clapper tick."""
    t = t_axis(dur)
    parts = [(0.5, 0.45, 2.6), (1.0, 1.0, 1.9), (1.19, 0.55, 1.4), (1.5, 0.35, 1.1), (2.0, 0.5, 0.9), (2.51, 0.2, 0.6), (3.01, 0.12, 0.4), (4.07, 0.06, 0.25)]
    x = sum(a * np.sin(2 * np.pi * hz * r * (1 + 0.0007 * np.sin(2 * np.pi * 4.3 * t)) * t) * np.exp(-t / d) for r, a, d in parts)
    clk = butter(white(len(t)), [2500, 7000], "band", 2) * np.exp(-t / 0.003) * 0.6
    return (x + clk) * np.minimum(1, t / 0.0015) * amp


def foghorn(hz=82.0, dur=2.8, amp=1.0):
    """Distant ship's steam whistle / diaphone: reedy low saw pair a major sixth apart, slow swell, falling 'grunt' at the end."""
    t = t_axis(dur)
    sag = 1 - 0.07 * np.clip((t - (dur - 0.55)) / 0.55, 0, 1) ** 2
    f = hz * sag * (1 + 0.004 * np.sin(2 * np.pi * 5.0 * t))
    x = bl_saw(f, max_h=30, rolloff=1.2) + 0.55 * bl_saw(f * 1.68, max_h=20, rolloff=1.3)
    x = butter(x, 900, "low", 3) + 0.15 * butter(white(len(t)), [300, 1200], "band", 2) * 0.3
    env = adsr(len(t), 0.35, 0.3, 0.85, 0.7)
    return x * env * amp


def metal_hit(f0=180.0, dur=1.2, amp=1.0, bright=1.0, seed=0):
    """Steel plate / hatch clang: inharmonic plate modes with fast-decaying highs, plus a noise transient."""
    r = np.random.default_rng(seed)
    t = t_axis(dur)
    ratios = [1.0, 2.29, 3.83, 5.61, 7.7, 10.1]
    x = sum((0.8 ** k) * np.sin(2 * np.pi * f0 * q * (1 + r.uniform(-0.01, 0.01)) * t + r.uniform(0, 6.28)) * np.exp(-t / (0.5 / (1 + k * bright)))
            for k, q in enumerate(ratios))
    tr = butter(white(len(t)), [800, 6000], "band", 2) * np.exp(-t / 0.006) * 0.8
    return (x + tr) * np.minimum(1, t / 0.001) * amp


def wrap_reverb(x, N, **kw):
    """Reverb a loop-length buffer and wrap its tail back to the start (keeps it periodic)."""
    y = reverb(np.concatenate([x, np.zeros(int(2.5 * SR))]), **kw)
    out = y[:N].copy()
    tail = y[N:]
    out[:len(tail)] += tail
    return out

# ------------------------------------------------------------------ cue overrides (same keys as the shared cues)

def case_open():
    """OPENING THE CASE (title Start), ship version: a wave wash, two strikes of the ship's bell, a distant foghorn, then the
    shared low tritone sting under a muted-piano Cm(add9) that decays into the night. Moody, not triumphant."""
    out = np.zeros(int(7.2 * SR))
    tw = t_axis(7.2)
    wash = butter(pnoise(7.2, band(120, 2500, slope=1.0), 41), 1800, "low", 2) * (0.25 + 0.2 * np.sin(np.pi * tw / 7.2)) * 0.5
    out += wash
    out = place(out, ship_bell(740, 3.0), 0.15, 0.55)
    out = place(out, ship_bell(740, 3.4), 0.62, 0.5)
    out = place(out, reverb(foghorn(82, 2.6), dur=2.2, wet=0.4, lp=1500), 1.5, 0.7)
    sting = strings(65.41, 3.0, 0.9, bright=1600) + 0.8 * strings(98.0 * 0.9439, 3.0, 0.5, bright=1400)
    out = place(out, sting * np.minimum(1, t_axis(3.0) / 0.6), 3.9, 0.75)
    for i, hz in enumerate([130.81, 196.0, 233.08, 311.13, 349.23]):
        out = place(out, piano(hz, 3.0, 0.5), 3.9 + 0.012 * i, 0.8)
    out = place(out, kick(46, 0.7, 36), 3.9, 0.5)
    return reverb(out, dur=1.8, wet=0.22, lp=3500)


def door_creak():
    """SCENE / CHARACTER ENTRANCE, ship version: a bulkhead door's steel dog lever clanks, then the heavy hinge groans open."""
    out = np.zeros(1)
    out = place(out, metal_hit(420, 0.35, 0.5, bright=2.0, seed=3), 0.0, 0.8)
    out = place(out, metal_hit(530, 0.3, 0.4, bright=2.5, seed=4), 0.16, 0.6)
    out = place(out, butter(creak(1.6, 85, seed=12, amp=1.0), 1800, "low", 2), 0.32, 1.0)
    return reverb(out, dur=0.9, wet=0.22, lp=4000)


def door_slam():
    """DOOR SLAM, ship version: a steel hatch bangs shut (low thump + ringing plate) and the latch drops."""
    out = np.zeros(1)
    out = place(out, kick(58, 0.6, 70), 0.0, 1.0)
    out = place(out, metal_hit(150, 1.3, 0.8, bright=0.8, seed=7), 0.0, 0.7)
    out = place(out, metal_hit(640, 0.25, 0.4, bright=3.0, seed=9), 0.22, 0.5)
    return reverb(out, dur=1.0, wet=0.2, lp=4500)

# ------------------------------------------------------------------ beds (exactly periodic)

def _swell(L, N, cycles, phase=0.0):
    t = np.arange(N) / N
    return 0.5 + 0.5 * np.sin(2 * np.pi * cycles * t + phase)


def bed_ship_deck():
    """DECK BED (title, boat deck): storm at sea. Gusting wind with a rigging whistle, big swells that break and hiss every
    ~8 s, rain on the deck, a few timber/rope creaks and one distant thunder roll. 32 s mono, exactly periodic."""
    L = 32.0; N = int(L * SR)
    gust = 0.6 + 0.4 * (0.5 + 0.5 * periodic_lfo(L, [1, 2, 3, 5], [0.4, 2.1, 3.7, 1.0], [0.5, 0.3, 0.2, 0.12], N))
    wind = pnoise(L, band(160, 2600, slope=1.0), 61) * gust * 0.7
    for fc, c, ph in [(880, 3, 0.7), (1320, 2, 2.4)]:
        wh = pnoise(L, lambda fr, fc=fc: np.exp(-0.5 * ((fr - fc) / 25) ** 2), int(fc) + 3) * 0.18
        wind += wh * (0.3 + 0.7 * _swell(L, N, c, ph) ** 3) * gust
    sw = _swell(L, N, 4, -1.2)                                   # 8 s swell period
    roll = pbutter(pnoise(L, band(40, 500, slope=1.4), 62), 450, "low", 2) * (0.35 + 0.65 * sw ** 2) * 0.9
    crash = pnoise(L, band(500, 7000, slope=0.6), 63) * np.clip(_swell(L, N, 4, -2.6) - 0.6, 0, 1) ** 1.5 * 1.6
    rain = pnoise(L, band(1500, 9000, slope=0.4), 64) * 0.12
    x = wind + roll + crash + rain
    cr = np.zeros(N)
    for at, f0, sd, g in [(3.0, 140, 21, 0.4), (11.5, 110, 22, 0.45), (19.0, 160, 23, 0.35), (27.0, 120, 24, 0.4)]:
        circ_add(cr, creak(1.4, f0, seed=sd, amp=g), at)
    x += pbutter(cr, 2500, "low", 2) * 0.55
    th = thunder(False, seed=17, dur=7.0); th = th.mean(1) if th.ndim == 2 else th
    circ_add(x, th / np.abs(th).max() * 0.7, 15.0)
    return x


def bed_ship_interior():
    """INTERIOR BED (cabin deck, saloon, bridge, galley, and the default for the case's screens): below decks in a storm.
    A muffled engine throb (~2.5 beats/s), the slow roll of the hull every ~8 s with wooden creaks and groans, distant
    waves through the plating and faint rain on the deck above. 32 s mono, exactly periodic."""
    L = 32.0; N = int(L * SR); t = np.arange(N) / SR
    P = lambda f: round(f * L) / L
    beat = P(2.5)
    pulse = (0.5 + 0.5 * np.cos(2 * np.pi * beat * t)) ** 6
    throb = (np.sin(2 * np.pi * P(41.0) * t) + 0.4 * np.sin(2 * np.pi * P(82.0) * t)) * (0.35 + 0.65 * pulse)
    throb = pbutter(throb, 160, "low", 2) * 0.45
    hum = np.sin(2 * np.pi * P(55.0) * t) * 0.05
    sw = _swell(L, N, 4, 0.3)
    waves = pbutter(pnoise(L, band(50, 700, slope=1.5), 71), 380, "low", 2) * (0.3 + 0.7 * sw ** 2) * 0.55
    rain = pnoise(L, band(600, 3000, slope=0.6), 72) * 0.05
    x = throb + hum + waves + rain
    cr = np.zeros(N)
    for at, f0, sd, g in [(2.5, 95, 31, 0.5), (8.7, 130, 32, 0.4), (14.6, 80, 33, 0.55), (20.9, 115, 34, 0.45), (26.8, 100, 35, 0.5)]:
        circ_add(cr, creak(2.0, f0, seed=sd, amp=g), at)
    x += wrap_reverb(pbutter(cr, 1600, "low", 2), N, dur=1.4, wet=0.35, lp=2000) * 0.6
    gr = np.zeros(N)                                             # low hull groans at two swell crests
    for at in (6.3, 22.3):
        d = 2.4; tt = t_axis(d)
        g = np.sin(phase_from_freq(48 + 10 * np.sin(np.pi * tt / d))) * np.sin(np.pi * tt / d) ** 2
        circ_add(gr, g, at)
    x += pbutter(gr, 220, "low", 2) * 0.25
    return x


def bed_engine_room():
    """ENGINE-ROOM BED: close to the machinery. Two-cylinder steam chuff at ~2.5 beats/s, a deep boiler roar, a steady
    hiss, valve-gear clicks on the beat and a faint pressure-gauge whine. 24 s mono, exactly periodic."""
    L = 24.0; N = int(L * SR); t = np.arange(N) / SR
    P = lambda f: round(f * L) / L
    beat = P(2.5)
    roar = pbutter(pnoise(L, band(25, 300, slope=1.8), 81), 260, "low", 2) * 0.7
    throb = pbutter(np.sin(2 * np.pi * P(41.0) * t) + 0.5 * np.sin(2 * np.pi * P(61.5) * t), 200, "low", 2) * (0.5 + 0.5 * (0.5 + 0.5 * np.cos(2 * np.pi * beat * t)) ** 4) * 0.45
    hiss = pnoise(L, band(3000, 10000, slope=0.3), 82) * 0.06
    x = roar + throb + hiss
    ch = pnoise(L, band(300, 4000, slope=0.8), 83)
    env = np.zeros(N)
    period = 1 / beat
    k = 0
    while k * period / 2 < L - 1e-9:
        d = 0.18; tt = t_axis(d)
        circ_add(env, np.exp(-tt / 0.05) * np.minimum(1, tt / 0.01) * (1.0 if k % 2 == 0 else 0.75), k * period / 2)
        k += 1
    x += ch * env * 0.55
    clk = np.zeros(N)
    for i in range(int(round(L * beat))):
        circ_add(clk, metal_hit(1150, 0.12, 0.25, bright=4.0, seed=i % 5), i / beat + 0.21)
    x += clk * 0.5
    x += np.sin(2 * np.pi * P(2380.0) * t) * 0.004 * (0.5 + 0.5 * np.sin(2 * np.pi * 3 * t / L))
    return x


CUES = {  # stem: (fn, class)
    "case_open": (case_open, "sting"), "door_creak": (door_creak, "foley"), "door_slam": (door_slam, "accent"),
    "bed_ship_deck": (bed_ship_deck, "bed"), "bed_ship_interior": (bed_ship_interior, "bed"), "bed_engine_room": (bed_engine_room, "bed"),
}
LOOPS = {"bed_ship_deck", "bed_ship_interior", "bed_engine_room"}


def main():
    os.makedirs(MASTERS, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(MASTERS, "_enc"); os.makedirs(tmp, exist_ok=True)
    M.BEDS |= LOOPS                                              # beds encode at the bed bitrates
    only = sys.argv[1].split(",") if len(sys.argv) > 1 else None
    rep = {}
    for name, (fn, cls) in CUES.items():
        if only and name not in only:
            continue
        x = np.asarray(fn(), float)
        x = x.mean(1) if x.ndim == 2 else x
        sf.write(os.path.join(MASTERS, name + ".wav"), x.astype(np.float32), SR, subtype="FLOAT")
        target = M.CLASSES[cls]; peak_db = -2.0
        for _ in range(6):
            y, gr = master(x, target_lufs=target, peak_db=peak_db, max_gr_db=M.MAX_GR.get(name, 6.0), do_trim=name not in LOOPS)
            M.encode(y, name, OUT, tmp)
            mo, mm = measure(os.path.join(OUT, name + ".ogg")), measure(os.path.join(OUT, name + ".mp3"))
            worst = max(mo["TP"], mm["TP"])
            if worst <= -1.0:
                break
            peak_db -= (worst + 1.0) + 0.15
        rep[name] = dict(cls=cls, target=target, limiter_gr_db=round(float(gr), 2), ogg=mo, mp3=mm)
        print(f"{name:20s} {cls:6s} tgt {target:6.1f}  ogg I {mo['I']:6.1f} TP {mo['TP']:5.1f} {mo['bytes']/1024:6.1f}KB {mo['dur']:6.2f}s  mp3 I {mm['I']:6.1f} TP {mm['TP']:5.1f} {mm['bytes']/1024:6.1f}KB  GR {gr:.1f}")
    json.dump(rep, open(os.path.join(MASTERS, "tallyho_report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
