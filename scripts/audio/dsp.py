"""Shared DSP helpers for the WHODUNIT?! SFX kit (all original code by Toon)."""
import numpy as np
import scipy.signal as ss
import soundfile as sf
import pyloudnorm as pyln

SR = 44100
RNG = np.random.default_rng(1940)


def t_axis(dur, sr=SR):
    return np.arange(int(round(dur * sr))) / sr


def phase_from_freq(f, sr=SR):
    """Integrate an instantaneous-frequency curve (Hz, per sample) into phase (radians)."""
    return 2 * np.pi * np.cumsum(f) / sr


def bl_saw(f, sr=SR, max_h=80, rolloff=1.0):
    """Band-limited sawtooth by additive synthesis; f may vary per sample."""
    f = np.asarray(f, float)
    ph = phase_from_freq(f, sr)
    out = np.zeros_like(f)
    for k in range(1, max_h + 1):
        mask = (k * f) < 0.45 * sr
        if not mask.any():
            break
        out += mask * np.sin(k * ph) / (k ** rolloff)
    return out * (2 / np.pi)


def bl_square(f, sr=SR, max_h=60):
    f = np.asarray(f, float)
    ph = phase_from_freq(f, sr)
    out = np.zeros_like(f)
    for k in range(1, max_h + 1, 2):
        mask = (k * f) < 0.45 * sr
        if not mask.any():
            break
        out += mask * np.sin(k * ph) / k
    return out * (4 / np.pi)


def adsr(n, a, d, s, r, sr=SR, curve=True):
    """Simple ADSR envelope of n samples; a/d/r in seconds, s level 0..1."""
    A, D, R = int(a * sr), int(d * sr), int(r * sr)
    S = max(n - A - D - R, 0)
    env = np.concatenate([
        np.linspace(0, 1, A, endpoint=False) if A else np.zeros(0),
        (s + (1 - s) * np.exp(-5 * np.linspace(0, 1, D))) if curve else np.linspace(1, s, D),
        np.full(S, s),
        s * (np.exp(-5 * np.linspace(0, 1, R)) if curve else np.linspace(1, 0, R)),
    ])
    env = np.pad(env, (0, max(0, n - len(env))))[:n]
    return env


def butter(x, fc, kind="low", order=4, sr=SR):
    sos = ss.butter(order, fc, btype=kind, fs=sr, output="sos")
    return ss.sosfilt(sos, x, axis=0)


def svf(x, fc, q=0.7, mode="lp", sr=SR):
    """Chamberlin state-variable filter with per-sample cutoff (time-varying 'wah')."""
    fc = np.broadcast_to(np.asarray(fc, float), x.shape)
    f = 2 * np.sin(np.pi * np.clip(fc, 20, sr / 6) / sr)
    damp = 1.0 / q
    lp = bp = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        hp = x[i] - lp - damp * bp
        bp += f[i] * hp
        lp += f[i] * bp
        out[i] = lp if mode == "lp" else (bp if mode == "bp" else hp)
    return out


def white(n):
    return RNG.standard_normal(n)


def brown(n):
    b = np.cumsum(RNG.standard_normal(n))
    b = ss.sosfilt(ss.butter(1, 15, "high", fs=SR, output="sos"), b)  # remove drift
    return b / (np.max(np.abs(b)) + 1e-12)


def pink(n):
    # Paul Kellet-style approximation via filtering white noise
    w = RNG.standard_normal(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    p = ss.lfilter(b, a, w)
    return p / (np.max(np.abs(p)) + 1e-12)


def reverb(x, dur=1.2, wet=0.25, lp=6000, stereo=False, seed=7):
    """Cheap convolution reverb with a synthetic exponentially decaying noise IR."""
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    tt = np.arange(n) / SR
    chans = 2 if stereo else 1
    irs = []
    for c in range(chans):
        ir = r.standard_normal(n) * np.exp(-6.9 * tt / dur)
        ir = butter(ir, lp, "low", 2)
        ir[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))  # small pre-delay feel
        ir /= np.sqrt(np.sum(ir ** 2))
        irs.append(ir)
    if x.ndim == 1 and not stereo:
        wetsig = ss.fftconvolve(x, irs[0])
        dry = np.pad(x, (0, len(wetsig) - len(x)))
        return dry * (1 - wet) + wetsig * wet
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    wets = [ss.fftconvolve(x[:, c], irs[c % chans]) for c in range(2)]
    wetsig = np.stack(wets, 1)
    dry = np.pad(x, ((0, len(wetsig) - len(x)), (0, 0)))
    return dry * (1 - wet) + wetsig * wet


