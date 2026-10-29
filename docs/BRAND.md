# Brand assets

How the identity pack is used, so the next person changing a logo or a weight
does not have to reverse-engineer it.

## Where the files are

| Asset | Location | Used by |
| --- | --- | --- |
| Tajarib (Light / Regular / Medium / Bold, OTF) | `ui/public/fonts/` | `@font-face` in `ui/src/styles/index.css`, `--font-sans` |
| App icon, small and large (PNG) | `ui/public/brand/icon-64.png`, `icon-256.png` | Top bar, About dialog, onboarding, favicon |
| Packaging icons | `src-tauri/icons/` (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`, `icon.icns`) | Tauri bundles, window icon, tray |

The source pack lives in `OraxDesk_Brand_Concept_Pack/`. Its README says the
logo files are preview crops rather than vector originals, so the app itself
does **not** use the horizontal logo image: the wordmark is set as text in
Tajarib (`ui/src/components/Wordmark.tsx`), with the brand blue and red from
the pack and the red X the logotype carries. A future vector original can
replace that component without touching any other screen.

## Type

Four real weights, no synthesis. A faux bold on Arabic breaks the joins
between letters, which is the one thing a typeface for this script must not
do. `--font-sans` starts with `"Tajarib"` and keeps the system stack behind
it, so a glyph the font does not carry (the pack's OTFs cover basic Latin and
Arabic, not arrows or extended punctuation) falls back per glyph instead of
showing a box.

The mono stack is deliberately unchanged: addresses, fingerprints and the
device number need tabular figures, and Tajarib is a text face.

## Colour

The interface keeps its own semantic accent (`--accent`) rather than painting
everything in `#0052FF`: a UI tinted one saturated colour stops reading as a
brand and starts reading as a theme. The pack's blue and red are used where the
brand mark is (`--brand-blue`, `--brand-red`, with a lighter pair in dark
mode), and the palette is recorded here so a redesign starts from the same
values:

- Blue `#0052FF`
- Red `#FF1F2D`
- Navy `#0A1E3C`

## Regenerating the packaging icons

The pack ships `.png` at every size and `.ico`. `icon.icns` is assembled from
the Light PNGs (`icp4`/`icp5`/`icp6`/`ic07`–`ic10`), with the 512 tile
resampled once to 1024 for the Retina size:

```sh
# 1. replace the PNGs/ICO in src-tauri/icons from the pack (Light variant)
# 2. resample the 512 tile to 1024 with any image tool, then:
python scripts/make_icns.py \
    --pack OraxDesk_Brand_Concept_Pack \
    --big  /tmp/icon-1024.png \
    --out  src-tauri/icons/icon.icns
```

`tauri icon` does the same job when the Tauri CLI is installed; it is not a
dependency of this repository, which is why the small script exists.

The six files named in `tauri.conf.json` are the whole contract. Adding a size
to the pack is not the same as adding it to the bundle: check that list.
