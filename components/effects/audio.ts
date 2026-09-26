/**
 * Tiny audio manager for the SFX kit in assets/audio (see its README).
 *
 * - Silent until unlock(): browsers block audio before a user gesture, so the
 *   START CASE click (or any first pointer/key press) unlocks it.
 * - Preloads every cue on unlock (.ogg when supported, else .mp3).
 * - One element per file, one sound per cue at a time, and a per-cue minimum
 *   gap, so rapid replies or clicks never stack into spam.
 * - Master volume and a mute flag persisted in localStorage.
 * - One ambient bed (rain_loop) with ~1 s fades.
 */
import type { AudioCue } from "./emotion-map";

export interface CueDef {
  /** File stems in /assets/audio (variants are picked at random / alternated). */
  files: readonly string[];
  volume: number;
  /** Ignore repeats of this cue within this many ms. */
  minGapMs: number;
  loop?: boolean;
}

export const CUES: Record<AudioCue, CueDef> = {
  dialogue_pop: { files: ["dialogue_pop_1", "dialogue_pop_2", "dialogue_pop_3"], volume: 0.5, minGapMs: 120 },
  ui_click: { files: ["dialogue_pop_2"], volume: 0.3, minGapMs: 90 },
  door_slam: { files: ["door_slam"], volume: 0.6, minGapMs: 600 },
  slide_whistle_down: { files: ["slide_whistle_down"], volume: 0.55, minGapMs: 600 },
  slide_whistle_up: { files: ["slide_whistle_up"], volume: 0.5, minGapMs: 600 },
  boing: { files: ["boing"], volume: 0.65, minGapMs: 500 },
  wah_wah: { files: ["wah_wah"], volume: 0.55, minGapMs: 2000 },
  surprise_sting: { files: ["surprise_sting"], volume: 0.55, minGapMs: 1500 },
  impact: { files: ["impact"], volume: 0.65, minGapMs: 400 },
  clue_ding: { files: ["clue_ding"], volume: 0.65, minGapMs: 800 },
  fanfare: { files: ["fanfare"], volume: 0.55, minGapMs: 2500 },
  siren: { files: ["siren"], volume: 0.45, minGapMs: 3000 },
  thunder: { files: ["thunder_1", "thunder_2"], volume: 0.5, minGapMs: 2500 },
  footsteps_sneak: { files: ["footsteps_sneak"], volume: 0.55, minGapMs: 1500 },
  rain_loop: { files: ["rain_loop"], volume: 0.22, minGapMs: 0, loop: true },
};

export const MUTE_KEY = "whodunit:muted";
const FADE_MS = 1000;

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

export interface AudioDeps {
  createAudio: () => AudioLike;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
  random?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

export class AudioManager {
  private unlocked = false;
  private muted: boolean;
  private master = 1;
  private readonly elements = new Map<string, AudioLike>();
  private readonly lastPlayed = new Map<AudioCue, number>();
  private readonly lastFile = new Map<AudioCue, string>();
  private readonly listeners = new Set<() => void>();
  private ext: "ogg" | "mp3" | null = null;
  private wantAmbient = false;
  private fade: unknown = null;
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
      this.ext = probe.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
    }
    return this.ext;
  }

  private element(file: string, loop = false): AudioLike {
    let el = this.elements.get(file);
    if (!el) {
      el = this.deps.createAudio();
      el.preload = "auto";
      el.loop = loop;
      el.src = `/assets/audio/${file}.${this.extension()}`;
      this.elements.set(file, el);
    }
    return el;
  }

  /** Call from a user gesture. Idempotent. Preloads every cue. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const seen = new Set<string>();
    for (const def of Object.values(CUES)) {
      for (const f of def.files) {
        if (seen.has(f)) continue;
        seen.add(f);
        this.element(f, def.loop).load();
      }
    }
    if (this.wantAmbient) this.startAmbient();
    this.emit();
  }

  setVolume(v: number) {
    this.master = Math.min(1, Math.max(0, v));
    this.emit();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      this.deps.storage?.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* storage blocked */
    }
    if (m) {
      this.stopFade();
      for (const el of this.elements.values()) el.pause();
    } else if (this.wantAmbient) {
      this.startAmbient();
    }
    this.emit();
  }

  toggleMuted() {
    this.setMuted(!this.muted);
  }

  /** Play a one-shot cue. Returns true if a sound actually started. */
  play(cue: AudioCue, opts: { gain?: number } = {}): boolean {
    const def = CUES[cue];
    if (!def || def.loop || !this.unlocked || this.muted) return false;
    const t = this.now();
    const last = this.lastPlayed.get(cue);
    if (last !== undefined && t - last < def.minGapMs) return false;
    this.lastPlayed.set(cue, t);

    const file = this.pickFile(cue, def);
    // One instance per cue: stop any variant of this cue still ringing.
    for (const f of def.files) if (f !== file) this.elements.get(f)?.pause();
    const el = this.element(file);
    el.volume = Math.min(1, Math.max(0, def.volume * (opts.gain ?? 1) * this.master));
    try {
      el.currentTime = 0;
    } catch {
      /* not seekable yet */
    }
    try {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      return false;
    }
    return true;
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

  private stopFade() {
    if (this.fade !== null) {
      (this.deps.clearInterval ?? clearInterval)(this.fade as ReturnType<typeof setInterval>);
      this.fade = null;
    }
  }

  private fadeTo(el: AudioLike, target: number, then?: () => void) {
    this.stopFade();
    const start = el.volume;
    const t0 = this.now();
    const step = () => {
      const k = Math.min(1, (this.now() - t0) / FADE_MS);
      el.volume = start + (target - start) * k;
      if (k >= 1) {
        this.stopFade();
        then?.();
      }
    };
    this.fade = (this.deps.setInterval ?? setInterval)(step, 50);
  }

  /** Storm ambience bed. Remembers the request until audio is unlocked and unmuted. */
  startAmbient() {
    this.wantAmbient = true;
    if (!this.unlocked || this.muted) return;
    const def = CUES.rain_loop;
    const el = this.element(def.files[0], true);
    if (!el.paused && this.fade === null) return;
    if (el.paused) {
      el.volume = 0;
      try {
        const p = el.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        return;
      }
    }
    this.fadeTo(el, def.volume * this.master);
  }

  stopAmbient() {
    this.wantAmbient = false;
    const el = this.elements.get(CUES.rain_loop.files[0]);
    if (!el || el.paused) return;
    this.fadeTo(el, 0, () => el.pause());
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

/** The app-wide manager (a silent, never-unlocked stub during SSR). */
export function getAudio(): AudioManager {
  if (typeof window === "undefined" || typeof Audio === "undefined") return new AudioManager({ createAudio: silent });
  singleton ??= new AudioManager({ createAudio: () => new Audio() as unknown as AudioLike, storage: safeStorage() });
  return singleton;
}
