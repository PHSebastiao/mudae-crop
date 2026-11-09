<img src="assets/icon.svg" width="64" height="64" alt="">

# mudae-crop

A local Windows desktop editor that turns a Source image or animation into a card: a Frame with a chosen proportion, a Border, and an Export ready to upload to Image Chest.

This slice is the core loop: bring a Source in from a file dialog, a drop, the clipboard, an image link or a pasted local path, choose the Frame's proportion, and Export a PNG or a looping GIF through the native save dialog. The Frame is a crop window over the Source, not a fixed pixel size: the proportion popover offers portrait or landscape, the Mudae 9:14, 4:5, 3:4, 2:3, 1:1, 4:3, 3:2, 16:9 and 21:9 families plus the Source's own proportion as **Fonte**, and an **Encaixar proporções** switch. **Ajustar Frame** (C) turns on eight handles over a fixed Source; a locked drag anchors the opposite side or corner and keeps the proportion, **Shift** releases it into a free **Personalizado** proportion, and **Alt** bypasses the 2.5% snapping while a badge shows the native pixels and proportion; the window also shows rule-of-thirds guides, and moving it snaps its centre to the Source's centre (Alt releases). Sources can be PNG, JPG, GIF, animated WebP, APNG, a still WebP, or an MP4/MOV/WebM video; animations are composited frame by frame, and video plays natively in Preview while scrub and Export seek frame by frame at the video's own frame rate; because GIF delays are quantised to 10 ms with a 20 ms floor, a 60 fps clip exports near 50 fps and the native preview follows that resulting rate. The editor shows frame count and duration, with a play/pause bar; a **trim** toggle puts two draggable limiters on that bar, and a 0,25×–4× speed multiplier keeps Preview and Export at the same final speed with the 20 ms delay floor. Long animations render, encode and optimize with progress and can be cancelled without losing the document. The Crop runs in Fit (largest window inside the Source, excess outside), Pad (whole Source visible, bars painted), full width or full height, rotates in 90° steps, and offers numeric zoom and offsets as readouts with a reset. The Export panel leads with one output summary (format, pixels, proportion and file size). The output is the native crop size — the Source pixels the window covers — unless a Resize is set; **Nativo**, **÷2** and **×2** sit beside the custom width/height fields, and **Carta 1×**/**Carta 2×** (225×350/450×700, or 350×225/700×450 in landscape) appear only for Mudae. A lock keeps the Frame proportion and warns before a custom size stretches the card or asks the Source for more pixels than it has; the native hint is always shown, and the 4096-pixel memory cap keeps the output within the canvas bound, shrinking both sides proportionally while the lock is on. The size readout follows Trim, output size, format and Optimize - a still is encoded for real up to the pixel budget (a reduced raster above it), a GIF is estimated from evenly spaced frames or a native tile - and a non-blocking warning appears above Mudae's 10 MB guidance for stills and animations alike. GIF optimization uses real lossy compression with optional colour reduction, lossless duplicate-frame removal and an optional 10 MB target; turning the target off applies the chosen compression even below it, and the result shows the card-to-final size and percentage. The Pad color can be typed as HEX, chosen in the native picker, or sampled from the Crop with the in-app eyedropper — a 9×9 pixel magnifier follows the pointer (the native dialog's eyedropper does not work inside WebView2). The Border is a 1px white inner stroke by default, adjustable from 0 to 20 pixels of the final file and drawn last, so it is constant at every Export size while Preview scales it to stay at least one screen pixel; the Palette samples the rendered Crop into up to 10 swatches — fixed white first, then the largest image colors and a few vibrant accents — merging near duplicates and relaxing the merge rather than repeating colors when the image is flat; and Sharpness is an unsharp mask from 0 to 100. When waifu2x is on, the Palette runs the sidecar over up to six sampled frames so its swatches follow the processed pixels. Links are fetched by the Rust side, so CORS never applies; the download shows progress, can be cancelled, and refuses anything above 30 MB.

waifu2x is an opt-in enhancement: a bundled `waifu2x-ncnn-vulkan` sidecar and its cunet models run through Vulkan over the rendered Crop. Denoise 0–3 at 1× cleans the image without changing its dimensions; an explicit 2× or 4× upscale defines the Export size and disables the Carta and custom-size controls while it is active. It is off for every new Source and no Export scale or preset turns it on. The controls stay disabled with an explanation when the sidecar is missing or the machine has no Vulkan device, and the rest of the editor keeps working. Animations run frame by frame with progress and can be cancelled; a cancelled run leaves the document exactly as it was. The Preview shows the Crop before waifu2x, so the Export is authoritative there; the Palette runs the sidecar over up to six sampled frames, so its swatches follow the processed pixels. Install the pinned sidecar with `npm run waifu2x:install` (see [`src-tauri/waifu2x/PLACEHOLDER.md`](src-tauri/waifu2x/PLACEHOLDER.md)); `npm run tauri build` runs that step before bundling.

Settings keep the Image Chest token, the Export folder, the default privacy, the last preset proportion, the Encaixe preference and the last Export/Border choices in `%LOCALAPPDATA%\Mudae Crop` on Windows, next to a 50-entry History of uploads and local Exports. The Image Chest upload needs a personal API token, generated at https://imgchest.com/profile/api; Configurações links to that page. With a token saved, **Subir e copiar link** (or Ctrl+Enter) renders the current Export, creates a hidden Image Chest Post — or appends to a Post id after validating it — copies the direct `cdn.imgchest.com` link and records it in the History. Every successful Export also adds a local entry with its file path, and its **explorador** action reveals the file in Explorer. The History keeps both kinds, offers copy/open actions and can be cleared. A 401 points at Configurações, a 413 explains the 30 MB limit, a 429 starts a visible backoff, and an offline failure offers a retry.

## Stack

- Tauri 2 desktop shell (Rust) with a React + TypeScript front-end built by Vite.
- The render pipeline is one pure module: the Preview's Frame and the Export both draw through `renderFrame(ctx, doc, { outputWidth, outputHeight })` in `src/core/render.ts`. The dimmed surround reuses the same Source draw.
- Domain vocabulary lives in [GLOSSARY.md](GLOSSARY.md); decisions in [docs/adr](docs/adr).

## Prerequisites

- Node.js 20 or newer.
- Rust with the MSVC toolchain.
- Visual Studio 2022 Build Tools with **Desktop development with C++** (for `link.exe`).
- WebView2 runtime (present on Windows 11).
- A Vulkan-capable GPU and the bundled waifu2x sidecar for the waifu2x controls. Everything else works without them; the controls are disabled with an explanation.

## Develop

```powershell
npm install
npm run waifu2x:install
npm run tauri dev
```

`npm run waifu2x:install` downloads the pinned Windows sidecar and its models into
`src-tauri/waifu2x` (about 100 MB unpacked). It is optional: without it the app
builds and runs, and the waifu2x controls stay disabled.

Run the desktop command from a **Developer PowerShell for VS 2022**, or call `vcvars64.bat` first, so the MSVC linker is on `PATH`.

For layout-only work the front-end runs in a browser with `npm run dev`, but native file dialogs, file drops, clipboard files and saving only work in the desktop window.

## Checks

```powershell
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Vitest covers the render seam (a native-size hash snapshot, fixture colors, Pad fill, the Border in final-file pixels and its Preview floor, sharpness, 90° rotation and custom resize), Crop geometry (the rect model: per-mode rects, the 8× and Pad limits, pan, zoom, rotation, the long-side proportion change and handle resizing with 2.5% snapping, plus centre snapping when the window moves), proportion presets and labels (flip, tolerance, Carta sizes and reduced-ratio slugs), Source decoding and error messages (PNG, JPG, GIF, still WebP, APNG and video container sniffing, animated frame assembly and the video Source seam), GIF decoding/compositing (disposal 0/1, 2 and 3, transparency, interlace, the 20 ms delay floor, the Netscape loop count and a GIF written by an external encoder), export trim/speed geometry (frame counts, duration, floor, lookup and even sampling), Export dimensions and naming (the native crop size, the proportional 4096 cap, Carta 1×/2×, custom resize, ratio and source-up scale warnings), the Export size estimate (exact still encode, GIF extrapolation across Trim and output size, Optimize target cap and the 10 MB guidance), PNG and GIF Export (trimmed frame count, selected frame, delay/loop preservation, custom resize, progress and cancellation), optimize (duplicate-frame merging, lossy/colour target termination, invalid-candidate rejection and cancellation), the URL download wrapper, Settings persistence (the saved proportion, snapping and the stale `exportScale` key), the automatic Post title, Palette extraction, deterministic sharpening, the Image Chest client, and the waifu2x wrapper and Export path (arguments, progress parsing, cancellation, non-zero exit, the 1×/2×/4× sizes and per-frame GIF progress) against a fake sidecar. Native dialogs, drag-and-drop, video codecs, gifsicle in WebView2, the real download, the real upload, the real GPU sidecar and the save path are covered by the manual QA pass tracked in #13 and [`docs/qa/waifu2x.md`](docs/qa/waifu2x.md).

## Troubleshooting

- `link.exe not found` means the MSVC environment is not loaded: open a Developer PowerShell for VS 2022.
- If Vite fails with an `esbuild` install-script error, run `npm install-scripts approve esbuild` and `npm rebuild esbuild`.
