"""WHODUNIT?! SFX kit builder.

Synthesizes the cartoon cues from scratch (numpy/scipy) and builds three hybrid cues
from Kenney CC0 samples (downloaded to ./sources by fetch_sources.sh). Writes 32-bit
float WAV masters to ./masters, then encodes .ogg (Vorbis q5) + .mp3 (LAME V2) into
the repo asset folder via ffmpeg.

Run:  .venv/bin/python make_sfx.py
"""
import os, subprocess, json
import numpy as np
import soundfile as sf
from dsp import *

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "sources")
MASTERS = os.environ.get("WHODUNIT_MASTERS", os.path.join(HERE, "masters"))
OUT = os.environ.get("WHODUNIT_AUDIO_OUT", os.path.join(MASTERS, "_encoded"))
os.makedirs(MASTERS, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
KI = os.path.join(SRC, "kenney_impact-sounds", "Audio")
KR = os.path.join(SRC, "kenney_rpg-audio", "Audio")

CUES = {}


def cue(name, **mkw):
    def deco(fn):
        CUES[name] = (fn, mkw)
        return fn
    return deco


def expdecay(n, tau):
    return np.exp(-np.arange(n) / SR / tau)


# ---------------------------------------------------------------- boing
@cue("boing")
def boing():
    """Spring 'boing': jaw-harp-like tone whose pitch springs up then wobbles and settles."""
    dur = 0.95
    t = t_axis(dur)
    base = 150 * (1 + 0.9 * (1 - np.exp(-t / 0.06)))            # quick upward spring 150 -> ~285 Hz
    wob = 1 + 0.22 * np.exp(-t / 0.28) * np.sin(2 * np.pi * 11 * t)  # decaying 11 Hz spring wobble
    f = base * wob
    tone = bl_saw(f, rolloff=1.3)
    # sweeping formant ("oi-ng") gives the twangy jaw-harp mouth resonance
    fc = 700 + 1500 * np.exp(-t / 0.12) + 350 * np.sin(2 * np.pi * 11 * t) * np.exp(-t / 0.3)
    tone = svf(tone, fc, q=4.0, mode="bp") * 1.5 + 0.35 * np.sin(phase_from_freq(f))
    env = np.minimum(1, t / 0.004) * np.exp(-t / 0.28)
    click = butter(white(len(t)) * expdecay(len(t), 0.004), 2500, "high", 2) * 0.3
    return tone * env + click


# ---------------------------------------------------------------- slide whistle
def slide_whistle(f0, f1, dur=0.75):
    t = t_axis(dur)
    s = t / dur
    curve = s * s * (3 - 2 * s)                                   # smoothstep glide
    f = f0 * (f1 / f0) ** curve                                   # exponential (musical) glide
    f *= 1 + 0.012 * np.sin(2 * np.pi * 6.2 * t) * np.minimum(1, t / 0.15)  # vibrato
    ph = phase_from_freq(f)
    tone = np.sin(ph) + 0.08 * np.sin(2 * ph) + 0.03 * np.sin(3 * ph)
    breath = svf(white(len(t)), f * 1.0, q=6, mode="bp") * 0.18 + butter(white(len(t)), 3000, "high", 2) * 0.025
    env = adsr(len(t), 0.03, 0.05, 0.9, 0.12)
    chiff = butter(white(len(t)) * expdecay(len(t), 0.015), 1800, "high", 2) * 0.15
    return (tone + breath) * env + chiff


@cue("slide_whistle_up")
def slide_up():
    """Slide whistle glissando up ~500 -> 1900 Hz: sine + breathy noise tracking pitch, 6 Hz vibrato."""
    return slide_whistle(480, 1900, 0.75)


@cue("slide_whistle_down")
def slide_down():
    """Slide whistle glissando down ~1900 -> 420 Hz."""
    return slide_whistle(1900, 420, 0.8)


# ---------------------------------------------------------------- impact (hybrid)
@cue("impact")
def impact():
    """Kenney impactPunch_heavy_000 + synthesized low 'bonk' thump + tiny wood knock, light room."""
    punch = load(os.path.join(KI, "impactPunch_heavy_000.ogg"))
    wood = load(os.path.join(KI, "impactWood_heavy_000.ogg"))
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 55 + 110 * np.exp(-t / 0.03)                              # pitch-dropping kick-drum 'bonk'
    thump = np.sin(phase_from_freq(f)) * np.exp(-t / 0.09)
    buf = np.zeros(1)
    buf = place(buf, punch / np.max(np.abs(punch)), 0.0, 0.9)
    buf = place(buf, wood / np.max(np.abs(wood)), 0.0, 0.35)
    buf = place(buf, thump, 0.0, 0.8)
    return reverb(buf, dur=0.35, wet=0.12)


# ---------------------------------------------------------------- wah wah
@cue("wah_wah")
def wah_wah():
    """Muted-trombone 'wah wah wah wahhh': 4 descending semitones, saw + plunger-wah filter."""
    notes = [(233.08, 0.42), (220.00, 0.42), (207.65, 0.42), (196.00, 1.55)]  # Bb3 A3 Ab3 G3
    out = np.zeros(1)
    at = 0.0
    for i, (hz, d) in enumerate(notes):
        t = t_axis(d + 0.08)
        last = i == len(notes) - 1
        f = hz * (1 - 0.03 * np.exp(-t / 0.04))                    # lip 'scoop' into the note
        if last:
            f = f * (1 - 0.035 * np.clip((t - 0.35) / 1.2, 0, 1))   # sags flat at the end
            vib = 1 + 0.018 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.25) / 0.4, 0, 1)
            f = f * vib
        tone = 0.6 * bl_saw(f) + 0.4 * bl_saw(f * 1.004)             # two slightly detuned 'players'
        # plunger mute: filter opens then closes per note ("wa-"); last note pulses "wah-ah-ah"
        if last:
            wah = 0.5 - 0.5 * np.cos(2 * np.pi * 5.2 * np.clip(t - 0.25, 0, None))
            fc = 450 + 1100 * np.minimum(1, t / 0.12) * (0.55 + 0.45 * wah) * np.exp(-np.clip(t - 0.9, 0, None) / 0.6)
        else:
            fc = 450 + 1300 * np.sin(np.pi * np.clip(t / d, 0, 1)) ** 0.7
        tone = svf(tone, fc, q=2.2, mode="lp")
        env = adsr(len(t), 0.03, 0.08, 0.85, 0.10 if not last else 0.35)
        out = place(out, tone * env, at)
        at += d
    return reverb(out, dur=0.9, wet=0.18)


