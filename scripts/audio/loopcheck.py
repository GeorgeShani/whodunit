"""Loop-seam check: decode a file, join its end to its start, and compare the jump at the seam with the signal's own
sample-to-sample jumps. A click shows up as seam_jump >> p99.9 of normal |diff|. Also compares RMS (50 ms) either side.

    python3 loopcheck.py ../../assets/audio/bed_manor.ogg ...
"""
import subprocess, sys
import numpy as np


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "44100", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(float)


def check(path):
    x = decode(path)
    d = np.abs(np.diff(x))
    seam = abs(x[0] - x[-1])
    # predicted jump if the loop were continuous: linear extrapolation of the last two samples
    pred = abs((x[-1] + (x[-1] - x[-2])) - x[0])
    w = int(0.05 * 44100)
    r_end, r_start = np.sqrt(np.mean(x[-w:] ** 2)), np.sqrt(np.mean(x[:w] ** 2))
    return dict(file=path.split("/")[-1], seconds=round(len(x) / 44100, 3), seam_jump=round(float(seam), 5), extrap_error=round(float(pred), 5),
                p99_9_diff=round(float(np.percentile(d, 99.9)), 5), max_diff=round(float(d.max()), 5),
                rms_end_db=round(20 * np.log10(r_end + 1e-9), 1), rms_start_db=round(20 * np.log10(r_start + 1e-9), 1),
                click=bool(pred > max(3 * np.percentile(d, 99.9), 0.02)))


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(check(p))