def load(path, sr=SR, mono=True):
    x, fs = sf.read(path, always_2d=True)
    if fs != sr:
        g = np.gcd(int(fs), sr)
        x = ss.resample_poly(x, sr // g, int(fs) // g, axis=0)
    if mono:
        x = x.mean(1)
    return x


def place(buf, x, at, gain=1.0):
    """Mix x into buf starting at time `at` seconds (grows buf if needed)."""
    i = int(at * SR)
    need = i + len(x)
    if need > len(buf):
        pad = [(0, need - len(buf))] + [(0, 0)] * (buf.ndim - 1)
        buf = np.pad(buf, pad)
    buf[i:need] += gain * x
    return buf


# ---------------- mastering ----------------

def trim(x, thresh_db=-60, pre=0.002, tail_fade=0.02):
    mono = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), 1)
    pk = mono.max()
    idx = np.where(mono > pk * 10 ** (thresh_db / 20))[0]
    s = max(idx[0] - int(pre * SR), 0)
    e = min(idx[-1] + int(0.005 * SR), len(x))
    y = x[s:e].copy()
    fi = min(idx[0] - s, len(y))
    if fi > 0:
        ramp = np.linspace(0, 1, fi)
        y[:fi] *= ramp if y.ndim == 1 else ramp[:, None]
    fo = min(int(tail_fade * SR), len(y))
    ramp = np.linspace(1, 0, fo) ** 2
    y[-fo:] *= ramp if y.ndim == 1 else ramp[:, None]
    return y


def loudness(x):
    meter = pyln.Meter(SR)
    y = x
    if len(y) < int(0.5 * SR):  # BS.1770 needs >= 400 ms; pad with silence
        pad = [(0, int(0.5 * SR) - len(y))] + [(0, 0)] * (y.ndim - 1)
        y = np.pad(y, pad)
    return meter.integrated_loudness(y)


def limiter(x, ceiling_db=-1.0, look=0.004, release=0.06):
    """Look-ahead peak limiter (gain computer + moving-min + smoothed release)."""
    c = 10 ** (ceiling_db / 20)
    mono = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), 1)
    g = np.minimum(1.0, c / np.maximum(mono, 1e-12))
    L = max(int(look * SR), 1)
    from scipy.ndimage import minimum_filter1d
    gmin = minimum_filter1d(g, size=2 * L + 1, mode="nearest")
    # smooth: instant attack already handled by lookahead window, exponential release
    a = np.exp(-1.0 / (release * SR))
    sm = np.empty_like(gmin)
    cur = 1.0
    for i in range(len(gmin)):
        cur = gmin[i] if gmin[i] < cur else a * cur + (1 - a) * gmin[i]
        sm[i] = cur
    # attack smoothing with short symmetric window so gain never jumps
    k = np.hanning(L * 2 + 1); k /= k.sum()
    sm = np.minimum(sm, np.convolve(np.pad(sm, L, mode="edge"), k, mode="valid"))
    y = x * (sm if x.ndim == 1 else sm[:, None])
    return y, 20 * np.log10(sm.min())


def master(x, target_lufs=-16.0, peak_db=-1.0, max_gr_db=6.0, do_trim=True):
    """Trim -> gain toward target LUFS -> limiter (bounded GR) -> exact peak normalize."""
    x = np.asarray(x, float)
    x = x - (x.mean(0))  # remove DC
    if do_trim:
        x = trim(x)
    x = x / np.max(np.abs(x))
    lu = loudness(x)
    gain_db = target_lufs - lu
    # how much above the ceiling would the peak land?
    over = gain_db - peak_db  # peak is 0 dBFS now
    if over > max_gr_db:
        gain_db = peak_db + max_gr_db
    x = x * 10 ** (gain_db / 20)
    gr = 0.0
    if np.max(np.abs(x)) > 10 ** (peak_db / 20):
        x, gr = limiter(x, peak_db - 0.1)
    # Loudness wins over peak: only pull the peak down to the ceiling, never push
    # a low-crest sound (siren, rain) up past its loudness target.
    ceil = 10 ** (peak_db / 20)
    pk = np.max(np.abs(x))
    if pk > ceil or gr < 0:
        x = x / pk * ceil
    return x, gr