# ---------------------------------------------------------------- thunder
def thunder(close=True, seed=0, dur=6.0):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    ch = []
    # rolling amplitude: several random 'rolls' (gaussian bumps) under a long decay
    rolls = np.zeros(n)
    k = 5 if close else 7
    for _ in range(k):
        c = rng.uniform(0.1, dur * 0.6); w = rng.uniform(0.25, 0.9); a = rng.uniform(0.4, 1.0)
        rolls += a * np.exp(-0.5 * ((t - c) / w) ** 2)
    rolls = rolls / rolls.max()
    decay = np.exp(-t / (1.6 if close else 2.2))
    attack = np.minimum(1, t / (0.01 if close else 0.35))
    for c in range(2):
        r = brown(n) * 0.8 + pink(n) * 0.2
        rum = butter(r, 260 if close else 160, "low", 4)
        rum = rum / np.max(np.abs(rum))
        crackle = butter(white(n), 1200, "high", 2) * (rng.random(n) < 0.004) * 1.0
        crackle = butter(crackle, 5000, "low", 2) * np.exp(-t / 0.5)
        sig = rum * (0.35 + 0.65 * rolls) * decay * attack + crackle * (0.6 if close else 0.1)
        if close:  # initial lightning 'crack': sharp broadband burst + mid tear
            burst = butter(butter(white(n), 300, "high", 2), 5500, "low", 2) * np.exp(-t / 0.06)
            tear = butter(white(n), [300, 3000], "band", 2) * np.exp(-t / 0.25) * np.minimum(1, t / 0.005)
            sig = sig + 0.9 * burst + 0.8 * tear
        ch.append(sig)
    x = np.stack(ch, 1)
    # slow stereo drift of the roll
    pan = 0.5 + 0.25 * np.sin(2 * np.pi * t / dur + seed)
    x[:, 0] *= np.sqrt(1 - pan) * 1.41; x[:, 1] *= np.sqrt(pan) * 1.41
    return reverb(x, dur=2.5, wet=0.3, lp=2500, stereo=True, seed=seed + 11)


@cue("thunder_1", max_gr_db=9.0)
def thunder1():
    """Close strike: sharp crack/tear then low rolling rumble (filtered brown+pink noise), stereo."""
    return thunder(True, seed=3, dur=5.5)


