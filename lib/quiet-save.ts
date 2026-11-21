/**
 * Quiet flush of the latest in-hand token when the tab is hidden or closing.
 * Listens for `visibilitychange` (hidden) and `pagehide` only — never a
 * beforeunload prompt. sendBeacon first, then fetch({ keepalive: true }).
 * Same-tab only: no UI, no errors shown. Offline-lineage tokens are not sent
 * (the server would refuse them anyway). Deduped on saveVersion.
 */
export const QUIET_SAVE_PATH = "/api/save";
/** Same cap as STATE_LIMITS.tokenChars / SAVE_TOKEN_MAX_CHARS. */
export const QUIET_SAVE_MAX_CHARS = 60_000;

export interface QuietSaveNote {
  caseId: string;
  gameId?: string;
  token: string;
  saveVersion?: number;
  offline?: boolean;
}

export interface QuietSaveTransport {
  sendBeacon?: (url: string, data: BodyInit) => boolean;
  fetch?: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status">>;
}

export interface QuietSave {
  note(input: QuietSaveNote): void;
  /** visibilitychange (hidden) or pagehide. Safe to call twice; deduped on version. */
  flush(): void;
  clear(): void;
  /** Test hook. */
  snapshot(): { version?: number; flushed?: number; token?: string; offline?: boolean };
}

export function createQuietSave(opts?: { path?: string; transport?: QuietSaveTransport }): QuietSave {
  const path = opts?.path ?? QUIET_SAVE_PATH;
  let current: QuietSaveNote | null = null;
  let flushed: number | undefined;

  const transport = (): QuietSaveTransport =>
    opts?.transport ?? {
      sendBeacon: typeof navigator !== "undefined" ? navigator.sendBeacon.bind(navigator) : undefined,
      fetch: typeof fetch === "function" ? fetch : undefined,
    };

  return {
    note(input) {
      current = input;
    },
    clear() {
      current = null;
      flushed = undefined;
    },
    snapshot() {
      return { version: current?.saveVersion, flushed, token: current?.token, offline: current?.offline };
    },
    flush() {
      const held = current;
      if (!held?.token || held.offline) return;
      if (held.token.length > QUIET_SAVE_MAX_CHARS) return;
      if (held.saveVersion === undefined || held.saveVersion === flushed) return;

      const body = JSON.stringify({
        caseId: held.caseId,
        ...(held.gameId ? { gameId: held.gameId } : {}),
        stateToken: held.token,
      });
      const t = transport();
      const queued = (() => {
        try {
          if (!t.sendBeacon) return false;
          return t.sendBeacon(path, new Blob([body], { type: "application/json" }));
        } catch {
          return false;
        }
      })();
      if (queued) {
        flushed = held.saveVersion;
        return;
      }
      if (!t.fetch) return;
      const version = held.saveVersion;
      try {
        void t
          .fetch(path, {
            method: "POST",
            body,
            headers: { "content-type": "application/json" },
            keepalive: true,
            credentials: "same-origin",
          })
          .then((res) => {
            if (res.ok) flushed = version;
          })
          .catch(() => {
            /* silent: a 429 or a dropped keepalive must not surface */
          });
      } catch {
        /* silent */
      }
    },
  };
}

/** Bind hide/close listeners. Does not register beforeunload. Returns an unbind function. */
type ListenerHost = {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
};

export function bindQuietSave(
  save: QuietSave,
  targets: { document?: ListenerHost & { visibilityState?: string }; window?: ListenerHost } = {},
): () => void {
  const doc = targets.document ?? (typeof document !== "undefined" ? document : undefined);
  const win = targets.window ?? (typeof window !== "undefined" ? window : undefined);
  const onVisibility = () => {
    if (doc?.visibilityState === "hidden") save.flush();
  };
  const onPageHide = () => save.flush();
  doc?.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("pagehide", onPageHide);
  return () => {
    doc?.removeEventListener("visibilitychange", onVisibility);
    win?.removeEventListener("pagehide", onPageHide);
  };
}
