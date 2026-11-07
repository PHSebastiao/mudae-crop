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

- `src/core/` is platform-free: no React, DOM calls or Tauri imports. Platform work arrives through injected seams (`RenderContext`, `Decoder`, `ExportAdapter`, `DownloadTransport`).
- `src/platform/` holds the Tauri and browser adapters; `src/App.tsx` wires them (and imports the Tauri path helpers directly).
- `renderFrame()` in `src/core/render.ts` is the only Frame renderer; Preview and Export both call it, and the dimmed surround reuses `drawSource()`.
- Rust commands live in `src-tauri/src/lib.rs`. A new command must also be added to `generate_handler!`; commands use `rename_all = "snake_case"`, so TS passes `download_id`. New plugins need a permission in `src-tauri/capabilities/default.json`.
- The 30 MB ceiling is Image Chest's per-file limit: `src/core/download.ts` owns the front-end constant, `src/core/imagechest.ts` reuses it for uploads, and `lib.rs` enforces the download cap natively. Keep them equal.

## Conventions

- UI copy and user-facing errors are pt-BR (`index.html` has `lang="pt-BR"`). Code, comments, identifiers and tests are English.
- Use `GLOSSARY.md` terms (Source, Frame, Crop, Scale mode, Fit/Pad, Rotation, Pad color, Border, Palette, Sharpness, Export, Post) and avoid its listed synonyms.
- Geometry is in Frame pixels at 1×. `offsetX/Y` are relative to the centred Source, and `zoom` multiplies the mode's base scale, never an absolute scale. Route crop changes through the `geometry.ts` helpers/`clampCrop`.
- Rotation is a canvas transform at draw time, with bounds swapped for 90°/270° (`rotatedBounds`). Never pre-rotate or resample bitmaps.
- `fit` skips the `padColor` fill so uncovered alpha shows; every other mode paints `padColor` first.
- `verbatimModuleSyntax` is on: type-only imports must use `import type` (and unused locals/params fail typecheck).
- GIF trim/frames and waifu2x are deliberate placeholders in this slice. ADR-0002/0003 describe the target, not current behavior, so disabled controls are not bugs.
- Render order is Crop and Pad fill, then Sharpness, then Border. The Border width is in Frame pixels at 1× and multiplies by the render scale; it is drawn after the Source transform is restored, so rotation never tilts it.
- The Palette renders the Crop at reduced resolution with `border: false`, then ranks the composited pixels by coverage while reserving slots for vibrant accents, so a small saturated area survives; the UI always prepends the fixed white swatch. It must never depend on the Border color.
- Settings and History are JSON files (`settings.json`, `history.json`) in the app config directory; on Windows the `appDirectoriesOverride` points that directory at `%LOCALAPPDATA%\Mudae Crop`. `read_config` migrates the pre-override Roaming files on first read. The Rust side whitelists the keys and still reads the legacy `uploads.json`.
- History entries are a discriminated union on `kind`: `upload` keeps the Post, direct link and thumbnail source; `export` keeps the absolute file path, dimensions and a reveal-in-Explorer action.
- Image Chest requests go through the native `imagechest_request` command because the API does not answer CORS. The TS client owns request shape and link parsing; tests mock its transport.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `PHSebastiao/mudae-crop`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles, label string equal to role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
