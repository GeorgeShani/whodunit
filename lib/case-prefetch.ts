/**
 * Case-aware background prefetch for the active case's public assets.
 *
 * Built only from the public case view (never solution.json or endings). Paths
 * are taken from case data, so a renamed case folder still resolves correctly.
 *
 * Order: suspect portraits (neutral first, then other poses), location art,
 * then audio. Ending / accusation assets are never queued.
 */
import { REST_GROUPS } from "@/components/effects/audio";
import { portraitSrc } from "@/components/effects/emotion-map";
import type { PublicCaseView, PublicSuspect } from "@/engine/public-view";

/** In-flight downloads at once (keep this low so the intro stays responsive). */
export const PREFETCH_CONCURRENCY = 3;

/** Screens whose beds are safe to warm before the player reaches them. */
const PLAY_SCREENS = ["title", "intro", "suspects", "investigate", "interrogation", "confront"] as const;

/** Default beds used when a case writes no `audio.beds` (see audio-scenes.ts). */
const DEFAULT_PLAY_BEDS = ["bed_manor", "bed_library"] as const;

/** Stems reserved for the accusation and ending (REST_GROUPS.ending). */
export const ENDING_AUDIO_STEMS: ReadonlySet<string> = new Set(REST_GROUPS.ending);

export type PrefetchKind = "portrait-neutral" | "portrait-pose" | "location" | "audio";

export interface PrefetchItem {
  kind: PrefetchKind;
  url: string;
}

export interface ConnectionInfo {
  saveData?: boolean;
  effectiveType?: string;
}

export interface PrefetchListOptions {
  /** Skip audio and non-neutral poses (save-data or 2g / slow-2g / 3g). */
  light?: boolean;
  /** Audio file extension to request (the runner picks the one this browser can play). */
  audioExt?: "ogg" | "mp3";
}

export function isConstrainedConnection(conn?: ConnectionInfo | null): boolean {
  if (!conn) return false;
  if (conn.saveData) return true;
  const t = (conn.effectiveType ?? "").toLowerCase();
  return t === "2g" || t === "slow-2g" || t === "3g";
}

export function readConnection(): ConnectionInfo | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    connection?: ConnectionInfo;
    mozConnection?: ConnectionInfo;
    webkitConnection?: ConnectionInfo;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

export function preferredAudioExt(): "ogg" | "mp3" {
  if (typeof Audio === "undefined") return "ogg";
  try {
    return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
  } catch {
    return "ogg";
  }
}

/** True when `url` lives under another case's `/assets/cases/<id>/` folder. */
export function isForeignCasePath(url: string, caseId: string): boolean {
  const m = url.match(/^\/assets\/cases\/([^/]+)\//);
  return Boolean(m && m[1] !== caseId);
}

function uniquePush(out: PrefetchItem[], seen: Set<string>, kind: PrefetchKind, url: string | undefined): void {
  if (!url || seen.has(url)) return;
  seen.add(url);
  out.push({ kind, url });
}

function caseAudioDir(caseId: string): string {
  return `/assets/cases/${caseId}/audio`;
}

export function audioUrlFor(view: Pick<PublicCaseView, "meta" | "audioFiles">, stem: string, ext: "ogg" | "mp3"): string {
  return (view.audioFiles ?? []).includes(stem) ? `${caseAudioDir(view.meta.id)}/${stem}.${ext}` : `/assets/audio/${stem}.${ext}`;
}

function audioStems(view: PublicCaseView): string[] {
  const stems: string[] = [];
  const seen = new Set<string>();
  const add = (stem: string | undefined) => {
    if (!stem || ENDING_AUDIO_STEMS.has(stem) || seen.has(stem)) return;
    seen.add(stem);
    stems.push(stem);
  };
  const beds = view.audio?.beds;
  if (beds) {
    for (const screen of PLAY_SCREENS) add(beds[screen]);
  } else {
    for (const stem of DEFAULT_PLAY_BEDS) add(stem);
  }
  for (const stem of Object.values(view.audio?.rooms ?? {})) add(stem);
  for (const [cue, files] of Object.entries(view.audio?.cues ?? {})) {
    if (ENDING_AUDIO_STEMS.has(cue)) continue;
    for (const stem of files) add(stem);
  }
  return stems;
}

function locationUrls(view: PublicCaseView): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (u?: string) => {
    if (!u || seen.has(u) || isForeignCasePath(u, view.meta.id)) return;
    seen.add(u);
    urls.push(u);
  };
  for (const l of view.locations) add(l.background);
  add(view.backdrops.suspects);
  add(view.backdrops.investigate);
  add(view.backdrops.interrogation);
  if (view.stage) {
    add(view.stage.background);
    add(view.stage.lightning);
    add(view.stage.windowMask);
    add(view.stage.rainTile);
  }
  return urls;
}

