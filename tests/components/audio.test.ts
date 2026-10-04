import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { AudioManager, CORE_FILES, CUES, MUTE_KEY, oggIsRisky, type AudioLike } from "@/components/effects/audio";

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

  it("preloads the core group on unlock (.ogg when supported, else .mp3); the rest loads on demand", () => {
    const { m, byFile } = setup();
    m.unlock();
    for (const f of CORE_FILES) {
      expect(byFile(f)?.src).toBe(`/assets/audio/${f}.ogg`);
      expect(byFile(f)?.loads).toBe(1);
      expect(byFile(f)?.preload).toBe("auto");
    }
    expect(byFile("door_slam")).toBeUndefined();
    m.play("door_slam");
    expect(byFile("door_slam")?.src).toBe("/assets/audio/door_slam.ogg");
    const mp3 = setup({ ogg: false });
    mp3.m.unlock();
    mp3.m.play("boing");
    expect(mp3.byFile("boing")?.src).toBe("/assets/audio/boing.mp3");
  });

  it("every cue file exists as .ogg and .mp3 in assets/audio", () => {
    for (const def of Object.values(CUES)) {
      for (const f of def.files) {
        expect(existsSync(`assets/audio/${f}.ogg`), f).toBe(true);
        expect(existsSync(`assets/audio/${f}.mp3`), f).toBe(true);
      }
    }
  });

  it("picks mp3 on Safari / iOS before 18.4 and ogg elsewhere", () => {
    const iosOld = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const iosNew = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";
    const iosChrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
    const macSafari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";
    const chrome = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
    expect([iosOld, iosChrome, macSafari].map(oggIsRisky)).toEqual([true, true, true]);
    expect([iosNew, chrome, ""].map(oggIsRisky)).toEqual([false, false, false]);
    expect(setup().m.format()).toBe("ogg");
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
    tick(1100);
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
