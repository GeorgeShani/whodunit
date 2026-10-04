"""WHODUNIT?! noir sound pass — new cues, all synthesized from scratch in numpy/scipy (original code, CC0).

Theme: 1940s detective noir (rainy night, smoky jazz, shadows) with light slapstick seasoning.
Victory/brass fanfare belongs ONLY to the solved ending (existing `fanfare`).

    WHODUNIT_MASTERS=<dir> python3 make_noir.py     # writes float WAV masters (mono, 44.1 kHz)
    python3 master_all.py                           # loudness-normalise + encode ogg/mp3 into assets/audio

Every function's docstring says what the cue is and where it should play.
"""
import os
import numpy as np
import scipy.signal as ss
import soundfile as sf
from dsp import *
from make_sfx import thunder, brass, timpani, bl_saw, expdecay

HERE = os.path.dirname(os.path.abspath(__file__))
MASTERS = os.environ.get("WHODUNIT_MASTERS", os.path.join(HERE, "masters"))
os.makedirs(MASTERS, exist_ok=True)
CUES = {}


def cue(name):
    def deco(fn):
        CUES[name] = fn
        return fn
    return deco


R = np.random.default_rng(1947)

# ------------------------------------------------------------------ instruments

def ks_pluck(hz, dur, decay=0.996, bright=0.5, seed=0):
    """Karplus-Strong plucked string (upright-bass / pizzicato)."""
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    N = max(int(SR / hz), 2)
    buf = r.uniform(-1, 1, N)
    buf = butter(buf, 400 + 4000 * bright, "low", 2) if N > 8 else buf
    out = np.empty(n)
    ptr = 0
    prev = 0.0
    for i in range(n):
        v = buf[ptr]
        out[i] = v
        buf[ptr] = decay * (0.5 * v + 0.5 * prev)
        prev = v
        ptr += 1
        if ptr == N:
            ptr = 0
    return out * np.minimum(1, np.arange(n) / (0.002 * SR))


def piano(hz, dur, vel=1.0, felt=3000):
    """Muted/felt upright piano: stretched partials with per-partial decay and a soft hammer thump."""
    t = t_axis(dur)
    tau = float(np.clip(1.8 * (261.6 / hz) ** 0.5, 0.5, 3.5))
    out = np.zeros(len(t))
    for k in range(1, 14):
        f = hz * k * np.sqrt(1 + 0.0004 * k * k)
        if f > 7000:
            break
        out += (1 / k ** 1.15) * np.sin(2 * np.pi * f * t + k) * np.exp(-t / (tau / (1 + 0.5 * (k - 1))))
        out += 0.3 * (1 / k ** 1.15) * np.sin(2 * np.pi * (f + 0.35) * t) * np.exp(-t / (tau / (1 + 0.5 * (k - 1))))
    thump = butter(white(len(t)), 1800, "low", 2) * np.exp(-t / 0.012) * 0.25
    out = butter(out + thump, felt, "low", 2) * vel * np.minimum(1, t / 0.002)
    return out * np.minimum(1, (dur - t) / 0.05)


def vibes(hz, dur, vel=1.0, trem=5.0):
    """Vibraphone: bar partials (1, ~4, ~10) with motor tremolo."""
    t = t_axis(dur)
    x = (np.sin(2 * np.pi * hz * t) * np.exp(-t / 1.6)
         + 0.35 * np.sin(2 * np.pi * hz * 3.93 * t) * np.exp(-t / 0.5)
         + 0.12 * np.sin(2 * np.pi * hz * 9.9 * t) * np.exp(-t / 0.18))
    x *= 1 - 0.3 * (0.5 + 0.5 * np.sin(2 * np.pi * trem * t))
    return x * vel * np.minimum(1, t / 0.002) * np.minimum(1, (dur - t) / 0.06)


def xylo(hz, dur=0.22, vel=1.0):
    t = t_axis(dur)
    x = np.sin(2 * np.pi * hz * t) * np.exp(-t / 0.07) + 0.4 * np.sin(2 * np.pi * hz * 3.0 * t) * np.exp(-t / 0.03) + 0.15 * np.sin(2 * np.pi * hz * 6.0 * t) * np.exp(-t / 0.015)
    return x * vel * np.minimum(1, t / 0.001)


def mute_trumpet(hz, dur, vel=1.0, vib=0.004, scoop=0.06, glide_to=None):
    """Harmon-muted trumpet: saw, nasal band-pass formants (~1.1k/2.3k), lip scoop, delayed vibrato, breath."""
    t = t_axis(dur)
    f0 = hz if glide_to is None else hz * (glide_to / hz) ** np.clip(t / dur, 0, 1) ** 1.5
    f = f0 * (1 - scoop * np.exp(-t / 0.05))
    f = f * (1 + vib * np.sin(2 * np.pi * 5.3 * t) * np.clip((t - 0.2) / 0.3, 0, 1))
    tone = bl_saw(f, rolloff=0.9)
    nasal = butter(tone, [900, 1400], "band", 2) * 1.6 + butter(tone, [2000, 2800], "band", 2) * 0.9 + butter(tone, 700, "low", 2) * 0.35
    breath = butter(white(len(t)), [2500, 6000], "band", 2) * 0.05
    env = adsr(len(t), 0.02, 0.06, 0.85, min(0.12, dur / 3))
    return (nasal + breath) * env * vel


