/**
 * Audio manager for the SFX kit in assets/audio (see its README and
 * docs/SOUND_NOTES.md).
 *
 * - Silent until unlock(): browsers (iOS above all) block audio before a user
 *   gesture, so the first tap / key press unlocks it.
 * - Two engines behind one API. With a WebAudio context (every real browser)
 *   each cue is decoded once and played through
 *   source -> per-voice gain -> master gain -> destination, because iOS ignores
 *   HTMLAudio.volume. Without one (tests, ancient browsers) the same logic
 *   drives plain <audio> elements.
 * - One sound per cue at a time and a per-cue minimum gap, so rapid replies or
 *   clicks never stack into spam.
 * - Beds (setBed): one looping scene bed at a time with a ~1.1 s crossfade.
 *   Heartbeat (setHeartbeat): three stress bands, 400 ms fades.
 *   Ducking: the bed drops under long stings and while a heartbeat runs.
 * - Mute = master gain 0 + context suspend, persisted in localStorage.
 * - Hidden tab / pagehide suspends everything; a gesture or visibility
 *   change resumes it (iOS "interrupted" state included).
 */
import type { AudioCue } from "./emotion-map";

export interface CueDef {
  /** File stems in /assets/audio (variants are picked at random / alternated). */
  files: readonly string[];
  volume: number;
  /** Ignore repeats of this cue within this many ms. */
  minGapMs: number;
  loop?: boolean;
  /** Long sting: the bed ducks for this long (+300 ms) while it plays. */
  duckMs?: number;
}

export const CUES: Record<AudioCue, CueDef> = {
  dialogue_pop: { files: ["dialogue_pop_1", "dialogue_pop_2", "dialogue_pop_3"], volume: 0.35, minGapMs: 120 },
  ui_click: { files: ["ui_tap"], volume: 0.46, minGapMs: 60 },
  door_slam: { files: ["door_slam"], volume: 0.6, minGapMs: 600 },
  slide_whistle_down: { files: ["slide_whistle_down"], volume: 0.55, minGapMs: 600 },
  slide_whistle_up: { files: ["slide_whistle_up"], volume: 0.5, minGapMs: 600 },
  boing: { files: ["boing"], volume: 0.65, minGapMs: 500 },
  wah_wah: { files: ["wah_wah"], volume: 0.55, minGapMs: 2000, duckMs: 3300 },
  surprise_sting: { files: ["surprise_sting"], volume: 0.55, minGapMs: 1500 },
  impact: { files: ["impact"], volume: 0.65, minGapMs: 400 },
  clue_ding: { files: ["clue_ding"], volume: 0.65, minGapMs: 800 },
  fanfare: { files: ["fanfare"], volume: 0.55, minGapMs: 2500, duckMs: 3300 },
  siren: { files: ["siren"], volume: 0.45, minGapMs: 3000 },
  thunder: { files: ["thunder_1", "thunder_2"], volume: 0.5, minGapMs: 2500 },
  footsteps_sneak: { files: ["footsteps_sneak"], volume: 0.55, minGapMs: 1500 },
  rain_loop: { files: ["rain_loop"], volume: 0.4, minGapMs: 0, loop: true },
  // docs/SOUND_NOTES.md section 8.
  accusation_roll: { files: ["accusation_roll"], volume: 0.65, minGapMs: 3000, duckMs: 2900 },
  bed_library: { files: ["bed_library"], volume: 0.4, minGapMs: 0, loop: true },
  bed_manor: { files: ["bed_manor"], volume: 0.4, minGapMs: 0, loop: true },
  breakdown_crack: { files: ["breakdown_crack"], volume: 0.51, minGapMs: 2500, duckMs: 2400 },
  case_open: { files: ["case_open"], volume: 0.54, minGapMs: 4000, duckMs: 6700 },
  clue_stinger: { files: ["clue_stinger"], volume: 0.51, minGapMs: 800 },
  confront_sting: { files: ["confront_sting"], volume: 0.5, minGapMs: 2000 },
  contradiction_stab: { files: ["contradiction_stab"], volume: 0.5, minGapMs: 1500 },
  door_creak: { files: ["door_creak"], volume: 0.42, minGapMs: 800 },
  emo_angry: { files: ["emo_angry"], volume: 0.54, minGapMs: 900 },
  emo_nervous: { files: ["emo_nervous"], volume: 0.5, minGapMs: 900 },
  emo_sad: { files: ["emo_sad"], volume: 0.5, minGapMs: 1200 },
  emo_shocked: { files: ["emo_shocked"], volume: 0.51, minGapMs: 900 },
  emo_smug: { files: ["emo_smug"], volume: 0.5, minGapMs: 900 },
  gavel_bang: { files: ["gavel_bang"], volume: 0.78, minGapMs: 500 },
  heartbeat_fast: { files: ["heartbeat_fast"], volume: 0.32, minGapMs: 0, loop: true },
  heartbeat_mid: { files: ["heartbeat_mid"], volume: 0.33, minGapMs: 0, loop: true },
  heartbeat_slow: { files: ["heartbeat_slow"], volume: 0.34, minGapMs: 0, loop: true },
  search_rustle: { files: ["search_rustle"], volume: 0.39, minGapMs: 1500 },
  theme_noir_minor: { files: ["theme_noir_minor"], volume: 0.5, minGapMs: 8000, duckMs: 10200 },
  theme_resolved: { files: ["theme_resolved"], volume: 0.5, minGapMs: 8000, duckMs: 8000 },
  typewriter_return: { files: ["typewriter_return"], volume: 0.42, minGapMs: 800 },
  typewriter_tap: { files: ["typewriter_tap"], volume: 0.7, minGapMs: 400 },
  ui_paper: { files: ["ui_paper"], volume: 0.44, minGapMs: 300 },
  ui_tap: { files: ["ui_tap"], volume: 0.46, minGapMs: 60 },
};

