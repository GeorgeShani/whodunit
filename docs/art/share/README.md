# Share image and favicon set

| Shipped file | Size | Notes |
|---|---|---|
| `app/opengraph-image.jpg` (+ `.alt.txt`) | 1200×630 JPEG q90, ~188 KB | Title plus the four suspects at their relative scales (Victoria 0.92, Archibald 0.78, Gregory 0.62 × Reginald). Left pair is mirrored so the group faces inward. The backdrop is the library lightning frame, darkened and blurred with a plum vignette. All key content sits inside a 60 px safe margin; only shoes and floor fall outside it. |
| `app/twitter-image.jpg` (+ `.alt.txt`) | 1200×600 JPEG q90, ~177 KB | Re-composed for 2:1, not cropped. |
| `app/favicon.ico` | 16/32/48 | 16 px is hand-tuned (pixel-placed 2 px "?", `favicon-16-handtuned.png`). 32 px uses a simplified, fatter geometry. 48 px uses the full art. |
| `app/icon.png` | 512 | Full art, rounded plum tile, transparent corners. |
| `app/apple-icon.png` | 180 | Full art, opaque square plum tile (iOS rounds it). |
| `assets/icons/icon-192.png`, `assets/icons/icon-maskable-512.png` | 192, 512 | Web-manifest icons only (`app/manifest.ts`), served at `/assets/icons/...` by `sync:assets`. The maskable one shrinks the art to 74% on a full-bleed plum square so it survives the circular mask. |
| `icon-source.svg` | 64-unit viewBox | Master vector. Deliberately **not** shipped as `app/icon.svg`: browsers prefer an SVG icon over the ICO, and at 16 px the auto-rasterised SVG is muddier than the hand-tuned bitmap. |

`preview_sheet.jpg` shows the full-size cards, 300 px and 150 px thumbnails, and the favicons on light and dark tabs.

Generators (not shipped) live in `toon-drafts/og/`: `make_og.py` + `final_og.py` (share images), `make_icons.py` + `icon16.py` + `final_icons.py` (icons), `preview.py`. Font: Bangers, SIL OFL 1.1; see `assets/fonts/LICENSES.md`.
