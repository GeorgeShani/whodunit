"""Loudness / peak / size measurement for audio files (ffmpeg ebur128 + astats).

    python3 measure.py <dir-or-files...> > report.json

Per file: duration, channels, bytes, bitrate, integrated LUFS (I), loudness range (LRA),
max momentary (M, 400 ms) and max short-term (S, 3 s) LUFS, true peak (dBTP), sample peak (dBFS),
clipped-sample count. Files shorter than 3 s have no valid S; use M for those.
"""
import json, os, re, subprocess, sys


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stderr


def lra(path, dur):
    if dur < 3.0:
        return None  # loudness range is meaningless below 3 s
    dur = float(json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path], capture_output=True, text=True).stdout)["format"]["duration"])
    out = run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "ebur128", "-f", "null", "-"])
    m = re.search(r"LRA:\s*([\d.]+) LU", out[out.rfind("Summary:"):])
    return float(m.group(1)) if m else None


def measure(path):
    # pad with silence to >= 1 s so BS.1770 (400 ms blocks) can measure very short cues; silence is gated out
    out = run(["ffmpeg", "-nostats", "-hide_banner", "-v", "verbose", "-i", path, "-af", "apad=whole_dur=3.2,ebur128=peak=true:framelog=verbose", "-f", "null", "-"])
    Ms = [float(m) for m in re.findall(r"\bM:\s*(-?[\d.]+)", out) if float(m) > -100]
    Ss = [float(m) for m in re.findall(r"\bS:\s*(-?[\d.]+)", out) if float(m) > -100]
    summ = out[out.rfind("Summary:"):]
    g = lambda pat: (float(re.search(pat, summ).group(1)) if re.search(pat, summ) else None)
    stats = run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "astats=metadata=0", "-f", "null", "-"])
    overall = stats[stats.rfind("Overall"):]
    pk = re.search(r"Peak level dB:\s*(-?[\d.inf]+)", overall)
    clip = re.search(r"Peak count:\s*(\d+)", overall)
    pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=channels,sample_rate:format=duration,bit_rate", "-of", "json", path], capture_output=True, text=True)
    j = json.loads(pr.stdout)
    dur = float(j["format"]["duration"])
    size = os.path.getsize(path)
    return dict(
        file=os.path.basename(path), bytes=size, dur=round(dur, 3), ch=j["streams"][0]["channels"],
        kbps=round(size * 8 / dur / 1000, 1),
        I=g(r"I:\s*(-?[\d.]+) LUFS"), LRA=lra(path, dur),
        M_max=max(Ms) if Ms else None,
        S_max=(max(Ss) if dur >= 3.0 and Ss else None),  # short-term needs a 3 s window
        TP=g(r"Peak:\s*(-?[\d.]+) dBFS"),
        sample_peak=float(pk.group(1)) if pk else None,
        clipped=(float(pk.group(1)) >= -0.05) if pk else None,
    )


if __name__ == "__main__":
    files = []
    for a in sys.argv[1:]:
        if os.path.isdir(a):
            files += sorted(os.path.join(a, f) for f in os.listdir(a) if f.endswith((".ogg", ".mp3", ".wav")))
        else:
            files.append(a)
    print(json.dumps([measure(f) for f in files], indent=1))
