import { describe, expect, it } from "vitest";
import { AudioManager, CUES, MUTE_KEY, type AudioLike } from "@/components/effects/audio";

class FakeAudio implements AudioLike {
  static all: FakeAudio[] = [];
  src = "";
  volume = 1;
  loop = false;
  preload = "";
  currentTime = 0;
  paused = true;
  plays = 0;
  loads = 0;
  constructor(private readonly ogg = true) {
    FakeAudio.all.push(this);
  }
  play() {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.loads++;
  }
  canPlayType(t: string) {
    return this.ogg && t.includes("ogg") ? "probably" : "";
  }
}

function setup(opts: { ogg?: boolean; stored?: string } = {}) {
  FakeAudio.all = [];
  const store = new Map<string, string>(opts.stored ? [[MUTE_KEY, opts.stored]] : []);
  let now = 10_000;
  const intervals: Array<() => void> = [];
  const m = new AudioManager({
    createAudio: () => new FakeAudio(opts.ogg ?? true),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: () => now,
    random: () => 0,
    setInterval: (fn) => {
      intervals.push(fn);
      return intervals.length;
    },
    clearInterval: () => {},
  });
  const byFile = (f: string) => FakeAudio.all.find((a) => a.src.includes(`/${f}.`));
  return { m, store, byFile, tick: (ms: number) => (now += ms), runFades: () => intervals.forEach((f) => f()) };
}

describe("audio manager", () => {
  it("is silent until unlocked by a user gesture", () => {
    const { m } = setup();
    expect(m.play("door_slam")).toBe(false);
    expect(FakeAudio.all.every((a) => a.plays === 0)).toBe(true);
    m.unlock();
    expect(m.play("door_slam")).toBe(true);
  });

  it("preloads every cue on unlock, preferring .ogg and falling back to .mp3", () => {
    const { m, byFile } = setup();
    m.unlock();
    const files = Object.values(CUES).flatMap((c) => c.files);
    for (const f of files) {
      expect(byFile(f)?.src).toBe(`/assets/audio/${f}.ogg`);
      expect(byFile(f)?.loads).toBe(1);
      expect(byFile(f)?.preload).toBe("auto");
    }
    const mp3 = setup({ ogg: false });
    mp3.m.unlock();
    expect(mp3.byFile("boing")?.src).toBe("/assets/audio/boing.mp3");
  });

  it("one instance per cue and no spam: repeats inside the gap are dropped", () => {
    const { m, byFile, tick } = setup();
    m.unlock();
    expect(m.play("door_slam")).toBe(true);
    expect(m.play("door_slam")).toBe(false);
    tick(100);
    expect(m.play("door_slam")).toBe(false);
    tick(CUES.door_slam.minGapMs);
    expect(m.play("door_slam")).toBe(true);
    expect(byFile("door_slam")?.plays).toBe(2);
    expect(FakeAudio.all.filter((a) => a.src.includes("door_slam"))).toHaveLength(1);
  });

  it("rotates dialogue pops and alternates thunder, stopping the previous variant", () => {
    const { m, byFile, tick } = setup();
    m.unlock();
    m.play("thunder");
    const first = FakeAudio.all.find((a) => a.src.includes("thunder") && !a.paused)!;
    tick(5000);
    m.play("thunder");
    const second = FakeAudio.all.find((a) => a.src.includes("thunder") && !a.paused)!;
    expect(second).not.toBe(first);
    expect(first.paused).toBe(true);
    m.play("dialogue_pop");
    tick(500);
    m.play("dialogue_pop");
    const pops = ["dialogue_pop_1", "dialogue_pop_2", "dialogue_pop_3"].map((f) => byFile(f)!.plays);
    expect(pops.filter((n) => n > 0).length).toBe(2);
  });

  it("applies cue volume x gain x master volume", () => {
    const { m, byFile } = setup();
    m.unlock();
    m.setVolume(0.5);
    m.play("boing", { gain: 0.32 });
    expect(byFile("boing")!.volume).toBeCloseTo(CUES.boing.volume * 0.32 * 0.5);
  });

  it("mute persists in localStorage, silences everything and survives a reload", () => {
    const { m, store, byFile } = setup();
    m.unlock();
    m.startAmbient();
    expect(byFile("rain_loop")!.paused).toBe(false);
    m.setMuted(true);
    expect(store.get(MUTE_KEY)).toBe("1");
    expect(byFile("rain_loop")!.paused).toBe(true);
    expect(m.play("boing")).toBe(false);
    const reloaded = setup({ stored: "1" });
    expect(reloaded.m.isMuted()).toBe(true);
    reloaded.m.toggleMuted();
    expect(reloaded.store.get(MUTE_KEY)).toBe("0");
  });

  it("ambient rain waits for unlock, loops, and fades in", () => {
    const { m, byFile, tick, runFades } = setup();
    m.startAmbient();
    expect(byFile("rain_loop")).toBeUndefined();
    m.unlock();
    const rain = byFile("rain_loop")!;
    expect(rain.loop).toBe(true);
    expect(rain.paused).toBe(false);
    expect(rain.volume).toBe(0);
    tick(1000);
    runFades();
    expect(rain.volume).toBeCloseTo(CUES.rain_loop.volume);
    expect(m.play("rain_loop")).toBe(false); // loops aren't one-shots
  });

  it("notifies subscribers (the mute toggle re-renders)", () => {
    const { m } = setup();
    let n = 0;
    const off = m.subscribe(() => n++);
    m.toggleMuted();
    off();
    m.toggleMuted();
    expect(n).toBe(1);
  });
});