def mute_trombone(hz, dur, vel=1.0, wah=None, sag=0.0):
    """Plunger-muted trombone with an opening/closing low-pass 'wah'."""
    t = t_axis(dur)
    f = hz * (1 - 0.03 * np.exp(-t / 0.04)) * (1 - sag * np.clip(t / dur, 0, 1))
    f = f * (1 + 0.012 * np.sin(2 * np.pi * 5.0 * t) * np.clip((t - 0.2) / 0.3, 0, 1))
    tone = 0.6 * bl_saw(f) + 0.4 * bl_saw(f * 1.004)
    fc = 450 + 1200 * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.7 if wah is None else wah(t)
    tone = svf(tone, fc, q=2.2, mode="lp")
    return tone * adsr(len(t), 0.03, 0.08, 0.85, min(0.25, dur / 3)) * vel


def strings(hz, dur, vel=1.0, tremolo=0.0, bright=3500):
    t = t_axis(dur)
    x = sum(bl_saw(np.full(len(t), hz * d)) for d in (0.994, 1.0, 1.007)) / 3
    x = butter(x, bright, "low", 2) * adsr(len(t), 0.06, 0.2, 0.8, min(0.4, dur / 3))
    if tremolo:
        x *= 1 - 0.5 * (0.5 + 0.5 * np.sin(2 * np.pi * tremolo * t))
    return x * vel


def kick(hz=55, dur=0.5, drop=100):
    t = t_axis(dur)
    return np.sin(phase_from_freq(hz + drop * np.exp(-t / 0.02))) * np.exp(-t / 0.18)


def brush_hat(dur=0.08, amp=1.0):
    t = t_axis(dur)
    return butter(white(len(t)), [5000, 10000], "band", 2) * np.exp(-t / 0.02) * amp


def brush_swish(dur=0.28, amp=1.0):
    t = t_axis(dur)
    env = np.minimum(1, t / 0.04) * np.exp(-t / 0.09)
    return butter(white(len(t)), [2500, 7000], "band", 2) * env * amp


def cymbal(dur=2.0, amp=1.0, tau=0.7):
    t = t_axis(dur)
    n = butter(white(len(t)), 4000, "high", 2)
    metal = sum(np.sin(2 * np.pi * f * t + i) for i, f in enumerate([3120, 4410, 5230, 6780, 7910, 9040])) * 0.08
    return (n + metal) * np.exp(-t / tau) * np.minimum(1, t / 0.003) * amp


def wood_hit(dur=0.5, hz=480, amp=1.0):
    t = t_axis(dur)
    body = np.sin(2 * np.pi * hz * t) * np.exp(-t / 0.05) + 0.6 * np.sin(2 * np.pi * hz * 1.9 * t) * np.exp(-t / 0.03) + 0.3 * np.sin(2 * np.pi * hz * 3.4 * t) * np.exp(-t / 0.02)
    click = butter(white(len(t)), 1500, "high", 2) * np.exp(-t / 0.004) * 1.2
    thump = np.sin(phase_from_freq(95 + 70 * np.exp(-t / 0.02))) * np.exp(-t / 0.09) * 0.8
    return (body + click + thump) * amp


def smooth_noise(n, fc, seed=0):
    r = np.random.default_rng(seed)
    x = butter(r.standard_normal(n), fc, "low", 2)
    return x / (np.abs(x).max() + 1e-12)


def creak(dur=1.5, f0=150, seed=1, amp=1.0):
    """Hinge/floorboard creak: stick-slip pulse train with wandering pitch through a sweeping resonant band-pass."""
    t = t_axis(dur)
    wob = smooth_noise(len(t), 3.0, seed)
    f = f0 * (1 + 0.45 * wob + 0.25 * np.sin(2 * np.pi * 0.7 * t))
    src = bl_saw(np.clip(f, 40, 900), max_h=40, rolloff=0.7)
    fc = 600 + 700 * (0.5 + 0.5 * smooth_noise(len(t), 2.0, seed + 5)) + 500 * np.sin(np.pi * t / dur)
    sig = svf(src, fc, q=5.0, mode="bp")
    gate = 0.55 + 0.45 * smooth_noise(len(t), 9.0, seed + 9)
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.8
    return sig * gate * env * amp


def tick(hz=1100, amp=1.0, tau=0.012):
    t = t_axis(0.12)
    n = butter(white(len(t)), [1800, 4200], "band", 2) * np.exp(-t / 0.004)
    return (n * 1.4 + np.sin(2 * np.pi * hz * t) * np.exp(-t / tau)) * amp


def mixin(*parts, n=None):
    out = np.zeros(1)
    for x, at, g in parts:
        out = place(out, x, at, g)
    return out


# ------------------------------------------------------------------ OPENING THE CASE / THEMES

