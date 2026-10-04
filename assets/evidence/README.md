# Evidence icons

One cartoon icon per clue, shown in the notebook, the "CLUE FOUND!" sting, the accuse screen and the ending recap.
Served at `/assets/evidence/<id>.webp` (`scripts/sync-assets.ts` copies all of `assets/` except `*.md`, so no sync change is needed).

## Format

| | |
|---|---|
| Path | `assets/evidence/<evidenceId>.webp` (Blackwood, flat) |
| Canvas | 256 x 256 px, RGBA, transparent background |
| Encoding | lossy WebP, quality 85, alpha quality 90, method 6 (about 5 to 10 KB each) |
| Object fit | single object centered, longest side about 84% of the canvas (about 8% transparent padding), slight comic tilt |
| Display sizes | 64 px in lists / buttons, 96 to 128 px in the clue sting, 128 to 256 px in detail views. Never upscale past 256. |

`<evidenceId>` is exactly the `id` of the entry in `cases/<case>/evidence.json`. The UI should fall back to `_fallback.webp` when `/assets/evidence/<id>.webp` does not exist.

## Files (ordered as in `cases/blackwood/evidence.json`)

| # | id | Item | File | KB |
|---|---|---|---|---|
| 1 | `silver-candlestick` | Silver Candlestick (bent candle, dented base, blood drips) | `silver-candlestick.webp` | 5.2 |
| 2 | `muddy-footprint` | Muddy Footprint (hobnailed boot print + splatters) | `muddy-footprint.webp` | 6.9 |
| 3 | `burned-letter` | Burned Letter (charred, glowing edge, no readable text) | `burned-letter.webp` | 7.1 |
| 4 | `library-key` | The Missing Library Key (ornate sooty brass skeleton key) | `library-key.webp` | 6.2 |
| - | `_fallback` | Neutral icon: magnifying glass over a question-mark tag | `_fallback.webp` | 9.3 |

Preview of all icons on light and dark backgrounds: `docs/art/evidence_contact.jpg`.

## Style conventions

Same house style as the effects overlays (ART_BIBLE section 5):

- Ink outline `#111114`, one consistent heavy weight (about 6.5 px at 256, 1.6 px at 64), round joins.
- Flat fills, exactly one shade tone per material, one tiny white (or pale) highlight stroke. No gradients.
- Warm limited palette: cream `#F8F6F0` / paper `#F3E3B8`, brass `#D4A437` (shade `#A5731C`), silver `#D5D9E4` (shade `#9096AB`), oxblood `#B0243A`, mud `#8A5A32` (shade `#5E3B1E`, highlight `#C79A63`), ember `#FF6B1A` / `#FFD23F`.
- No text, letters or numbers in the image (the "?" is drawn as a shape; "writing" is rounded bars). No background, no baked drop shadow, no ground shadow.
- Must read at 64 px on both a light (paper) and a dark background: chunky silhouette, strong outline.

Style prefix used for every icon (use it verbatim for new art, whether drawn or generated):

```
Original 1940s-style theatrical slapstick cartoon prop illustration, hand-inked ink-and-paint animation cel look, thick bold dark-brown-black ink outline (#111114) of one consistent weight, flat saturated warm colors with a single simple cel-shading tone and one tiny white highlight, limited warm palette of amber, cream, oxblood, umber and brass, high contrast, extremely simple chunky readable silhouette that reads at tiny sizes, slight comic tilt, single object only, centered, entire object visible with empty margin all around it, standing on nothing, isolated on a plain flat solid pure green (#00FF00) background with no shadow, no floor, no gradient, no scenery.
```

followed by `Subject: ...` and the standard negative list from ART_BIBLE section 3 plus "numbers, hands, faces, drop shadows".

## How these were made

Hand-authored SVG (ART_BIBLE section 5 method), rendered with cairosvg at 6x, auto-fitted to 84% of a 256 canvas and saved as lossy WebP. The image API (xAI) was out of credits (HTTP 403) when this set was made, so nothing here is AI-generated. Lossless masters and the SVG sources live outside git in `toon-drafts/evidence/` (`masters/*.png`, `svg/*.svg`; generator `toon-drafts/tools/evidence_svg.py`; the unused API route is `toon-drafts/tools/evidence_gen.py`).

## Adding clue art for another case (e.g. Tallyho)

1. Check the new ids against the existing ones. Evidence ids are only unique per case, so two cases could collide on an id.
2. **Blackwood stays flat** (`assets/evidence/<id>.webp`) so nothing already wired breaks. **New cases should use a case-prefixed folder: `assets/evidence/<caseId>/<id>.webp`** (for Tallyho: `assets/evidence/tallyho/crock-13.webp`). That cannot collide with another case, and the sync script copies subfolders automatically.
3. Suggested lookup: `/assets/evidence/<caseId>/<id>.webp` -> `/assets/evidence/<id>.webp` (flat, Blackwood and shared) -> `/assets/evidence/_fallback.webp`. A shared `_fallback.webp` stays at the top level.
4. Same format and style as above; add the ids to the table here.

Tallyho clue ids planned in `docs/cases/TALLYHO_DESIGN.md` (no art yet): `smashed-watch`, `midnight-notes`, `marmalade-run`, `crock-13`, `route-sheet`, `cheer-cylinder`, `turnip-recipe`, `heel-chart`, `orange-lightning`, `goat-evidence`. None collides with Blackwood's ids. The `_placeholder` case has `placeholder-clue-1`, `placeholder-clue-2`, `placeholder-weapon` and needs no art.