export const MUTE_KEY = "whodunit:muted";

/** Scene beds (one at a time). */
export type BedName = "rain_loop" | "bed_manor" | "bed_library";
export type HeartbeatLevel = 0 | 1 | 2 | 3;
const HEARTBEATS = [null, "heartbeat_slow", "heartbeat_mid", "heartbeat_fast"] as const;

const BED_FADE_MS = 1100;
const HEART_FADE_MS = 400;
const DUCK_ATTACK_MS = 150;
const DUCK_RELEASE_MS = 600;
/** Bed multiplier (relative to its 0.40 gain): 0.16 under a long sting, 0.25 under a heartbeat. */
const DUCK_STING = 0.16 / 0.4;
const DUCK_HEART = 0.25 / 0.4;
const DUCK_TAIL_MS = 300;
/** A cue asked for before its buffer finished decoding still plays if it lands within this window. */
const LATE_PLAY_MS = 1500;
/** Loud stings play at x0.6 under prefers-reduced-motion. */
const LOUD: ReadonlySet<AudioCue> = new Set<AudioCue>(["emo_shocked", "emo_angry", "breakdown_crack", "contradiction_stab", "door_slam", "impact", "boing"]);

/** Files loaded right after unlock (the rest trickles in afterwards, see preloadRest). */
export const CORE_FILES: readonly string[] = ["ui_tap", "dialogue_pop_1", "dialogue_pop_2", "dialogue_pop_3", "case_open", "rain_loop", "theme_noir_minor"];
/** Loaded in this order once the core is in, so later screens never wait on a decode. */
export const REST_GROUPS: Readonly<Record<string, readonly string[]>> = {
  scenes: ["bed_manor", "bed_library", "door_creak", "ui_paper", "search_rustle", "clue_stinger", "typewriter_tap", "typewriter_return", "clue_ding"],
  interrogation: ["emo_angry", "emo_nervous", "emo_sad", "emo_shocked", "emo_smug", "heartbeat_slow", "heartbeat_mid", "heartbeat_fast", "contradiction_stab", "breakdown_crack", "confront_sting", "thunder_1", "thunder_2", "door_slam", "impact", "boing", "slide_whistle_down", "slide_whistle_up", "surprise_sting"],
  ending: ["accusation_roll", "gavel_bang", "fanfare", "wah_wah", "theme_resolved", "footsteps_sneak", "siren"],
};