@cue("door_creak")
def door_creak():
    """Slow wooden door creak (hinge stick-slip). Scene/room entrance foley (instead of a slide-whistle cartoon zip)."""
    return reverb(creak(1.7, 135, seed=4), dur=0.7, wet=0.18)


@cue("case_open")
def case_open():
    """OPENING THE CASE (title Start). Door creak -> two clock ticks -> low cello/bass sting under a muted-piano Cm(add9)
    chord that decays into the room. Moody, unresolved, NOT triumphant."""
    out = creak(1.5, 128, seed=2, amp=1.0)
    out = place(out, tick(1000, 0.9), 1.50)
    out = place(out, tick(820, 0.7), 1.95)
    sting = strings(65.41, 2.8, 0.9, tremolo=0, bright=1800) + 0.8 * strings(98.0 * 0.9439, 2.8, 0.5, bright=1500)  # C2 + Gb2 (tritone)
    out = place(out, sting * np.minimum(1, t_axis(2.8) / 0.5), 2.35, 0.9)
    for i, hz in enumerate([130.81, 196.0, 233.08, 311.13, 349.23 * 1.0]):
        out = place(out, piano(hz, 3.2, 0.55), 2.35 + 0.012 * i, 0.9)
    out = place(out, kick(48, 0.7, 40), 2.35, 0.6)
    return reverb(out, dur=1.8, wet=0.28, lp=3500)


def _theme(bpm, swing, chords, bass, melody, total_beats, tail=2.0, seed=0, final_cymbal=False, mel_gain=1.0):
    b = 60.0 / bpm
    out = np.zeros(1)
    # piano comping
    for beat, voic, dur_b, vel in chords:
        for i, hz in enumerate(voic):
            out = place(out, piano(hz, dur_b * b + 0.5, vel), beat * b + 0.01 * i, 0.5)
    for beat, hz, dur_b in bass:
        out = place(out, ks_pluck(hz, dur_b * b + 0.2, 0.9955, 0.25, seed=int(beat * 7) + seed), beat * b, 0.9)
    # brushes: swing ride on every beat + skip, swish on 2 and 4
    nb = int(total_beats)
    for k in range(nb):
        out = place(out, brush_hat(0.08, 0.5), k * b, 0.5)                 # ride on the beat
        out = place(out, brush_hat(0.07, 0.3), k * b + swing * b, 0.45)    # swung skip note (swing=0.6 ~ triplet feel)
        if k % 2 == 1:
            out = place(out, brush_swish(0.3, 0.5), k * b, 0.5)
    for beat, hz, dur_b, vel, kw in melody:
        out = place(out, mute_trumpet(hz, dur_b * b + 0.12, vel * mel_gain, **kw), beat * b, 1.0)
    if final_cymbal:
        out = place(out, cymbal(2.2, 0.28, 0.8), (total_beats - 2) * b, 1.0)
    return reverb(out, dur=1.7, wet=0.24, lp=4500)


@cue("theme_noir_minor")
def theme_noir_minor():
    """TITLE / WRONG-ENDING THEME. 66 bpm C-minor smoky jazz: Harmon-muted trumpet over felt piano, walking pizzicato bass and
    brushes. Cm7 - Fm7 - G7b9 - Cm(add9), melody falls and stays unresolved."""
    C2, Eb2, F2, Ab2, G2, B1 = 65.41, 77.78, 87.31, 103.83, 98.0, 61.74
    chords = [
        (0.5, [130.81, 196.0, 233.08, 311.13], 2, 0.7), (2.5, [174.61, 261.63, 311.13, 415.30], 2, 0.7),
        (4.5, [174.61, 246.94, 293.66, 415.30], 2, 0.7), (6.5, [130.81, 196.0, 293.66, 311.13], 3, 0.8),
    ]
    bass = [(0.5, C2, 1), (1.5, Eb2, 1), (2.5, F2, 1), (3.5, Ab2, 1), (4.5, G2, 1), (5.5, B1, 1), (6.5, C2, 3)]
    mel = [
        (0.0, 311.13, 0.5, 0.6, {}), (0.5, 392.0, 1.5, 0.9, {}), (2.0, 415.30, 0.5, 0.7, {}), (2.5, 392.0, 1.0, 0.8, {}),
        (3.5, 349.23, 0.5, 0.7, {}), (4.0, 311.13, 1.5, 0.85, {}), (5.5, 293.66, 0.5, 0.7, {}),
        (6.0, 261.63, 3.0, 0.9, dict(vib=0.007, glide_to=250.0)),
    ]
    return _theme(66, 0.6, chords, bass, mel, 9)