function firstPortraitPose(s: PublicSuspect): string | undefined {
  return s.poses.includes("neutral") ? "neutral" : s.poses[0];
}

/** Ordered prefetch queue for one public case view. */
export function casePrefetchList(view: PublicCaseView, options: PrefetchListOptions = {}): PrefetchItem[] {
  const light = options.light ?? false;
  const audioExt = options.audioExt ?? "ogg";
  const caseId = view.meta.id;
  const out: PrefetchItem[] = [];
  const seen = new Set<string>();

  for (const s of view.suspects) {
    const pose = firstPortraitPose(s);
    if (pose) uniquePush(out, seen, "portrait-neutral", portraitSrc(s, pose));
  }

  if (!light) {
    for (const s of view.suspects) {
      for (const pose of s.poses) {
        if (pose === "neutral") continue;
        uniquePush(out, seen, "portrait-pose", portraitSrc(s, pose));
      }
    }
  }

  for (const url of locationUrls(view)) uniquePush(out, seen, "location", url);

  if (!light) {
    for (const stem of audioStems(view)) uniquePush(out, seen, "audio", audioUrlFor(view, stem, audioExt));
  }

  return out.filter((item) => !isForeignCasePath(item.url, caseId));
}

function scheduleIdle(signal: AbortSignal | undefined, timeout = 200): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      if (typeof cancelIdleCallback === "function" && idleId !== undefined) cancelIdleCallback(idleId);
      if (timer !== undefined) clearTimeout(timer);
      done();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback(() => done(), { timeout });
    } else {
      timer = setTimeout(done, 0);
    }
  });
}

async function loadImage(url: string, signal?: AbortSignal): Promise<void> {
  if (typeof Image === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  await new Promise<void>((resolve) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      img.src = "";
      finish();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    img.onload = () => {
      void img.decode().then(finish, finish);
    };
    img.onerror = () => finish();
    if (signal?.aborted) {
      finish();
      return;
    }
    img.src = url;
  });
}

async function loadAudio(url: string, signal?: AbortSignal): Promise<void> {
  if (typeof fetch !== "function") return;
  try {
    await fetch(url, { signal, credentials: "same-origin", cache: "force-cache" });
  } catch {
    /* aborted or network: the queue moves on */
  }
}

export async function loadPrefetchItem(item: PrefetchItem, signal?: AbortSignal): Promise<void> {
  if (item.kind === "audio") return loadAudio(item.url, signal);
  return loadImage(item.url, signal);
}

/**
 * Drain a prefetch queue, a few items at a time, yielding to idle between
 * items so rendering is not blocked. Returns a cancel function.
 */
export function startCasePrefetch(
  items: readonly PrefetchItem[],
  options: { concurrency?: number; signal?: AbortSignal; load?: (item: PrefetchItem, signal?: AbortSignal) => Promise<void> } = {},
): () => void {
  const ac = new AbortController();
  const onParentAbort = () => ac.abort();
  options.signal?.addEventListener("abort", onParentAbort, { once: true });
  const signal = ac.signal;
  const concurrency = Math.max(1, options.concurrency ?? PREFETCH_CONCURRENCY);
  const load = options.load ?? loadPrefetchItem;

  void (async () => {
    let i = 0;
    const worker = async () => {
      let started = false;
      while (!signal.aborted) {
        const item = items[i++];
        if (!item) return;
        if (started) await scheduleIdle(signal);
        started = true;
        if (signal.aborted) return;
        try {
          await load(item, signal);
        } catch {
          /* ignore */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 0)) }, () => worker()));
  })();

  return () => {
    options.signal?.removeEventListener("abort", onParentAbort);
    ac.abort();
  };
}