/** The subset of HTMLAudioElement the manager uses (so tests can fake it). */
export interface AudioLike {
  src: string;
  volume: number;
  loop: boolean;
  preload: string;
  currentTime: number;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  load(): void;
  canPlayType(type: string): string;
}

/** The subset of AudioContext the WebAudio engine uses (so tests can fake it). */
export interface ParamLike {
  value: number;
  cancelScheduledValues(t: number): unknown;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
}
export interface GainNodeLike {
  gain: ParamLike;
  connect(n: unknown): unknown;
  disconnect(): void;
}
export interface SourceLike {
  buffer: unknown;
  loop: boolean;
  onended: (() => void) | null;
  connect(n: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
  disconnect(): void;
}
export interface ContextLike {
  state: string;
  currentTime: number;
  destination: unknown;
  createGain(): GainNodeLike;
  createBufferSource(): SourceLike;
  createBuffer(channels: number, length: number, rate: number): unknown;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  onstatechange: (() => void) | null;
}

export interface AudioDeps {
  createAudio: () => AudioLike;
  /** Supplying this selects the WebAudio engine. */
  createContext?: () => ContextLike;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
  random?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  userAgent?: string;
  /** Page visibility / pagehide wiring (the real singleton passes document + window). */
  onHidden?: (fn: (hidden: boolean) => void) => void;
}

/** Safari (and every iOS browser) before 18.4 only partly decodes Vorbis: use mp3 there. */
export function oggIsRisky(ua: string): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua);
  const m = ios ? /OS (\d+)[_.](\d+)/.exec(ua) : /Version\/(\d+)\.(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/.exec(ua);
  const safari = ios || (!!m && !/Chrome|Chromium|Edg|OPR|Android/.test(ua));
  if (!safari) return false;
  if (!m) return true;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj < 18 || (maj === 18 && min < 4);
}

interface VoiceSpec {
  id: string;
  file: string;
  gain: number;
  loop: boolean;
  /** Fade in over this many ms (0 = start at full gain). */
  fadeMs: number;
}

interface Engine {
  init(): void;
  /** Resolves true once `file` can start instantly. */
  load(file: string): Promise<boolean>;
  isReady(file: string): boolean;
  start(v: VoiceSpec): boolean;
  setGain(id: string, gain: number, ms: number): void;
  stop(id: string, ms: number): void;
  isActive(id: string): boolean;
  setMaster(v: number): void;
  suspend(): void;
  resume(): void;
  /** Called on every gesture; lets the engine un-stick an interrupted context. */
  nudge(): void;
  reload(): void;
}

type Ext = () => "ogg" | "mp3";
type Fader = { start: number; target: number; t0: number; ms: number; then?: () => void };

/** Plain <audio> elements; fades are stepped on the injected interval. */
class HtmlEngine implements Engine {
  private readonly elements = new Map<string, AudioLike>();
  private readonly voices = new Map<string, { el: AudioLike; gain: number }>();
  private readonly fades = new Map<string, Fader>();
  private timer: unknown = null;
  private master = 1;
  constructor(
    private readonly deps: AudioDeps,
    private readonly ext: Ext,
    private readonly now: () => number,
  ) {}