@cue("theme_resolved")
def theme_resolved():
    """SOLVED-ENDING THEME (plays under/after the fanfare). 100 bpm C-major jazz: same muted trumpet + piano + bass, resolves to a
    C6/9 chord with a brush-cymbal swell. Warm and satisfied, not a brass victory blast."""
    C2, D2, E2, G2, F2, A2, B1 = 65.41, 73.42, 82.41, 98.0, 87.31, 110.0, 61.74
    chords = [
        (0.0, [130.81, 196.0, 220.0, 293.66, 329.63], 2, 0.7), (2.0, [146.83, 220.0, 261.63, 349.23], 2, 0.7),
        (4.0, [174.61, 246.94, 293.66, 392.0], 2, 0.7), (6.0, [130.81, 196.0, 220.0, 293.66, 329.63], 4, 0.85),
    ]
    bass = [(0.0, C2, 1), (1.0, E2, 1), (2.0, D2, 1), (3.0, F2, 1), (4.0, G2, 1), (5.0, B1, 1), (6.0, C2, 4)]
    mel = [
        (0.0, 329.63, 0.5, 0.7, {}), (0.5, 392.0, 1.0, 0.9, {}), (1.5, 440.0, 0.5, 0.75, {}), (2.0, 392.0, 0.5, 0.75, {}),
        (2.5, 329.63, 1.0, 0.8, {}), (3.5, 293.66, 0.5, 0.7, {}), (4.0, 329.63, 0.5, 0.75, {}), (4.5, 293.66, 0.5, 0.7, {}),
        (5.0, 392.0, 1.0, 0.85, {}), (6.0, 523.25, 3.0, 0.95, dict(vib=0.006)),
    ]
    return _theme(100, 0.6, chords, bass, mel, 10, final_cymbal=True)


# ------------------------------------------------------------------ DETECTIVE FOLEY / UI

@cue("ui_tap")
def ui_tap():
    """UI button tap: a soft wooden desk-tick (replaces the cartoon pop for buttons; very quiet)."""
    t = t_axis(0.09)
    n = butter(white(len(t)), [1200, 3500], "band", 2) * np.exp(-t / 0.006)
    return (n * 1.2 + np.sin(2 * np.pi * 760 * t) * np.exp(-t / 0.018) * 0.8) * np.minimum(1, t / 0.0008)


@cue("ui_paper")
def ui_paper():
    """Notebook / case-file open or close: paper rustle with a soft flap."""
    t = t_axis(0.55)
    env = (np.minimum(1, t / 0.02) * np.exp(-t / 0.2)) * (0.6 + 0.4 * smooth_noise(len(t), 25, 3) ** 2)
    n = butter(white(len(t)), [1500, 7000], "band", 2) * env
    flap = butter(white(len(t)), [200, 900], "band", 2) * np.exp(-((t - 0.04) / 0.02) ** 2) * 0.8
    return n + flap


@cue("typewriter_tap")
def typewriter_tap():
    """Notebook: a short burst of 4 typewriter keystrokes (note added / clue written down)."""
    out = np.zeros(1)
    for i, at in enumerate([0.0, 0.085, 0.17, 0.30]):
        t = t_axis(0.09)
        key = butter(white(len(t)), 2500, "high", 2) * np.exp(-t / 0.003) * 1.2
        clack = butter(white(len(t)), [700, 1800], "band", 2) * np.exp(-t / 0.012) * 0.9
        thud = np.sin(2 * np.pi * (170 + 15 * i) * t) * np.exp(-t / 0.014)
        ring = np.sin(2 * np.pi * 3100 * t) * np.exp(-t / 0.01) * 0.25
        out = place(out, key + clack + thud + ring, at, 1.0 if i != 3 else 1.15)
    return reverb(out, dur=0.4, wet=0.1)


@cue("typewriter_return")
def typewriter_return():
    """Notebook: carriage-return slide and bell 'ding' (new entry written / page full)."""
    t = t_axis(0.35)
    slide = butter(white(len(t)), [800, 5000], "band", 2) * (0.5 + 0.5 * (np.sin(2 * np.pi * 70 * t) > 0)) * np.minimum(1, t / 0.02) * np.exp(-((t - 0.15) / 0.12) ** 2)
    out = place(np.zeros(1), slide, 0, 0.5)
    tb = t_axis(0.9)
    bell = (np.sin(2 * np.pi * 2900 * tb) + 0.4 * np.sin(2 * np.pi * 2900 * 2.76 * tb)) * np.exp(-tb / 0.35)
    out = place(out, bell * np.minimum(1, tb / 0.001), 0.33, 0.7)
    return reverb(out, dur=0.5, wet=0.1)


@cue("search_rustle")
def search_rustle():
    """SEARCHING a location: soft tiptoe footsteps, drawer/paper rustle and a small magnifier-glass tink."""
    out = np.zeros(1)
    for i, at in enumerate([0.0, 0.42, 0.88]):
        t = t_axis(0.25)
        step = butter(white(len(t)), 450 + 80 * (i % 2), "low", 2) * np.exp(-t / 0.035) * 1.5
        heel = butter(white(len(t)), [1200, 2800], "band", 2) * np.exp(-t / 0.006) * 0.25
        out = place(out, step + heel, at, 0.8)
    r = t_axis(0.8)
    rustle = butter(white(len(r)), [2000, 7500], "band", 2) * (smooth_noise(len(r), 14, 5) ** 2) * np.sin(np.pi * np.clip(r / 0.8, 0, 1))
    out = place(out, rustle, 1.0, 0.45)
    tk = t_axis(0.5)
    tink = (np.sin(2 * np.pi * 4200 * tk) + 0.5 * np.sin(2 * np.pi * 6400 * tk)) * np.exp(-tk / 0.09)
    out = place(out, tink * np.minimum(1, tk / 0.001), 1.75, 0.22)
    return reverb(out, dur=0.8, wet=0.15)