@cue("thunder_2")
def thunder2():
    """Distant rolling thunder: slow swell, no crack, darker and longer, stereo."""
    return thunder(False, seed=8, dur=7.0)


# ---------------------------------------------------------------- door slam (hybrid)
@cue("door_slam")
def door_slam():
    """Kenney doorClose_4 layered with impactWood_heavy_000 + low body thump, hallway reverb."""
    door = load(os.path.join(KR, "doorClose_4.ogg"))
    wood = load(os.path.join(KI, "impactWood_heavy_000.ogg"))
    door /= np.max(np.abs(door)); wood /= np.max(np.abs(wood))
    # align wood hit to the door's main transient
    on = int(np.argmax(np.abs(door) > 0.5))
    n = int(0.5 * SR); t = np.arange(n) / SR
    body = np.sin(phase_from_freq(70 + 60 * np.exp(-t / 0.02))) * np.exp(-t / 0.12)
    buf = np.zeros(1)
    buf = place(buf, door, 0.0, 1.0)
    buf = place(buf, wood, on / SR, 0.7)
    buf = place(buf, body, on / SR, 0.6)
    return reverb(buf, dur=0.9, wet=0.22, lp=4000)


# ---------------------------------------------------------------- fanfare
def brass(hz, dur, bright=1.0, vib=True):
    t = t_axis(dur)
    f = hz * (1 - 0.02 * np.exp(-t / 0.03))
    if vib:
        f = f * (1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.25) / 0.3, 0, 1))
    tone = 0.5 * bl_saw(f) + 0.3 * bl_saw(f * 1.003) + 0.2 * bl_saw(f * 0.997)
    env = adsr(len(t), 0.015, 0.12, 0.8, 0.12)
    fc = hz * (2.0 + 6.0 * bright * (0.6 * env + 0.4 * np.exp(-t / 0.08)))  # 'blat' on attack
    return svf(tone, fc, q=1.0, mode="lp") * env


def timpani(hz, dur=1.2, amp=1.0):
    t = t_axis(dur)
    f = hz * (1 + 0.04 * np.exp(-t / 0.05))
    ph = phase_from_freq(f)
    x = np.sin(ph) + 0.5 * np.sin(1.5 * ph) * np.exp(-t / 0.3) + 0.3 * np.sin(1.98 * ph) * np.exp(-t / 0.2)
    x = x * np.exp(-t / 0.45)
    x += butter(white(len(t)) * expdecay(len(t), 0.02), 800, "low", 2) * 0.6
    return x * amp


@cue("fanfare")
def fanfare():
    """Brass-section 'ta-ta-ta-daaa!' in C major (saw voices, filter-envelope blat) + timpani."""
    C4, E4, G4, C5, E5, G5 = 261.63, 329.63, 392.0, 523.25, 659.25, 783.99
    out = np.zeros(1)
    pick = [(0.00, [G4, C5]), (0.16, [G4, C5]), (0.32, [G4, C5])]
    for at, chord in pick:
        for hz in chord:
            out = place(out, brass(hz, 0.13, 0.8, vib=False), at, 0.45)
    out = place(out, brass(E5, 0.30, 0.9, vib=False), 0.48, 0.5)
    out = place(out, brass(C5, 0.30, 0.9, vib=False), 0.48, 0.4)
    held = [C4, E4, G4, C5, E5, G5]
    for hz in held:
        out = place(out, brass(hz, 1.35, 1.0), 0.80, 0.33)
    out = place(out, timpani(98.0, 0.6, 0.5), 0.48)   # G2
    out = place(out, timpani(65.4, 1.4, 0.9), 0.80)   # C2
    return reverb(out, dur=1.6, wet=0.22)


# ---------------------------------------------------------------- siren
@cue("siren")
def siren():
    """1940s mechanical wailing police siren: rotor tone rising/falling 2 cycles, with rasp."""
    dur = 3.4
    t = t_axis(dur)
    cyc = 1.7
    phase = (t % cyc) / cyc
    shape = np.where(phase < 0.55, np.sin(np.pi / 2 * phase / 0.55) ** 1.2,
                     np.clip(np.cos(np.pi / 2 * np.clip(phase - 0.55, 0, None) / 0.45), 0, 1) ** 1.5)
    spin_up = np.minimum(1, t / 0.5)
    f = 280 + (950 - 280) * shape * (0.4 + 0.6 * spin_up)
    tone = 0.7 * bl_square(f) + 0.3 * bl_saw(2 * f)
    tone = butter(tone, 3500, "low", 2)
    rasp = 1 + 0.15 * np.sin(phase_from_freq(f / 6))           # rotor-port chop
    air = butter(white(len(t)), 1500, "high", 2) * 0.04
    env = np.minimum(1, t / 0.25) * np.minimum(1, (dur - t) / 0.4)
    return reverb((tone * rasp + air) * env * (0.7 + 0.3 * shape), dur=1.0, wet=0.2)


