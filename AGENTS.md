# mudae-crop

Local Windows desktop editor (Tauri 2 + React/TypeScript) that crops a Source into a fixed Mudae Frame and Exports a PNG. No server, single user. Prerequisites live in `README.md`; domain terms and decisions in `GLOSSARY.md` and `docs/adr/`.

## Checks

```powershell
npm run typecheck                          # both tsconfigs (src + tests, then vite.config.ts)
npm test                                   # Vitest, node env
npm run build                              # typecheck + vite build; does not build Rust
cargo check --manifest-path src-tauri/Cargo.toml
```

- One test file / one test: `npx vitest run tests/geometry.test.ts`, `npx vitest run -t "Pad"`.
- `npm test -- -u` rewrites `tests/__snapshots__/render.test.ts.snap`, a pixel hash. Only update it for an intended render change.
- Reuse fixtures from `tests/helpers.ts` (`makeSource`, `makeDoc`, `contextOf`, `pngSize`).
- Vitest runs in `node` with `@napi-rs/canvas`, not jsdom. Tests cover `src/core`; UI is checked in the window.
- There is no CI, ESLint or Prettier. These commands are the static gate.
- `npm run tauri dev` needs a Developer PowerShell for VS 2022, or `vcvars64.bat`, so `link.exe` is on `PATH`.
- `npm run dev` is browser-only: OS file drops, the file dialog, clipboard image files and saving require the desktop window.

## Layout

- `src/core/` is platform-free: no React, DOM calls or Tauri imports. Platform work arrives through injected seams (`RenderContext`, `Decoder`, `VideoSource`, `ExportAdapter`, `GifOptimizer`, `DownloadTransport`, `HistoryPreviewAdapter`).
- `src/platform/` holds the Tauri and browser adapters; `src/App.tsx` wires them (and imports the Tauri path helpers directly).
- `renderFrame()` in `src/core/render.ts` is the only Frame renderer; Preview and Export both call it, and the dimmed surround reuses `drawSource()`.
- Rust commands live in `src-tauri/src/lib.rs`. A new command must also be added to `generate_handler!`; commands use `rename_all = "snake_case"`, so TS passes `download_id`. New plugins need a permission in `src-tauri/capabilities/default.json`.
- The 30 MB ceiling is Image Chest's per-file limit: `src/core/limits.ts` owns the shared constant, `download.ts` and `imagechest.ts` reuse it, the optimize target cap reuses it, and `lib.rs` enforces the download cap natively. The Export History thumbnail read reuses the same ceiling. Keep them equal.

## Conventions

- UI copy and user-facing errors are pt-BR (`index.html` has `lang="pt-BR"`). Code, comments, identifiers and tests are English.
- Use `GLOSSARY.md` terms (Source, Frame, Crop, Scale mode, Fit/Pad, Rotation, Pad color, Border, Palette, Sharpness, Export, Post) and avoid its listed synonyms.
- Geometry is in Frame pixels at 1×. `offsetX/Y` are relative to the centred Source, and `zoom` multiplies the mode's base scale, never an absolute scale. Route crop changes through the `geometry.ts` helpers/`clampCrop`.
- Rotation is a canvas transform at draw time, with bounds swapped for 90°/270° (`rotatedBounds`). Never pre-rotate or resample bitmaps.
- `fit` skips the `padColor` fill so uncovered alpha shows; every other mode paints `padColor` first.
- `verbatimModuleSyntax` is on: type-only imports must use `import type` (and unused locals/params fail typecheck).
- GIF trim/playback/speed/Export, video import and still WebP import are in place; waifu2x and frame-rate reduction are deliberate placeholders in this slice. ADR-0003 describes the waifu2x target, not current behavior, so disabled controls are not bugs.
- The saved `trim` only applies while `trimEnabled` is on; Preview, Palette and Export all go through `effectiveTrim`. Speed scales every delay with `effectiveDelayMs`, keeping the 20 ms floor.
- A video Source is backed by a `VideoSource`: its frame rate is detected from the file, the hidden `<video>` plays natively in Preview, and scrub and Export seek frame by frame. The native preview rate is reduced when the GIF delay floor/quantisation makes the final motion slower. Never pre-extract the whole video; long files must stay bounded.
- Export sizes come from `outputSize`: a custom `resize` or the Frame × 1×/2×. Unlocked aspect deliberately stretches only the final raster; the Crop still never distorts the Source.
- Exports are PNG or GIF only. PNG of an animation uses the selected frame; GIF keeps trim, speed, resize and loop.
- Optimize runs gifsicle WASM after our encoder: lossy LZW is the primary lever, color reduction is optional, duplicate frames are merged losslessly, and every candidate is decoded before it can replace the base. The size target can be off, in which case the chosen lossy/colour pass runs even below 10 MB.
- The Export size readout comes from `estimateExportSize` in `src/core/export.ts`: a PNG is encoded for real, a GIF encodes up to 8 evenly spaced Trim frames and extrapolates, and an enabled Optimize caps the estimate at its target. `src/core/size.ts` owns the 10 MB Mudae guidance (`exceedsSizeGuidance`); it warns but never blocks the 30 MB Image Chest upload, and applies to still PNGs too.
- Render order is Crop and Pad fill, then Sharpness, then Border. The Border width is in Frame pixels at 1× and multiplies by the render scale; it is drawn after the Source transform is restored, so rotation never tilts it.
- The Palette renders the Crop at reduced resolution with `border: false`, then ranks the composited pixels by coverage while reserving slots for vibrant accents, so a small saturated area survives; the UI always prepends the fixed white swatch. It must never depend on the Border color.
- The Pad eyedropper samples the rendered frame canvas at the click point and shows a 9×9 pixel magnifier near the pointer. The native `input type=color` eyedropper is unreliable in WebView2 (it closes the dialog and cannot sample outside it), so the in-app "pegar cor da imagem" path is the supported one.
- Settings and History are JSON files (`settings.json`, `history.json`) in the app config directory; on Windows the `appDirectoriesOverride` points that directory at `%LOCALAPPDATA%\Mudae Crop`. The Rust side whitelists the settings/history keys.
- History entries are a discriminated union on `kind`: `upload` keeps the Post, direct link and thumbnail source; `export` keeps the absolute file path, dimensions and a reveal-in-Explorer action, plus an on-demand thumbnail read from disk through `read_export_bytes`.
- Image Chest requests go through the native `imagechest_request` command because the API does not answer CORS. The TS client owns request shape and link parsing; tests mock its transport.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `PHSebastiao/mudae-crop`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles, label string equal to role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