@cue("clue_stinger")
def clue_stinger():
    """CLUE FOUND. Noir 'dun-dun': two low felt-piano notes (C3 then Ab2) under a vibraphone shimmer (C5, Eb5). Intriguing, not a victory."""
    out = np.zeros(1)
    out = place(out, piano(130.81, 1.2, 1.0), 0.0, 0.8)
    out = place(out, piano(65.41, 1.2, 0.8), 0.0, 0.6)
    out = place(out, vibes(523.25, 1.6, 0.6), 0.02, 0.5)
    out = place(out, piano(103.83, 1.8, 1.0), 0.34, 0.9)
    out = place(out, piano(51.91, 1.8, 0.9), 0.34, 0.6)
    out = place(out, vibes(622.25, 1.8, 0.7), 0.36, 0.55)
    out = place(out, vibes(783.99, 1.6, 0.4), 0.52, 0.3)
    return reverb(out, dur=1.4, wet=0.25, lp=4000)


# ------------------------------------------------------------------ STRESS / HEARTBEAT LOOPS

def _beat(vel=1.0):
    """One 'lub-dub' heartbeat: low thump + phone-speaker-friendly mid body (130-300 Hz) and a faint skin click."""
    def thump(amp, hz):
        t = t_axis(0.22)
        low = np.sin(phase_from_freq(hz + 45 * np.exp(-t / 0.025))) * np.exp(-t / 0.07)
        mid = np.sin(phase_from_freq(2.6 * hz + 80 * np.exp(-t / 0.02))) * np.exp(-t / 0.035) * 0.55
        click = butter(white(len(t)), [400, 1400], "band", 2) * np.exp(-t / 0.006) * 0.25
        return (low + mid + click) * amp * np.minimum(1, t / 0.003)
    return thump(1.0, 52), thump(0.7, 60)


def heartbeat(bpm, beats=4, gap=0.3):
    b = 60.0 / bpm
    N = int(round(b * beats * SR))
    buf = np.zeros(N)
    lub, dub = _beat()
    for k in range(beats):
        for x, at in ((lub, k * b), (dub, k * b + gap * b)):
            i = int(at * SR)
            idx = (i + np.arange(len(x))) % N      # wrap tails around the loop end: perfectly seamless
            np.add.at(buf, idx, x)
    return buf


@cue("heartbeat_slow")
def heartbeat_slow():
    """STRESS loop, band 'defensive' (31-60): slow ~54 bpm lub-dub, 4 beats, exactly loopable."""
    return heartbeat(54)


@cue("heartbeat_mid")
def heartbeat_mid():
    """STRESS loop, band 'nervous' (61-80): ~84 bpm lub-dub, 4 beats, exactly loopable."""
    return heartbeat(84, gap=0.32)


@cue("heartbeat_fast")
def heartbeat_fast():
    """STRESS loop, bands 'panicking'/'breakdown' (81-100): ~132 bpm lub-dub, 8 beats, exactly loopable."""
    return heartbeat(132, beats=8, gap=0.36)


# ------------------------------------------------------------------ ACCUSATION / CONFRONTATION / BREAKDOWN

@cue("gavel_bang")
def gavel_bang():
    """Gavel / judge's-block bang: wooden crack with a low thump and room. Short dramatic accent."""
    out = place(wood_hit(0.6, 520), timpani(82.4, 0.7, 0.55), 0.0)       # wood crack + a little drum-skin body so it carries on phone speakers
    return reverb(out, dur=1.0, wet=0.28, lp=5000)


@cue("accusation_roll")
def accusation_roll():
    """ACCUSATION: 1.2 s accelerating snare roll + timpani tremolo + cymbal swell, landing on a gavel bang, low hit and cymbal crash (2.6 s).
    Replaces the lone `impact` bonk; the verdict cue (thunder/fanfare or wah-wah) should start after ~1.4 s."""
    roll_len = 1.2
    n = int(roll_len * SR)
    t = np.arange(n) / SR
    imp = np.zeros(n)
    at = 0.0
    while at < roll_len:
        imp[int(at * SR)] = 0.3 + 0.7 * (at / roll_len) ** 1.3
        at += 0.095 * (1 - 0.7 * (at / roll_len))
    kern = np.exp(-t[:int(0.05 * SR)] / 0.015)
    env = ss.fftconvolve(imp, kern)[:n]
    snare = butter(white(n), [1200, 6000], "band", 2) * env + np.sin(2 * np.pi * 190 * t) * env * 0.3
    tim = np.sin(2 * np.pi * 80 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 14 * t)) * (0.2 + 0.8 * (t / roll_len)) * 0.4
    swell = butter(white(n), 5000, "high", 2) * (t / roll_len) ** 2.2 * 0.35
    out = snare * 0.9 + tim + swell
    out = place(out, wood_hit(0.6, 520, 1.1), roll_len)
    out = place(out, kick(45, 0.9, 70), roll_len, 1.1)
    out = place(out, cymbal(1.4, 0.4, 0.6), roll_len, 1.0)
    return reverb(out, dur=1.3, wet=0.2, lp=5000)