  init() {}
  reload() {
    /* nothing cached beyond elements */
  }
  nudge() {}
  isReady() {
    return true;
  }
  private element(file: string, loop = false): AudioLike {
    let el = this.elements.get(file);
    if (!el) {
      el = this.deps.createAudio();
      el.preload = "auto";
      el.loop = loop;
      el.src = `/assets/audio/${file}.${this.ext()}`;
      this.elements.set(file, el);
    }
    return el;
  }
  async load(file: string) {
    this.element(file, /(?:rain_loop|bed_|heartbeat_)/.test(file)).load();
    return true;
  }
  private volume(id: string, gain: number) {
    const v = this.voices.get(id);
    if (v) v.el.volume = Math.min(1, Math.max(0, gain * this.master));
  }
  start(v: VoiceSpec) {
    this.stop(v.id, 0);
    const el = this.element(v.file, v.loop);
    el.loop = v.loop;
    this.voices.set(v.id, { el, gain: v.fadeMs ? 0 : v.gain });
    this.volume(v.id, v.fadeMs ? 0 : v.gain);
    try {
      el.currentTime = 0;
    } catch {
      /* not seekable yet */
    }
    try {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      this.voices.delete(v.id);
      return false;
    }
    if (v.fadeMs) this.setGain(v.id, v.gain, v.fadeMs);
    return true;
  }
  setGain(id: string, gain: number, ms: number) {
    const v = this.voices.get(id);
    if (!v) return;
    if (!ms) {
      this.fades.delete(id);
      v.gain = gain;
      this.volume(id, gain);
      return;
    }
    this.fades.set(id, { start: v.gain, target: gain, t0: this.now(), ms });
    this.ensureTimer();
  }
  stop(id: string, ms: number) {
    const v = this.voices.get(id);
    if (!v) return;
    const halt = () => {
      v.el.pause();
      if (this.voices.get(id) === v) this.voices.delete(id);
    };
    if (!ms) {
      this.fades.delete(id);
      halt();
      return;
    }
    this.fades.set(id, { start: v.gain, target: 0, t0: this.now(), ms, then: halt });
    this.ensureTimer();
  }
  isActive(id: string) {
    const v = this.voices.get(id);
    return !!v && !v.el.paused;
  }
  setMaster(m: number) {
    this.master = m;
    for (const id of this.voices.keys()) this.volume(id, this.voices.get(id)!.gain);
  }
  suspend() {
    for (const v of this.voices.values()) v.el.pause();
  }
  resume() {
    for (const v of this.voices.values()) {
      if (!v.el.loop) continue; // one-shots just end
      try {
        const p = v.el.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }
  private ensureTimer() {
    if (this.timer !== null) return;
    this.timer = (this.deps.setInterval ?? setInterval)(() => this.step(), 50);
  }
  private step() {
    const t = this.now();
    for (const [id, f] of [...this.fades]) {
      const v = this.voices.get(id);
      if (!v) {
        this.fades.delete(id);
        continue;
      }
      const k = Math.min(1, (t - f.t0) / f.ms);
      v.gain = f.start + (f.target - f.start) * k;
      this.volume(id, v.gain);
      if (k >= 1) {
        this.fades.delete(id);
        f.then?.();
      }
    }
    if (!this.fades.size && this.timer !== null) {
      (this.deps.clearInterval ?? clearInterval)(this.timer as ReturnType<typeof setInterval>);
      this.timer = null;
    }
  }
}

/** WebAudio: decoded buffers -> source -> voice gain -> master -> destination. */
class WebEngine implements Engine {
  private ctx: ContextLike | null = null;
  private master: GainNodeLike | null = null;
  private masterValue = 1;
  private readonly buffers = new Map<string, unknown>();
  private readonly loading = new Map<string, Promise<boolean>>();
  private readonly voices = new Map<string, { src: SourceLike; gain: GainNodeLike }>();
  private suspended = false;
  constructor(
    private readonly deps: AudioDeps,
    private readonly ext: Ext,
    private readonly onFallback: () => void,
  ) {}

  init() {
    if (this.ctx) return;
    const ctx = this.deps.createContext!();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.masterValue;
    this.master.connect(ctx.destination);
    this.wake();
    ctx.onstatechange = () => {
      // iOS "interrupted" (phone call, Siri): try to come back; if it refuses, the next tap's nudge() does it.
      if (ctx.state === "interrupted" && !this.suspended) void ctx.resume().catch(() => {});
    };
  }
  /** Resume inside the gesture and play one silent sample (what iOS counts as unlocking). */
  private wake() {
    const ctx = this.ctx;
    if (!ctx) return;
    void ctx.resume().catch(() => {});
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  }
  nudge() {
    if (this.ctx && !this.suspended && this.ctx.state !== "running") this.wake();
  }
  reload() {
    this.buffers.clear();
    this.loading.clear();
  }
  isReady(file: string) {
    return this.buffers.has(file);
  }
  load(file: string): Promise<boolean> {
    if (this.buffers.has(file)) return Promise.resolve(true);
    const pending = this.loading.get(file);
    if (pending) return pending;
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(false);
    const get = this.deps.fetchBytes ?? (async (url: string) => (await fetch(url)).arrayBuffer());
    const attempt = async (): Promise<boolean> => {
      const ext = this.ext();
      try {
        const bytes = await get(`/assets/audio/${file}.${ext}`);
        this.buffers.set(file, await ctx.decodeAudioData(bytes));
        return true;
      } catch {
        if (ext === "ogg") {
          this.onFallback(); // any decode error on ogg: use mp3 from now on
          return attempt();
        }
        return false;
      }
    };
    const p = attempt().finally(() => this.loading.delete(file));
    this.loading.set(file, p);
    return p;
  }
  start(v: VoiceSpec) {
    const ctx = this.ctx;
    const buf = this.buffers.get(v.file);
    if (!ctx || !this.master || !buf) return false;
    this.stop(v.id, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = v.loop;
    const g = ctx.createGain();
    g.gain.value = v.fadeMs ? 0 : v.gain;
    src.connect(g);
    g.connect(this.master);
    const voice = { src, gain: g };
    this.voices.set(v.id, voice);
    src.onended = () => {
      if (this.voices.get(v.id) === voice) this.voices.delete(v.id);
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    };
    try {
      src.start(0);
    } catch {
      this.voices.delete(v.id);
      return false;
    }
    if (v.fadeMs) this.setGain(v.id, v.gain, v.fadeMs);
    return true;
  }
  setGain(id: string, gain: number, ms: number) {
    const v = this.voices.get(id);
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime;
    const p = v.gain.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    if (ms) p.linearRampToValueAtTime(gain, t + ms / 1000);
    else p.setValueAtTime(gain, t);
  }
  stop(id: string, ms: number) {
    const v = this.voices.get(id);
    if (!v || !this.ctx) return;
    if (!ms) {
      this.voices.delete(id);
      try {
        v.src.stop(0);
        v.src.disconnect();
      } catch {
        /* already stopped */
      }
      return;
    }
    this.setGain(id, 0, ms);
    try {
      v.src.stop(this.ctx.currentTime + ms / 1000 + 0.05);
    } catch {
      /* ignore */
    }
  }
  isActive(id: string) {
    return this.voices.has(id);
  }
  setMaster(m: number) {
    this.masterValue = m;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setValueAtTime(m, this.ctx.currentTime);
    }
  }
  suspend() {
    this.suspended = true;
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend().catch(() => {});
  }
  resume() {
    this.suspended = false;
    if (this.ctx && this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
  }
}

export class AudioManager {
  private unlocked = false;
  private muted: boolean;
  private hidden = false;
  private reduced = false;
  private master = 1;
  private readonly engine: Engine;
  private readonly lastPlayed = new Map<AudioCue, number>();
  private readonly lastFile = new Map<AudioCue, string>();
  private readonly listeners = new Set<() => void>();
  private ext: "ogg" | "mp3" | null = null;
  private bed: BedName | null = null;
  private bedVoice: BedName | null = null;
  private heart: HeartbeatLevel = 0;
  private heartVoice: HeartbeatLevel = 0;
  private heartHushed = false;
  private duckUntil = 0;
  private duckTimer: unknown = null;
  private duckFactor = 1;
  private restStarted = false;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly deps: AudioDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    let stored: string | null = null;
    try {
      stored = deps.storage?.getItem(MUTE_KEY) ?? null;
    } catch {
      /* storage blocked */
    }
    this.muted = stored === "1";
    const ext: Ext = () => this.extension();
    this.engine = deps.createContext
      ? new WebEngine(deps, ext, () => {
          this.ext = "mp3";
        })
      : new HtmlEngine(deps, ext, this.now);
    this.engine.setMaster(this.muted ? 0 : this.master);
    deps.onHidden?.((h) => this.setHidden(h));
  }

  isUnlocked() {
    return this.unlocked;
  }
  isMuted() {
    return this.muted;
  }
  getVolume() {
    return this.master;
  }
  isReducedMotion() {
    return this.reduced;
  }
  /** Which file format this browser will get (exposed for tests and diagnostics). */
  format() {
    return this.extension();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  private emit() {
    for (const fn of this.listeners) fn();
  }

  private extension(): "ogg" | "mp3" {
    if (!this.ext) {
      const probe = this.deps.createAudio();
      const ok = probe.canPlayType('audio/ogg; codecs="vorbis"') === "probably";
      this.ext = ok && !oggIsRisky(this.deps.userAgent ?? "") ? "ogg" : "mp3";
    }
    return this.ext;
  }

  private get silenced() {
    return this.muted || this.hidden;
  }

  /** Call from a user gesture. Idempotent; later gestures just nudge a suspended context awake. */
  unlock() {
    if (this.unlocked) {
      if (!this.silenced) this.engine.nudge();
      return;
    }
    this.unlocked = true;
    this.engine.init();
    this.engine.setMaster(this.muted ? 0 : this.master);
    if (this.muted) this.engine.suspend();
    void this.preload(CORE_FILES).then(() => {
      this.syncBed();
      this.syncHeart();
      this.preloadRest();
    });
    this.syncBed();
    this.syncHeart();
    this.emit();
  }

  /** Decode these files now (no-op for ones already loaded). */
  preload(files: readonly string[]): Promise<void> {
    if (!this.unlocked) return Promise.resolve();
    return Promise.all(files.map((f) => this.engine.load(f))).then(() => undefined);
  }
  /** Load the per-screen groups one after the other (called once, after the core is in). */
  private preloadRest() {
    if (this.restStarted) return;
    this.restStarted = true;
    const groups = Object.values(REST_GROUPS);
    const next = () => {
      const g = groups.shift();
      if (g) void this.preload(g).then(next);
    };
    next();
  }
  /** Load one named group (e.g. "ending" when /accuse opens) ahead of the background trickle. */
  preloadGroup(name: keyof typeof REST_GROUPS) {
    return this.preload(REST_GROUPS[name]);
  }

  setVolume(v: number) {
    this.master = Math.min(1, Math.max(0, v));
    this.engine.setMaster(this.muted ? 0 : this.master);
    this.emit();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      this.deps.storage?.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* storage blocked */
    }
    this.engine.setMaster(m ? 0 : this.master);
    this.applySilence();
    this.emit();
  }

  toggleMuted() {
    this.setMuted(!this.muted);
  }

  /** Tab hidden / page hiding: suspend; coming back resumes unless muted. */
  setHidden(h: boolean) {
    if (this.hidden === h) return;
    this.hidden = h;
    this.applySilence();
  }

  private applySilence() {
    if (!this.unlocked) return;
    if (this.silenced) {
      this.engine.suspend();
      this.stopBedVoice(0);
      this.stopHeartVoice(0);
    } else {
      this.engine.resume();
      this.syncBed();
      this.syncHeart();
    }
  }

  /** Prefers-reduced-motion: calmer thunder, loud stings x0.6. */
  setReducedMotion(r: boolean) {
    this.reduced = r;
  }

  // ----- one-shots -----

  /** Play a one-shot cue. Returns true if a sound actually started (or is queued behind its decode). */
  play(cue: AudioCue, opts: { gain?: number } = {}): boolean {
    const def = CUES[cue];
    if (!def || def.loop || !this.unlocked || this.silenced) return false;
    const t = this.now();
    const last = this.lastPlayed.get(cue);
    if (last !== undefined && t - last < def.minGapMs) return false;
    this.lastPlayed.set(cue, t);

    let gain = opts.gain ?? 1;
    let file = this.pickFile(cue, def);
    if (this.reduced) {
      if (cue === "thunder") {
        file = "thunder_2"; // the distant roll only, never the close crack
        gain = 0.35;
      }
      if (LOUD.has(cue)) gain *= 0.6;
    }
    // One instance per cue: stop any variant of this cue still ringing.
    for (const f of def.files) if (f !== file) this.engine.stop(`cue:${f}`, 0);
    const spec: VoiceSpec = { id: `cue:${file}`, file, gain: Math.min(1, Math.max(0, def.volume * gain)), loop: false, fadeMs: 0 };
    if (!this.engine.start(spec)) {
      // Not decoded yet: fetch it and play a hair late rather than dropping the cue.
      if (!this.engine.isReady(file)) {
        void this.engine.load(file).then((ok) => {
          if (ok && !this.silenced && this.now() - t < LATE_PLAY_MS) {
            this.engine.start(spec);
            this.afterStart(cue, def);
          }
        });
        return true;
      }
      return false;
    }
    this.afterStart(cue, def);
    return true;
  }

  private afterStart(cue: AudioCue, def: CueDef) {
    if (def.duckMs) this.duck(def.duckMs + DUCK_TAIL_MS);
    if (cue === "breakdown_crack") {
      this.heartHushed = true; // the breakdown stops the heartbeat until the player leaves the screen
      this.syncHeart();
    }
  }

  private pickFile(cue: AudioCue, def: CueDef): string {
    if (def.files.length === 1) return def.files[0];
    const prev = this.lastFile.get(cue);
    let file: string;
    if (cue === "thunder") {
      // Alternate the close crack and the distant roll (README).
      file = def.files.find((f) => f !== prev) ?? def.files[0];
    } else {
      const options = def.files.filter((f) => f !== prev);
      file = options[Math.floor(this.random() * options.length) % options.length];
    }
    this.lastFile.set(cue, file);
    return file;
  }

  // ----- beds -----

  /** Scene bed: one at a time, ~1.1 s crossfade. null fades the bed out. */
  setBed(name: BedName | null, opts: { fadeMs?: number } = {}) {
    this.bed = name;
    this.bedFadeMs = opts.fadeMs ?? BED_FADE_MS;
    this.syncBed();
  }
  private bedFadeMs = BED_FADE_MS;
  getBed() {
    return this.bed;
  }

  private bedGain(name: BedName) {
    return CUES[name].volume * this.duckFactor;
  }

  private stopBedVoice(ms: number) {
    if (this.bedVoice) this.engine.stop(`bed:${this.bedVoice}`, ms);
    this.bedVoice = null;
  }

  private syncBed() {
    if (!this.unlocked || this.silenced) return;
    const want = this.bed;
    if (this.bedVoice === want) {
      if (want && !this.engine.isActive(`bed:${want}`)) this.bedVoice = null; // context was restarted
      else return;
    }
    if (this.bedVoice && this.bedVoice !== want) this.stopBedVoice(this.bedFadeMs);
    if (!want) return;
    const file = CUES[want].files[0];
    const spec: VoiceSpec = { id: `bed:${want}`, file, gain: this.bedGain(want), loop: true, fadeMs: this.bedFadeMs };
    if (this.engine.start(spec)) {
      this.bedVoice = want;
    } else if (!this.engine.isReady(file)) {
      void this.engine.load(file).then(() => this.syncBed());
    }
  }

  /** Back-compat: the original single rain bed. */
  startAmbient() {
    this.setBed("rain_loop");
  }
  stopAmbient() {
    this.setBed(null);
  }

  // ----- heartbeat -----

  /** Stress heartbeat: 0 off, 1 slow, 2 mid, 3 fast. Switches only on a band change. */
  setHeartbeat(level: HeartbeatLevel) {
    if (level === 0) this.heartHushed = false;
    this.heart = level;
    this.syncHeart();
  }
  getHeartbeat() {
    return this.heart;
  }

  private stopHeartVoice(ms: number) {
    const name = HEARTBEATS[this.heartVoice];
    if (name) this.engine.stop(`hb:${name}`, ms);
    this.heartVoice = 0;
  }

  private syncHeart() {
    const want: HeartbeatLevel = this.heartHushed ? 0 : this.heart;
    if (this.unlocked && !this.silenced) {
      if (this.heartVoice !== want) {
        this.stopHeartVoice(HEART_FADE_MS);
        const name = HEARTBEATS[want];
        if (name) {
          const spec: VoiceSpec = { id: `hb:${name}`, file: name, gain: CUES[name].volume, loop: true, fadeMs: HEART_FADE_MS };
          if (this.engine.start(spec)) this.heartVoice = want;
          else if (!this.engine.isReady(name)) void this.engine.load(name).then(() => this.syncHeart());
        }
      }
    }
    this.applyDuck();
  }

  // ----- ducking -----

  /** Duck the bed for `ms` (a long sting). Attack 150 ms, release 600 ms. */
  duck(ms: number) {
    this.duckUntil = Math.max(this.duckUntil, this.now() + ms);
    this.applyDuck();
    if (this.duckTimer !== null) (this.deps.clearTimeout ?? clearTimeout)(this.duckTimer as ReturnType<typeof setTimeout>);
    this.duckTimer = (this.deps.setTimeout ?? setTimeout)(() => {
      this.duckTimer = null;
      this.applyDuck();
    }, Math.max(0, this.duckUntil - this.now()) + 20);
  }
  unduck() {
    this.duckUntil = 0;
    this.applyDuck();
  }
  private applyDuck() {
    const sting = this.now() < this.duckUntil;
    const heart = this.heartVoice !== 0;
    const f = Math.min(sting ? DUCK_STING : 1, heart ? DUCK_HEART : 1);
    if (f === this.duckFactor) return;
    const releasing = f > this.duckFactor;
    this.duckFactor = f;
    if (this.bedVoice) this.engine.setGain(`bed:${this.bedVoice}`, this.bedGain(this.bedVoice), releasing ? DUCK_RELEASE_MS : DUCK_ATTACK_MS);
  }
  /** Current bed multiplier (1 = not ducked). */
  getDuck() {
    return this.duckFactor;
  }
}

let singleton: AudioManager | null = null;

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const silent = (): AudioLike => ({
  src: "", volume: 1, loop: false, preload: "", currentTime: 0, paused: true,
  play() {}, pause() {}, load() {}, canPlayType: () => "",
});

type CtxCtor = new () => ContextLike;

/** The app-wide manager (a silent, never-unlocked stub during SSR). */
export function getAudio(): AudioManager {
  if (typeof window === "undefined" || typeof Audio === "undefined") return new AudioManager({ createAudio: silent });
  if (!singleton) {
    const w = window as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    singleton = new AudioManager({
      createAudio: () => new Audio() as unknown as AudioLike,
      createContext: Ctor ? () => new Ctor() : undefined,
      storage: safeStorage(),
      userAgent: navigator.userAgent,
      onHidden: (fn) => {
        document.addEventListener("visibilitychange", () => fn(document.visibilityState === "hidden"));
        window.addEventListener("pagehide", () => fn(true));
        window.addEventListener("pageshow", () => fn(document.visibilityState === "hidden"));
      },
    });
  }
  return singleton;
}
