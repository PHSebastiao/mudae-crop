<img src="assets/icon.svg" width="64" height="64" alt="">

# mudae-crop

A local Windows desktop editor that turns a Source image or animation into a Mudae card: a fixed 225×350 Frame, a Border, and an Export ready to upload to Image Chest.

This slice is the core loop: bring a Source in from a file dialog, a drop, the clipboard or an image link, crop it into the Mudae or Square Frame, and Export a PNG or a looping GIF through the native save dialog. Sources can be PNG, JPG, GIF, animated WebP, APNG, a still WebP, or an MP4/MOV/WebM video; animations are composited frame by frame, and video plays natively in Preview while scrub and Export seek frame by frame. The editor shows frame count and duration, with a play/pause bar; a **trim** toggle puts two draggable limiters on that bar, and a 0,25×–4× speed multiplier keeps Preview and Export at the same final speed with the 20 ms delay floor. Long animations render, encode and optimize with progress and can be cancelled without losing the document. The Frame swaps between portrait and landscape, the Crop runs in Fit (overflow cropped, no bars) or Pad (whole Source visible, bars painted), snaps to width or height, rotates in 90° steps, and offers numeric zoom and offsets with a reset. Export dimensions accept a custom size with the aspect ratio locked by default, and GIF optimization uses real lossy compression with optional colour reduction, lossless duplicate-frame removal and a 10 MB target. The Pad color can be typed as HEX, chosen in the native picker, or sampled from the Frame with the in-app eyedropper — a 9×9 pixel magnifier follows the pointer (the native dialog's eyedropper does not work inside WebView2). The Border is a 1px white inner stroke by default, adjustable from 0 to 20 Frame pixels and scaled with the Export; the Palette samples the rendered Crop into up to 10 swatches — fixed white first, then the largest image colors and a few vibrant accents — merging near duplicates and relaxing the merge rather than repeating colors when the image is flat; and Sharpness is an unsharp mask from 0 to 100. Links are fetched by the Rust side, so CORS never applies; the download shows progress, can be cancelled, and refuses anything above 30 MB.

Settings keep the Image Chest token, the Export folder, the default privacy and the last Export/Border choices in `%LOCALAPPDATA%\Mudae Crop` on Windows, next to a 50-entry History of uploads and local Exports. The Image Chest upload needs a personal API token, generated at https://imgchest.com/profile/api; Configurações links to that page. With a token saved, **Subir e copiar link** (or Ctrl+Enter) renders the current Export, creates a hidden Image Chest Post — or appends to a Post id after validating it — copies the direct `cdn.imgchest.com` link and records it in the History. Every successful Export also adds a local entry with its file path, and its **explorador** action reveals the file in Explorer. The History keeps both kinds, offers copy/open actions and can be cleared. A 401 points at Configurações, a 413 explains the 30 MB limit, a 429 starts a visible backoff, and an offline failure offers a retry.

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

Vitest covers the render seam (a 1× hash snapshot, fixture colors, Pad fill, the default and scaled Border, sharpness, 90° rotation and custom resize), Crop geometry, Frame presets and orientation, Source decoding and error messages (PNG, JPG, GIF, still WebP, APNG and video container sniffing, animated frame assembly and the video Source seam), GIF decoding/compositing (disposal 0/1, 2 and 3, transparency, interlace, the 20 ms delay floor, the Netscape loop count and a GIF written by an external encoder), trim/speed geometry (frame counts, duration, floor, lookup and even sampling), Export dimensions and naming, PNG and GIF Export (trimmed frame count, selected frame, delay/loop preservation, custom resize, progress and cancellation), optimize (duplicate-frame merging, lossy/colour target termination, invalid-candidate rejection and cancellation), the URL download wrapper, Settings persistence, the automatic Post title, Palette extraction, deterministic sharpening, and the Image Chest client. Native dialogs, drag-and-drop, video codecs, gifsicle in WebView2, the real download, the real upload and the save path are covered by the manual QA pass tracked in #13.

## Troubleshooting

- `link.exe not found` means the MSVC environment is not loaded: open a Developer PowerShell for VS 2022.
- If Vite fails with an `esbuild` install-script error, run `npm install-scripts approve esbuild` and `npm rebuild esbuild`.