@cue("confront_sting")
def confront_sting():
    """CONFRONTATION (two suspects face to face): tense stalking pizzicato (C - Db - C - Gb) into a dissonant string stab and low timpani (2.2 s)."""
    out = np.zeros(1)
    for i, (at, hz) in enumerate([(0.0, 130.81), (0.22, 138.59), (0.44, 130.81), (0.66, 92.5)]):
        out = place(out, ks_pluck(hz, 0.5, 0.993, 0.6, seed=i), at, 0.8)
    for hz in [65.41, 92.5, 261.63, 277.18, 369.99]:
        out = place(out, strings(hz, 1.4, 0.35, tremolo=9, bright=3800), 0.95, 1.0)
    out = place(out, timpani(65.41, 1.2, 0.9), 0.95)
    out = place(out, piano(65.41, 1.4, 0.7), 0.95, 0.6)
    return reverb(out, dur=1.5, wet=0.25, lp=4000)


@cue("contradiction_stab")
def contradiction_stab():
    """CONTRADICTION found (lie broken): muted-brass 'dun-DUN' stab on a Cm / Gb tritone + piano + timpani (1.4 s). Replaces impact + surprise_sting stack."""
    out = np.zeros(1)
    for at, chord, g in [(0.0, [130.81, 185.0], 0.8), (0.3, [138.59, 196.0, 277.18], 1.0)]:
        for hz in chord:
            out = place(out, brass(hz, 0.55, 0.9, vib=False), at, 0.45 * g)
        out = place(out, piano(chord[0] / 2, 1.0, 0.8), at, 0.5 * g)
    out = place(out, timpani(65.41, 1.0, 0.8), 0.3)
    return reverb(out, dur=1.3, wet=0.22, lp=4500)


@cue("breakdown_crack")
def breakdown_crack():
    """BREAKDOWN (stress hits 100, the suspect cracks): glass-crack ping, shrieking string cluster, a falling slide whistle (the slapstick seasoning) and a low timpani (2.3 s)."""
    out = np.zeros(1)
    t = t_axis(0.6)
    glass = butter(white(len(t)), 3500, "high", 2) * np.exp(-t / 0.03) + sum(np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, d in [(4300, 0.2), (5650, 0.15), (7210, 0.1)]) * 0.25
    out = place(out, glass, 0.0, 0.8)
    for hz in [587.33, 622.25, 698.46, 739.99]:
        s = strings(hz, 1.0, 0.3, tremolo=0, bright=6000)
        out = place(out, s * np.linspace(0.5, 1, len(s)), 0.05, 1.0)
    ts = t_axis(0.8)
    f = 1900 * (300 / 1900) ** np.clip(ts / 0.8, 0, 1)
    wh = np.sin(phase_from_freq(f)) * 0.7 + 0.1 * np.sin(2 * phase_from_freq(f))
    wh *= (1 + 0.04 * np.sin(2 * np.pi * 6 * ts)) * np.minimum(1, ts / 0.02) * np.minimum(1, (0.8 - ts) / 0.05)
    out = place(out, wh, 0.55, 0.6)
    out = place(out, timpani(55.0, 1.3, 1.0), 0.0)
    return reverb(out, dur=1.4, wet=0.22, lp=5000)


# ------------------------------------------------------------------ EMOTION STINGS (noir)

@cue("emo_angry")
def emo_angry():
    """ANGRY: growling muted trombone on Ab2 with a closing plunger and a wooden thump (0.8 s)."""
    t = t_axis(0.7)
    tone = mute_trombone(103.83, 0.7, 1.0, wah=lambda tt: 1100 - 700 * np.clip(tt / 0.7, 0, 1))
    tone = tone * (1 - 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * 38 * t)))
    out = place(tone, wood_hit(0.4, 300, 0.7), 0.0)
    return reverb(out, dur=0.6, wet=0.15)


@cue("emo_nervous")
def emo_nervous():
    """NERVOUS: high violin shiver (fast tremolo, drooping pitch) plus two skittish pizzicato ticks (1.0 s)."""
    t = t_axis(0.9)
    f = 784.0 * (1 - 0.06 * np.clip(t / 0.9, 0, 1)) * (1 + 0.004 * np.sin(2 * np.pi * 7 * t))
    v = bl_saw(f, rolloff=1.2)
    v = butter(v, 4500, "low", 2) * (1 - 0.6 * (0.5 + 0.5 * np.sin(2 * np.pi * 13 * t))) * adsr(len(t), 0.08, 0.1, 0.7, 0.35)
    out = place(v, ks_pluck(659.25, 0.25, 0.98, 0.8, seed=2), 0.0, 0.6)
    out = place(out, ks_pluck(587.33, 0.25, 0.98, 0.8, seed=3), 0.14, 0.5)
    return reverb(out, dur=0.7, wet=0.15)


