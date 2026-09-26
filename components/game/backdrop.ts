import type { CSSProperties } from "react";

/** Inline style for a case backdrop (asset paths come from validated case data). */
export function backdropStyle(src: string | undefined): CSSProperties | undefined {
  return src ? { backgroundImage: `url(${JSON.stringify(src)})` } : undefined;
}