# ---------------------------------------------------------------- dialogue pops
def pop(ratio):
    dur = 0.11
    t = t_axis(dur)
    f = ratio * (420 + 480 * (1 - np.exp(-t / 0.012)))           # rising 'bloop' 420 -> ~900 Hz
    ph = phase_from_freq(f)
    x = np.sin(ph) + 0.15 * np.sin(2 * ph)
    env = np.minimum(1, t / 0.003) * np.exp(-t / 0.028)
    return x * env


@cue("dialogue_pop_1", max_gr_db=2.0)
def pop1():
    """Soft rising sine 'bloop' (~105 ms), base pitch."""
    return pop(1.0)


@cue("dialogue_pop_2", max_gr_db=2.0)
def pop2():
    """Same bloop, ~1 semitone higher."""
    return pop(1.06)


@cue("dialogue_pop_3", max_gr_db=2.0)
def pop3():
    """Same bloop, ~1 semitone lower."""
    return pop(0.944)


# ---------------------------------------------------------------- sneak footsteps (hybrid)
def pluck(hz, dur=0.5, seed=0):
    """Karplus-Strong pizzicato string."""
    rng = np.random.default_rng(seed)
    N = int(SR / hz)
    buf = rng.uniform(-1, 1, N)
    buf = butter(buf, 2000, "low", 2)
    n = int(dur * SR)
    out = np.empty(n)
    for i in range(n):
        out[i] = buf[i % N]
        buf[i % N] = 0.5 * (buf[i % N] + buf[(i + 1) % N]) * 0.994
    return out * np.exp(-np.arange(n) / SR / 0.18)


@cue("footsteps_sneak")
def sneak():
    """Tiptoe pattern: 6 Kenney carpet footsteps + pizzicato 'sneak' bass plucks on each step."""
    steps = [os.path.join(KI, f"footstep_carpet_00{i}.ogg") for i in range(5)]
    notes = [98.0, 146.83, 110.0, 164.81, 98.0, 146.83]          # G2 D3 A2 E3 G2 D3
    out = np.zeros(1)
    for i, hz in enumerate(notes):
        at = i * 0.36
        s = load(steps[i % 5]); s = s / np.max(np.abs(s))
        out = place(out, s, at, 0.55)
        out = place(out, pluck(hz, 0.4, seed=i), at, 0.8)
    return reverb(out, dur=0.6, wet=0.15)


# ---------------------------------------------------------------- surprise sting
@cue("surprise_sting")
def sting():
    """Orchestral hit: dissonant stab (brass + detuned string saws), timpani/bass-drum, crash, hall."""
    dur = 0.9
    chord = [65.41, 130.81, 155.56, 185.0, 261.63, 311.13, 369.99, 523.25]  # C minor + tritone
    out = np.zeros(int(dur * SR))
    t = t_axis(dur)
    for hz in chord:
        out += 0.35 * brass(hz, dur, 1.2, vib=False)
        strings = sum(bl_saw(np.full(len(t), hz * d)) for d in (0.995, 1.0, 1.006)) / 3
        out += 0.18 * butter(strings, 4000, "low", 2) * adsr(len(t), 0.005, 0.2, 0.5, 0.3)
    n = len(t)
    kick = np.sin(phase_from_freq(45 + 120 * np.exp(-t / 0.02))) * np.exp(-t / 0.25)
    crash = butter(butter(white(n), 3000, "high", 2), 10000, "low", 2) * np.exp(-t / 0.35)
    metal = sum(np.sin(2 * np.pi * fr * t + i) for i, fr in enumerate([3120, 4410, 5230, 6780, 7910])) * 0.05 * np.exp(-t / 0.3)
    out = out + 1.0 * kick + 0.25 * crash + metal
    out = place(out, timpani(65.41, 1.2, 0.7), 0.0)
    return reverb(out, dur=2.0, wet=0.3)