@cue("emo_shocked")
def emo_shocked():
    """SHOCKED: orchestral mini-stab (tritone) then a quick xylophone zip up (slapstick) (0.9 s)."""
    out = np.zeros(1)
    for hz in [261.63, 369.99, 523.25]:
        out = place(out, brass(hz, 0.25, 1.0, vib=False), 0.0, 0.45)
    out = place(out, timpani(65.41, 0.5, 0.7), 0.0)
    for i, hz in enumerate([523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1318.5]):
        out = place(out, xylo(hz, 0.3, 0.7), 0.22 + 0.035 * i, 0.5)
    return reverb(out, dur=0.7, wet=0.15)


@cue("emo_smug")
def emo_smug():
    """SMUG: lazy muted-trumpet slide-up 'waaah-hah' (Bb3 -> D4) with a cool finger-snap-ish tick (0.9 s)."""
    out = mute_trumpet(233.08, 0.8, 0.8, vib=0.01, scoop=0.12, glide_to=293.66)
    out = place(out, tick(1800, 0.6), 0.0, 0.5)
    return reverb(out, dur=0.7, wet=0.15)


@cue("emo_sad")
def emo_sad():
    """SAD: two soft muted-trombone notes sagging down (Eb3 -> D3) 'wah-wahhh' (1.4 s). The long `wah_wah` stays for the wrong-accusation ending."""
    out = mute_trombone(155.56, 0.4, 0.9)
    out = place(out, mute_trombone(146.83, 1.0, 0.9, sag=0.04), 0.4)
    return reverb(out, dur=0.8, wet=0.16)


# ------------------------------------------------------------------ AMBIENT BEDS (seamless by construction)

def pbutter(x, fc, kind="low", order=2):
    """Zero-phase-free but PERIODIC filtering: run the filter over three tiled copies and keep the middle one, so a loop's
    end flows into its start with no start-up transient."""
    n = len(x)
    return butter(np.tile(x, 3), fc, kind, order)[n:2 * n]


def pnoise(L, mag_fn, seed=0):
    """Noise that is EXACTLY periodic over L seconds: random-phase spectrum shaped by mag_fn(freq_hz), inverse FFT."""
    N = int(round(L * SR))
    r = np.random.default_rng(seed)
    fr = np.fft.rfftfreq(N, 1 / SR)
    mag = mag_fn(np.maximum(fr, 1.0))
    mag[0] = 0
    spec = mag * np.exp(1j * r.uniform(0, 2 * np.pi, len(fr)))
    x = np.fft.irfft(spec, N)
    return x / np.sqrt(np.mean(x ** 2))


def periodic_lfo(L, cycles, phases, amps, n):
    t = np.arange(n) / n
    return sum(a * np.sin(2 * np.pi * c * t + p) for c, p, a in zip(cycles, phases, amps))


def circ_add(buf, x, at):
    N = len(buf)
    idx = (int(at * SR) + np.arange(len(x))) % N
    np.add.at(buf, idx, x)


def band(lo, hi, slope=0.0):
    def f(fr):
        m = ((fr > lo) & (fr < hi)).astype(float) * fr ** (-slope / 2)
        # smooth the edges (octave-ish roll-off)
        m *= 1 / (1 + (lo / fr) ** 4) / (1 + (fr / hi) ** 4)
        return m
    return f


def rain_bed(L, seed, muffle_hz, wash_gain, drops_gain, patter_gain, thunders, clock=False):
    N = int(round(L * SR))
    t = np.arange(N) / SR
    wash = pnoise(L, band(350, muffle_hz, slope=0.8), seed) * wash_gain
    gust = 1 + periodic_lfo(L, [1, 2, 3, 5], [0.3, 1.7, 4.0, 2.2], [0.12, 0.08, 0.05, 0.04], N)
    x = wash * gust
    r = np.random.default_rng(seed + 100)
    imp = np.zeros(N)
    nd = int(L * 38)
    imp[r.integers(0, N, nd)] = r.uniform(0.15, 1.0, nd)
    k = t_axis(0.03)
    ker = np.sin(2 * np.pi * 2600 * k) * np.exp(-k / 0.004)
    drops = pbutter(np.fft.irfft(np.fft.rfft(imp) * np.fft.rfft(ker, N), N), [1200, min(7000, muffle_hz)], "band", 2)
    imp2 = np.zeros(N)
    imp2[r.integers(0, N, int(L * 90))] = r.uniform(0.1, 1.0, int(L * 90))
    pat = pbutter(imp2, [250, 1600], "band", 2)
    x = x + drops * drops_gain + pat * patter_gain
    for at, g, sd in thunders:
        th = thunder(False, seed=sd, dur=7.0)
        th = th.mean(1) if th.ndim == 2 else th
        th = th / np.abs(th).max() * g
        circ_add(x, th, at)
    if clock:
        for s in range(int(L)):
            circ_add(x, tick(850 if s % 2 else 1000, 0.05), float(s))
    return x


