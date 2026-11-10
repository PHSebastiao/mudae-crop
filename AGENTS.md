# mudae-crop

Local Windows desktop editor (Tauri 2 + React/TypeScript) that crops a Source into a Frame with a chosen proportion and Exports a PNG or GIF. No server, single user. Prerequisites live in `README.md`; domain terms and decisions in `GLOSSARY.md` and `docs/adr/`.

## Checks

```powershell
npm run typecheck                          # both tsconfigs (src + tests, then vite.config.ts)
npm test                                   # Vitest, node env
npm run build                              # typecheck + vite build; does not build Rust
npm run format:check                       # Prettier over the repo; `npm run format` rewrites
cargo check --manifest-path src-tauri/Cargo.toml
```

- One test file / one test: `npx vitest run tests/geometry.test.ts`, `npx vitest run -t "Pad"`.
- `npm test -- -u` rewrites `tests/__snapshots__/render.test.ts.snap`, a pixel hash. Only update it for an intended render change.
- Reuse fixtures from `tests/helpers.ts` (`makeSource`, `makeDoc`, `contextOf`, `pngSize`).
- Vitest runs in `node` with `@napi-rs/canvas`, not jsdom. Tests cover `src/core`; UI is checked in the window.
- There is no CI or ESLint. Prettier is the only formatter: `.prettierrc.json` sets `printWidth` 100, single quotes and per-file line endings; `package-lock.json`, `dist`, `src-tauri/{target,gen}` and the downloaded `src-tauri/waifu2x` binary are ignored. Prettier does not run inside another script, so format before you hand off.
- `npm run tauri dev` needs a Developer PowerShell for VS 2022, or `vcvars64.bat`, so `link.exe` is on `PATH`.
- `npm run dev` is browser-only: OS file drops, the file dialog, clipboard image files and saving require the desktop window.

## Layout

- `src/core/` is platform-free: no React, DOM calls or Tauri imports. Platform work arrives through injected seams (`RenderContext`, `Decoder`, `VideoSource`, `ExportAdapter`, `GifOptimizer`, `DownloadTransport`, `HistoryPreviewAdapter`).
- `src/platform/` holds the Tauri and browser adapters; `src/App.tsx` wires them (and imports the Tauri path helpers directly). `src/hooks/useFrameCrop.ts` owns the Frame/Crop controller: adjust mode, snapping, the resize/zoom/pan commands and proportion persistence.
- `src/core/rect.ts` owns the pure rect math (fit, pad and full-axis base rects, clamping, handle resize, stage layout); `src/core/ratios.ts` owns the proportion presets, labels, 2.5% snapping, the preset lookup and the Carta sizes. `src/components/RatioMenu.tsx` is the top-bar proportion popover.
- `renderFrame()` in `src/core/render.ts` is the only Frame renderer; Preview and Export both call it with explicit `outputWidth`/`outputHeight`, and the dimmed surround reuses `drawSource()`.
- Rust commands live in `src-tauri/src/lib.rs`. A new command must also be added to `generate_handler!`; commands use `rename_all = "snake_case"`, so TS passes `download_id`. New plugins need a permission in `src-tauri/capabilities/default.json`.
- The 30 MB ceiling is Image Chest's per-file limit: `src/core/limits.ts` owns the shared constant, `download.ts` and `imagechest.ts` reuse it, the optimize target cap reuses it, and `lib.rs` enforces the download cap natively. The Export History thumbnail read reuses the same ceiling. Keep them equal.

## Conventions

