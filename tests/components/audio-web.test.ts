import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AudioManager, CUES, MUTE_KEY, type AudioLike, type ContextLike, type GainNodeLike, type ParamLike, type SourceLike } from "@/components/effects/audio";
import { bedForScreen, bedFadeMs, heartbeatFor, heartbeatLevel } from "@/components/effects/audio-scenes";

class Param implements ParamLike {
  value = 1;
  ramps: Array<[number, number]> = [];
  cancelScheduledValues() {}
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.ramps.push([v, t]);
    this.value = v;
  }
}
class Gain implements GainNodeLike {
  gain = new Param();
  connect() {}
  disconnect() {}
}
class Source implements SourceLike {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;
  gainNode: Gain | null = null;
  connect(n: unknown) {
    if (n instanceof Gain) this.gainNode = n;
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
  disconnect() {}
}
class Ctx implements ContextLike {
  state = "suspended";
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  gains: Gain[] = [];
  sources: Array<Source & { file?: string }> = [];
  resumes = 0;
  suspends = 0;
  createGain() {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  createBuffer() {
    return { silent: true };
  }
  async decodeAudioData(data: ArrayBuffer) {
    return { file: new TextDecoder().decode(data) };
  }
  async resume() {
    this.resumes++;
    this.state = "running";
  }
  async suspend() {
    this.suspends++;
    this.state = "suspended";
  }
}

const audioStub = (): AudioLike => ({ src: "", volume: 1, loop: false, preload: "", currentTime: 0, paused: true, play() {}, pause() {}, load() {}, canPlayType: (t) => (t.includes("ogg") ? "probably" : "") });

function setup(opts: { failOgg?: boolean; stored?: string } = {}) {
  const ctx = new Ctx();
  const store = new Map<string, string>(opts.stored ? [[MUTE_KEY, opts.stored]] : []);
  const fetched: string[] = [];
  let now = 1000;
  let hide: (h: boolean) => void = () => {};
  const timeouts: Array<{ fn: () => void; at: number }> = [];
  const m = new AudioManager({
    createAudio: audioStub,
    createContext: () => ctx,
    fetchBytes: async (url) => {
      fetched.push(url);
      if (opts.failOgg && url.endsWith(".ogg")) throw new Error("decode");
      return new TextEncoder().encode(url).buffer as ArrayBuffer;
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: () => now,
    random: () => 0,
    setTimeout: (fn, ms) => timeouts.push({ fn, at: now + ms }),
    clearTimeout: () => {},
    onHidden: (fn) => (hide = fn),
  });
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  /** The source whose buffer came from this file. */
  const src = (file: string) => ctx.sources.filter((s) => (s.buffer as { file?: string } | null)?.file?.includes(`/${file}.`));
  const gainOf = (file: string) => src(file).at(-1)?.gainNode?.gain;
  return { m, ctx, store, fetched, flush, src, gainOf, hide: (h: boolean) => hide(h), tick: (ms: number) => (now += ms), timeouts };
}

describe("WebAudio engine", () => {
  it("unlock resumes the context inside the gesture, plays a silent buffer, and later taps nudge it awake", async () => {
    const t = setup();
    expect(t.ctx.resumes).toBe(0);
    t.m.unlock();
    expect(t.ctx.resumes).toBe(1);
    expect(t.ctx.sources[0].started).toBe(1); // the silent unlock sample
    t.ctx.state = "interrupted";
    t.m.unlock();
    expect(t.ctx.resumes).toBe(2);
    t.m.unlock(); // already running: nothing to do
    await t.flush();
    expect(t.ctx.resumes).toBe(2);
  });

  it("decodes the core group, then plays through a gain node at cue volume x gain", async () => {
    const t = setup();
    t.m.unlock();
    await t.flush();
    expect(t.fetched).toContain("/assets/audio/case_open.ogg");
    expect(t.m.play("case_open", { gain: 0.5 })).toBe(true);
    expect(t.gainOf("case_open")!.value).toBeCloseTo(CUES.case_open.volume * 0.5);
    expect(t.src("case_open")[0].started).toBe(1);
    expect(t.m.play("case_open")).toBe(false); // minGapMs
  });

  it("a cue asked for before it is decoded plays as soon as it is", async () => {
    const t = setup();
    t.m.unlock();
    expect(t.m.play("case_open")).toBe(true); // queued behind the decode
    expect(t.src("case_open")).toHaveLength(0);
    await t.flush();
    expect(t.src("case_open")).toHaveLength(1);
  });

  it("falls back to mp3 on an ogg decode error", async () => {
    const t = setup({ failOgg: true });
    t.m.unlock();
    await t.flush();
    expect(t.m.format()).toBe("mp3");
    expect(t.fetched).toContain("/assets/audio/case_open.mp3");
    expect(t.m.play("case_open")).toBe(true);
  });

  it("beds: one at a time, ~1.1 s crossfade, waits for the unlock", async () => {
    const t = setup();
    t.m.setBed("bed_manor");
    expect(t.src("bed_manor")).toHaveLength(0);
    t.m.unlock();
    await t.flush();
    const manor = t.src("bed_manor")[0];
    expect(manor.loop).toBe(true);
    expect(t.gainOf("bed_manor")!.ramps.at(-1)![0]).toBeCloseTo(CUES.bed_manor.volume);
    t.m.setBed("bed_library");
    await t.flush();
    expect(manor.stopped).toBe(1); // faded out then stopped
    expect(t.src("bed_library")[0].loop).toBe(true);
    expect(t.m.getBed()).toBe("bed_library");
    t.m.setBed(null, { fadeMs: 3000 });
    expect(t.src("bed_library")[0].stopped).toBe(1);
  });

  it("long stings duck the bed to 0.16 and release it; a heartbeat holds it at 0.25", async () => {
    const t = setup();
    t.m.unlock();
    await t.flush();
    t.m.setBed("bed_library");
    await t.flush();
    const bed = t.gainOf("bed_library")!;
    t.m.play("accusation_roll");
    expect(bed.value).toBeCloseTo(0.16);
    expect(t.m.getDuck()).toBeCloseTo(0.4);
    t.tick(CUES.accusation_roll.duckMs! + 400);
    t.timeouts.forEach((x) => x.fn());
    expect(bed.value).toBeCloseTo(0.4);
    t.m.setHeartbeat(2);
    await t.flush();
    expect(bed.value).toBeCloseTo(0.25);
    t.m.setHeartbeat(0);
    expect(bed.value).toBeCloseTo(0.4);
  });

  it("heartbeat bands switch only on a change, fade 400 ms, and breakdown_crack stops it", async () => {
    const t = setup();
    t.m.unlock();
    await t.flush();
    await t.m.preloadGroup("interrogation");
    t.m.setHeartbeat(1);
    expect(t.src("heartbeat_slow")).toHaveLength(1);
    t.m.setHeartbeat(1);
    expect(t.src("heartbeat_slow")).toHaveLength(1);
    t.m.setHeartbeat(3);
    expect(t.src("heartbeat_slow")[0].stopped).toBe(1);
    expect(t.src("heartbeat_fast")).toHaveLength(1);
    expect(t.gainOf("heartbeat_fast")!.ramps[0][1] - t.ctx.currentTime).toBeCloseTo(0.4);
    t.m.play("breakdown_crack");
    expect(t.src("heartbeat_fast")[0].stopped).toBe(1);
    t.m.setHeartbeat(3); // still on the same screen: stays off
    expect(t.src("heartbeat_fast")).toHaveLength(1);
    t.m.setHeartbeat(0); // leaving the screen clears it
    t.m.setHeartbeat(2);
    expect(t.src("heartbeat_mid")).toHaveLength(1);
  });

  it("mute is master gain 0 + suspend, persisted; unmute resumes beds", async () => {
    const t = setup();
    t.m.unlock();
    await t.flush();
    t.m.setBed("bed_manor");
    await t.flush();
    const manor = t.src("bed_manor")[0];
    t.m.setMuted(true);
    expect(t.store.get(MUTE_KEY)).toBe("1");
    expect(t.ctx.suspends).toBe(1);
    expect(manor.stopped).toBe(1);
    expect(t.m.play("ui_tap")).toBe(false);
    t.m.setMuted(false);
    await t.flush();
    expect(t.ctx.state).toBe("running");
    expect(t.src("bed_manor")).toHaveLength(2);
    expect(t.m.play("ui_tap")).toBe(true);
  });

  it("a hidden tab suspends everything and coming back resumes (unless muted)", async () => {
    const t = setup();
    t.m.unlock();
    await t.flush();
    t.m.setBed("bed_manor");
    await t.flush();
    t.hide(true);
    expect(t.ctx.suspends).toBe(1);
    expect(t.m.play("ui_tap")).toBe(false);
    t.hide(false);
    await t.flush();
    expect(t.ctx.state).toBe("running");
    expect(t.src("bed_manor")).toHaveLength(2);
    t.m.setMuted(true);
    t.hide(true);
    t.hide(false);
    expect(t.m.play("ui_tap")).toBe(false);
  });

  it("reduced motion: thunder is only the distant roll at 0.35, loud stings play at x0.6", async () => {
    const t = setup();
    t.m.unlock();
    await t.flush();
    await t.m.preloadGroup("interrogation");
    t.m.setReducedMotion(true);
    t.m.play("thunder");
    expect(t.src("thunder_1")).toHaveLength(0);
    expect(t.gainOf("thunder_2")!.value).toBeCloseTo(CUES.thunder.volume * 0.35);
    t.m.play("emo_angry");
    expect(t.gainOf("emo_angry")!.value).toBeCloseTo(CUES.emo_angry.volume * 0.6);
    t.m.play("emo_sad"); // not loud
    expect(t.gainOf("emo_sad")!.value).toBeCloseTo(CUES.emo_sad.volume);
  });
});

describe("audio scenes", () => {
  it("maps screens to beds, and the ending's bed dies over 3 s on the end screen", () => {
    expect(bedForScreen("title")).toBe("rain_loop");
    for (const s of ["intro", "suspects", "investigate"]) expect(bedForScreen(s)).toBe("bed_manor");
    for (const s of ["interrogation", "confront", "accuse"]) expect(bedForScreen(s)).toBe("bed_library");
    expect(bedForScreen("ending", "scene")).toBe("bed_library");
    expect(bedForScreen("ending", "summary")).toBeNull();
    expect(bedFadeMs("ending", "summary")).toBe(3000);
    expect(bedFadeMs("ending", "scene")).toBeUndefined();
  });

  it("heartbeat bands: calm none, 31-60 slow, 61-80 mid, 81+ fast; only while questioning", () => {
    expect([0, 30, 31, 60, 61, 80, 81, 100].map(heartbeatLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(heartbeatFor("interrogation", [70])).toBe(2);
    expect(heartbeatFor("confront", [20, 90])).toBe(3);
    expect(heartbeatFor("suspects", [90])).toBe(0);
  });

  it("START CASE plays case_open and never the fanfare; the fanfare is only in the solved ending", () => {
    const title = readFileSync("components/game/TitleScreen.tsx", "utf8");
    expect(title).toContain('play("case_open")');
    expect(title).not.toContain("fanfare\"");
    expect(CUES.case_open.files).toEqual(["case_open"]);
  });
});
