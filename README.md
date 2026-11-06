<img src="assets/icon.svg" width="64" height="64" alt="">

# mudae-crop

A local Windows desktop editor that turns a Source image or animation into a Mudae card: a fixed 225×350 Frame, a Border, and an Export ready to upload to Image Chest.

This first slice is the core loop: bring a Source in from a file dialog, a drop or the clipboard, crop it into the Mudae Frame with Fit, pan and zoom, and Export a PNG at 1× through the native save dialog.

## Stack

- Tauri 2 desktop shell (Rust) with a React + TypeScript front-end built by Vite.
- The render pipeline is one pure module: the Preview's Frame and the Export both draw through `renderFrame(doc, { scale })` in `src/core/render.ts`. The dimmed surround reuses the same Source draw.
- Domain vocabulary lives in [GLOSSARY.md](GLOSSARY.md); decisions in [docs/adr](docs/adr).

## Prerequisites

- Node.js 20 or newer.
- Rust with the MSVC toolchain.
- Visual Studio 2022 Build Tools with **Desktop development with C++** (for `link.exe`).
- WebView2 runtime (present on Windows 11).

## Develop

```powershell
npm install
npm run tauri dev
```

Run the desktop command from a **Developer PowerShell for VS 2022**, or call `vcvars64.bat` first, so the MSVC linker is on `PATH`.

For layout-only work the front-end runs in a browser with `npm run dev`, but native file dialogs, file drops, clipboard files and saving only work in the desktop window.

## Checks

```powershell
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Vitest covers the render seam (a 1× hash snapshot plus fixture colors), Crop geometry, Source decoding and error messages, Export dimensions and naming. Native dialogs, drag-and-drop and the real save path are covered by the manual QA pass tracked in #13.

## Troubleshooting

- `link.exe not found` means the MSVC environment is not loaded: open a Developer PowerShell for VS 2022.
- If Vite fails with an `esbuild` install-script error, run `npm install-scripts approve esbuild` and `npm rebuild esbuild`.