@cue("rain_loop")
def rain_loop():
    """RAIN BED (existing key, rebuilt): 30 s mono, exactly periodic (no crossfade seam). Outdoor storm wash, drops, gusts and one distant roll. Title screen / generic."""
    return rain_bed(30.0, 11, 9000, 0.9, 0.25, 0.10, [(14.0, 0.55, 21)])


@cue("bed_library")
def bed_library():
    """LIBRARY BED: indoor rain on tall windows (muffled wash, glass drops), two distant thunder rolls and a faint wall-clock tick. 30 s mono, exactly periodic."""
    return rain_bed(30.0, 31, 3800, 0.9, 0.18, 0.10, [(6.0, 0.45, 33), (19.0, 0.6, 8)], clock=True)


@cue("bed_manor")
def bed_manor():
    """MANOR BED: low open-fifth drone, hollow wind with a faint howl, 4 slow creaks, a distant music-box lullaby and two theremin-ish whispers. 36 s mono, exactly periodic."""
    L = 36.0
    N = int(L * SR)
    t = np.arange(N) / SR
    P = lambda f: round(f * L) / L          # snap to an integer number of cycles per loop -> periodic
    drone = np.zeros(N)
    for f, a, c, ph in [(55.0, 1.0, 1, 0.0), (82.5, 0.5, 2, 1.1), (36.7, 0.7, 1, 2.0), (110.3, 0.2, 3, 0.5), (58.0, 0.6, 2, 4.0)]:
        drone += a * np.sin(2 * np.pi * P(f) * t + ph) * (0.75 + 0.25 * np.sin(2 * np.pi * c * t / L + ph))
    drone = pbutter(drone, 400, "low", 2) * 0.5
    gust = 0.55 + 0.45 * (0.5 + 0.5 * periodic_lfo(L, [1, 2, 3], [0.2, 2.5, 4.4], [0.6, 0.35, 0.2], N))
    wind = pnoise(L, band(120, 900, slope=1.0), 5) * gust * 0.8
    for fc, c, ph in [(540, 3, 0.4), (810, 2, 2.9)]:
        howl = pnoise(L, lambda fr, fc=fc: np.exp(-0.5 * ((fr - fc) / 18) ** 2), int(fc)) * 0.22
        wind += howl * (0.4 + 0.6 * (0.5 + 0.5 * np.sin(2 * np.pi * c * t / L + ph)) ** 3)
    x = drone + wind
    cr = np.zeros(N)
    for at, f0, sd, g in [(5.0, 120, 1, 0.5), (13.5, 170, 2, 0.4), (22.0, 100, 3, 0.55), (30.0, 140, 4, 0.4)]:
        circ_add(cr, creak(1.6, f0, seed=sd, amp=g), at)
    x += cr * 0.6
    # distant music box (inharmonic tine partials) and wow/flutter detune
    tune = [(659.25, 0), (783.99, 0.55), (987.77, 1.1), (880.0, 1.65), (783.99, 2.2), (739.99, 2.75), (659.25, 3.5), (587.33, 4.6)]
    mb = np.zeros(N)
    for start, det in [(8.0, 1.0), (24.5, 0.985)]:
        for hz, off in tune:
            tk = t_axis(1.8)
            f = hz * det * (1 + 0.004 * np.sin(2 * np.pi * 0.6 * tk))
            v = sum(a * np.sin(2 * np.pi * f * r * tk) * np.exp(-tk / d) for r, a, d in [(1, 1, 0.9), (2.32, 0.3, 0.4), (4.25, 0.12, 0.2)])
            circ_add(mb, v * np.minimum(1, tk / 0.002), start + off)
    mb = pbutter(mb, 3200, "low", 2)
    mb = reverb(np.concatenate([mb, np.zeros(int(2 * SR))]), dur=2.0, wet=0.45, lp=3000)
    mbl = mb[:N].copy()
    mbl[:len(mb) - N] += mb[N:]            # wrap the reverb tail
    x += mbl * 0.07
    # theremin-ish whispers (kept clear of the loop seam)
    for at, f1, f2 in [(17.0, 520.0, 610.0), (33.0, 700.0, 640.0)]:
        d = 2.6
        tt = t_axis(d)
        f = f1 + (f2 - f1) * np.clip(tt / d, 0, 1) ** 2
        f = f * (1 + 0.012 * np.sin(2 * np.pi * 5.6 * tt) * np.clip(tt / 1.0, 0, 1))
        th = np.sin(phase_from_freq(f)) * np.sin(np.pi * tt / d) ** 2
        circ_add(x, th * 0.03, at)
    return x


def main():
    only = os.environ.get("ONLY")
    for name, fn in CUES.items():
        if only and name not in only.split(","):
            continue
        x = np.asarray(fn(), float)
        sf.write(os.path.join(MASTERS, name + ".wav"), x.astype(np.float32), SR, subtype="FLOAT")
        print(f"{name:20s} {len(x)/SR:6.2f}s  peak {np.abs(x).max():.3f}")


if __name__ == "__main__":
    main()
