/**
 * "Seen the How to Play prompt" flag in localStorage. Safe under SSR (no window) and when storage is blocked
 * (Safari private mode, disabled cookies, quota): reads then say "seen" (never nag on every visit when we cannot
 * remember), writes are silently dropped. Never throws.
 */
export const HOW_TO_PLAY_SEEN_KEY = "whodunit:how-to-play-seen:v1";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** True when the first-time prompt should be shown (storage works and the flag is not set). */
export function shouldShowFirstTimePrompt(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    return s.getItem(HOW_TO_PLAY_SEEN_KEY) === null;
  } catch {
    return false;
  }
}

export function markFirstTimePromptSeen(): void {
  try {
    storage()?.setItem(HOW_TO_PLAY_SEEN_KEY, "1");
  } catch {
    /* blocked storage: nothing to remember with */
  }
}