- UI copy and user-facing errors are pt-BR (`index.html` has `lang="pt-BR"`). Code, comments, identifiers and tests are English.
- Use `GLOSSARY.md` terms (Source, Frame, Proportion, Orientation, Crop, Scale mode, Fit/Pad, Ajustar Frame, Encaixe, Guias, Carta, Nativo, Rotation, Pad color, Border, Palette, Sharpness, Export, Post) and avoid its listed synonyms.
- Geometry is in rotated Source pixels. The Crop is a rect over the rotated Source; `frame.ratio` must equal `rect.width / rect.height`. Route crop changes through the `geometry.ts` helpers, and end any hand-built Crop in `clampCrop`. Zoom and offsets are derived readouts (`zoomOf`, `offsetPct`), not stored. The window can shrink to the Fit rect / 8 and grow to the Fit rect (Fit) or the Pad rect (other modes); a proportion change keeps the current long side and derives the other side from the new proportion around the rect centre.
- `Ajustar Frame` (shortcut C) toggles the eight stage handles. A locked drag keeps the proportion and anchors the opposite side or corner; Shift makes it free, Alt bypasses Encaixe, and the scene re-fits so the whole Frame stays visible. In the adjust phase the Frame canvas is hidden and the Frame is a window cut out of the dimmed backdrop Source; the backdrop redraws the whole Source on each change rather than caching it, and the mask keeps the window itself opaque so its feather only fades the surround. Guias (rule of thirds) draw inside the window, and moving the window snaps its centre to the Source's centre (Alt releases).
- Rotation is a canvas transform at draw time, with bounds swapped for 90°/270° (`rotatedBounds`). Never pre-rotate or resample bitmaps.
- `fit` skips the `padColor` fill so uncovered alpha shows; every other mode paints `padColor` first.
- `verbatimModuleSyntax` is on: type-only imports must use `import type` (and unused locals/params fail typecheck).
- GIF trim/playback/speed/Export, video import, still WebP import and the waifu2x sidecar are in place; frame-rate reduction is still a deliberate placeholder. ADR-0003 is the waifu2x decision.
- waifu2x is opt-in per Source and off by default; `withSource` and `emptyDocument` reset it, and no Resize, preset or Export scale turns it on. It runs at Export (and Upload): the Crop is rendered at `baseOutputSize` without a Border, sent through `runWaifu2x` in `src/core/waifu2x.ts`, decoded, then sharpened and bordered at `outputSize`. A 2×/4× scale defines the final Export size and disables the Carta and custom-size controls (`waifu2xScaleOf`). A cancelled run throws a cancelled `ExportError` and never mutates the document. The Palette runs the sidecar over up to six sampled frames when waifu2x is on (`extractPaletteWithWaifu2x`), so its swatches follow the processed pixels; the Preview still shows the un-processed Crop, and the Export is authoritative there.
- The sidecar is `waifu2x-ncnn-vulkan.exe` plus `models-cunet`, resolved by `src-tauri/src/lib.rs` from `%LOCALAPPDATA%\com.phsebastiao.mudaecrop\waifu2x`, the resource dir, the executable dir, then the repo folder in debug. The resource dir arrives as an extended-length `\\?\` path, so `plain_path` strips it before the model path reaches ncnn.
- `waifu2xArgs` pins `-t 128`: the sidecar's automatic tile size (`-t 0`) leaves fully transparent tiles on the RTX 5060 (a 450×700 2× run loses an 800×600 block; a 225×350 2× run comes back fully transparent). `renderOutputFrame` also rejects a sidecar frame that introduces transparent pixels into an otherwise opaque Crop, so a future tile failure is an error instead of a saved blank card. See `docs/qa/waifu2x.md`. `npm run waifu2x:install` populates `src-tauri/waifu2x`; the binary is gitignored. The Tauri commands are `waifu2x_probe` (cached one-shot Vulkan check), `waifu2x_process` (writes the input PNG, substitutes `{input}`/`{output}`/`{models}`, streams stderr as `waifu2x-log`, enforces cancel) and `cancel_waifu2x`. `tests/waifu2x.test.ts` covers the wrapper against a fake spawn; `tests/waifu2xExport.test.ts` covers the Export path; `tests/waifu2xPalette.test.ts` covers the enhanced Palette. `npm run tauri build` runs the install script first, so a release build always carries the sidecar.
- The saved `trim` only applies while `trimEnabled` is on; Preview, Palette and Export all go through `effectiveTrim`. Speed scales every delay with `effectiveDelayMs`, keeping the 20 ms floor.
- A video Source is backed by a `VideoSource`: its frame rate is detected from the file, the hidden `<video>` plays natively in Preview, and scrub and Export seek frame by frame. The native preview rate is reduced when the GIF delay floor/quantisation makes the final motion slower. Never pre-extract the whole video; long files must stay bounded.
- Export sizes come from `outputSize`: an explicit `resize`, otherwise the native Crop size (`nativeSize`, the rect's pixels), capped at `MAX_EXPORT_SIDE` 4096. With the lock on, both sides shrink by the same factor, so the cap never stretches; an unlocked resize clamps each side on its own. `Carta 1×/2×` are Export sizes offered only for the Mudae proportions; every other proportion shows the custom width/height fields plus `Nativo`, `÷2` and `×2`. Unlocked aspect deliberately stretches only the final raster; the Crop still never distorts the Source.
- Exports are PNG or GIF only. PNG of an animation uses the selected frame; GIF keeps trim, speed, resize and loop.
- Optimize runs gifsicle WASM after our encoder: lossy LZW is the primary lever, color reduction is optional, duplicate frames are merged losslessly, and every candidate is decoded before it can replace the base. The size target can be off, in which case the chosen lossy/colour pass runs even below 10 MB. Gifsicle runs `-O3 --lossy=N --gamma=1` with `isStrict: false` (strict mode rejects its harmless warnings), and an enabled target only stops the further search, never the first chosen pass.
- The Export size readout comes from `estimateExportSize` in `src/core/export.ts`: a PNG is encoded for real up to `MAX_ESTIMATE_PIXELS` (above it a reduced raster is scaled by area), a GIF encodes up to 8 evenly spaced Trim frames and extrapolates, and above the same budget it samples a native-resolution tile and scales the bytes by area (marked `~`) instead of refusing. An enabled Optimize caps the estimate at its target. `src/core/size.ts` owns the 10 MB Mudae guidance (`exceedsSizeGuidance`); it warns but never blocks the 30 MB Image Chest upload, and applies to still PNGs too.
- Render order is Crop and Pad fill, then Sharpness, then Border. The Border width is in pixels of the final file and is drawn last, after the Source transform is restored, so rotation never tilts it. Export draws exactly that width; Preview scales it by `previewWidth / exportWidth` with a one-pixel floor (`frameBorderStroke`). The adjust phase hides the Border so the dashed Frame outline stays readable.
- The Palette renders the Crop at reduced resolution with `border: false`, then ranks the composited pixels by coverage while reserving slots for vibrant accents, so a small saturated area survives; the UI always prepends the fixed white swatch. It must never depend on the Border color.
- The Pad eyedropper samples the rendered frame canvas at the click point and shows a 9×9 pixel magnifier near the pointer. The native `input type=color` eyedropper is unreliable in WebView2 (it closes the dialog and cannot sample outside it), so the in-app "pegar cor da imagem" path is the supported one.
- Settings and History are JSON files (`settings.json`, `history.json`) in the app config directory; on Windows the `appDirectoriesOverride` points that directory at `%LOCALAPPDATA%\Mudae Crop`. The Rust side whitelists the settings/history keys.
- Settings persist the last preset proportion (`frameRatio`) and the Encaixe preference (`snapRatios`); a free `Personalizado` proportion is never saved, and a fresh document starts at the saved proportion. Loading is lenient: a hand-edited file may hold any positive proportion, but the app itself only writes presets. The old `exportScale` key is ignored and dropped on the next save.
- History entries are a discriminated union on `kind`: `upload` keeps the Post, direct link and thumbnail source; `export` keeps the absolute file path, dimensions and a reveal-in-Explorer action, plus an on-demand thumbnail read from disk through `read_export_bytes`.
- Image Chest requests go through the native `imagechest_request` command because the API does not answer CORS. The TS client owns request shape and link parsing; tests mock its transport.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `PHSebastiao/mudae-crop`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles, label string equal to role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