# ---------------------------------------------------------------- rain loop
@cue("rain_loop", target_lufs=-20.0, do_trim=False)
def rain_loop():
    """45 s seamless stereo storm bed: pink/white rain wash, random drops, gusts, 1 distant roll."""
    L = 45.0
    xf = 3.0                                     # crossfade length for seamless wrap
    n = int((L + xf) * SR)
    t = np.arange(n) / SR
    ch = []
    rng = np.random.default_rng(42)
    for c in range(2):
        wash = butter(pink(n), [400, 9000], "band", 2) * 0.6 + butter(white(n), 5000, "high", 2) * 0.12
        # individual drops: sparse impulses through resonant little bandpasses
        imp = (rng.random(n) < 0.0009) * rng.uniform(0.2, 1.0, n)
        drops = butter(imp, [1500, 6000], "band", 2) * 3.0
        # patter on a roof / window: denser, darker
        pat = butter((rng.random(n) < 0.004) * rng.uniform(0, 1, n), [300, 1500], "band", 2) * 1.2
        ch.append(wash + drops + pat)
    x = np.stack(ch, 1)
    # gusts: slow random swells shared between channels (avoid periodicity)
    g = butter(RNG.standard_normal(n), 0.15, "low", 2)
    g = (g - g.min()) / (g.max() - g.min())
    x *= (0.75 + 0.35 * g)[:, None]
    wind = butter(pink(n), [150, 700], "band", 2) * (0.2 + 0.5 * g)
    x += np.stack([wind, np.roll(wind, 1500)], 1) * 0.5
    # one soft distant rumble in the middle (away from the loop seam)
    th = thunder(False, seed=21, dur=7.0)
    x = place(x, th[: n - int(19 * SR)] * 0.25 / np.max(np.abs(th)) * np.max(np.abs(x)), 19.0)
    x = x[:n]
    # seamless loop: equal-power crossfade the extra tail over the head
    N, X = int(L * SR), int(xf * SR)
    fade = np.linspace(0, np.pi / 2, X)
    head = x[:X] * np.sin(fade)[:, None] + x[N:N + X] * np.cos(fade)[:, None]
    loop = x[:N].copy()
    loop[:X] = head
    return loop


# ---------------------------------------------------------------- clue ding
def bell(hz, dur=1.3):
    t = t_axis(dur)
    partials = [(1.0, 1.0, 1.0), (2.76, 0.45, 0.45), (5.40, 0.25, 0.25), (8.93, 0.12, 0.15), (2.0, 0.2, 0.7)]
    x = sum(a * np.sin(2 * np.pi * hz * r * t) * np.exp(-t / (0.9 * d)) for r, a, d in partials)
    return x * np.minimum(1, t / 0.002)


@cue("clue_ding", max_gr_db=3.0)
def clue_ding():
    """Glockenspiel 'ding-DING!' (E6 -> B6) with inharmonic bar partials + a sparkle shimmer."""
    out = np.zeros(1)
    out = place(out, bell(1318.5, 0.9), 0.0, 0.6)
    out = place(out, bell(1975.5, 1.4), 0.12, 0.8)
    t = t_axis(0.8)
    sparkle = sum(np.sin(2 * np.pi * f * t) * np.exp(-((t - 0.15 - 0.07 * i) / 0.03) ** 2)
                  for i, f in enumerate([3951, 4699, 5274, 6272])) * 0.12
    out = place(out, sparkle, 0.1)
    return reverb(out, dur=1.2, wet=0.2)


# ---------------------------------------------------------------- build
STEREO = {"thunder_1", "thunder_2", "rain_loop"}


def encode(wav, name):
    ogg = os.path.join(OUT, name + ".ogg")
    mp3 = os.path.join(OUT, name + ".mp3")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "5",
                    "-ar", "44100", ogg], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-q:a", "2",
                    "-ar", "44100", mp3], check=True)


def main():
    report = {}
    for name, (fn, mkw) in CUES.items():
        x = fn()
        if name in STEREO and x.ndim == 1:
            x = np.stack([x, x], 1)
        if name not in STEREO and x.ndim == 2:
            x = x.mean(1)
        y, gr = master(x, **{k: v for k, v in mkw.items()})
        wav = os.path.join(MASTERS, name + ".wav")
        sf.write(wav, y.astype(np.float32), SR, subtype="FLOAT")
        encode(wav, name)
        report[name] = dict(dur=len(y) / SR, limiter_gr_db=round(gr, 2), doc=(fn.__doc__ or "").strip())
        print(f"{name:20s} {len(y)/SR:6.3f}s  GR {gr:5.2f} dB")
    json.dump(report, open(os.path.join(HERE, "build_report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
