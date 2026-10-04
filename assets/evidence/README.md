# Clue illustrations

One picture per clue, named after the clue's id in `cases/<case>/evidence.json`:

- `assets/evidence/<id>.webp` (e.g. `silver-candlestick.webp`), or `assets/evidence/<caseId>/<id>.webp` to scope it to one case.
- WebP, **square 256x256 px**, cartoon object with the game's black outline, transparent or flat warm background, under ~40 KB.
- No code change needed: `next.config.ts` lists this folder at build/start time and `lib/clue-art.ts` picks the files up. Without a file the clue shows its `icon` emoji, then `_fallback.webp` (a neutral magnifier, not claimable by any id).

See "Clue art" in `docs/CASE_FORMAT.md`.
