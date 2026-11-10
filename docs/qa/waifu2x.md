# waifu2x QA

Covers the bundled Vulkan sidecar ([ADR-0003](../adr/0003-waifu2x-bundled-sidecar.md)) and the Export pipeline that runs it. Everything automation can check lives in `tests/waifu2x.test.ts` (arguments, progress parsing, cancellation, non-zero exit), `tests/waifu2xExport.test.ts` (1× denoise, 2×/4× sizes, per-frame GIF progress and cancel) and `tests/waifu2xPalette.test.ts` (the Palette counts the sidecar output). The checks below need the real GPU.

## Environment used

| Item    | Value                                        |
| ------- | -------------------------------------------- |
| Date    | 2026-11-09                                   |
| OS      | Windows 11                                   |
| GPU     | NVIDIA GeForce RTX 5060, driver 32.0.16.1088 |
| Vulkan  | `vulkan-1.dll` present                       |
| Sidecar | `waifu2x-ncnn-vulkan` release 20250915       |
| Models  | `models-cunet` from the same release         |

## Real-GPU sidecar smoke test (executed)

The pinned binary and cunet models were run directly with the same arguments the app sends (`-i`, `-o`, `-m`, `-n`, `-s`, `-f png`) on a deterministic 225×350 black/white noise fixture.

| Run           | Result                        | Grayscale variance inside the Border                       |
| ------------- | ----------------------------- | ---------------------------------------------------------- |
| No waifu2x    | 225×350                       | 16256.3                                                    |
| Denoise 0, 1× | 225×350, dimensions unchanged | 16254.9                                                    |
| Denoise 1, 1× | 225×350, dimensions unchanged | 15868.5                                                    |
| Denoise 2, 1× | 225×350, dimensions unchanged | 1326.1                                                     |
| Denoise 3, 1× | 225×350, dimensions unchanged | 9110.9                                                     |
| Denoise 3, 2× | 450×700                       | flat (high-frequency checkerboard smoothed by the upscale) |
| Denoise 3, 4× | 900×1400                      | flat                                                       |

Pass: the GPU was detected, the models loaded, every denoise level ran at 1× without changing the dimensions, levels 2 and 3 visibly reduced the noise, and 2×/4× multiplied both sides exactly. (The level-to-variance shape is the model's own; 0 is deliberately the mildest.)

## Tile-size failure (executed)

The same GPU exposed a sidecar bug with its automatic tile size (`-t 0`): large tiles can come back fully transparent, which the app used to save as a blank card or a card with a missing rectangle. The failing files in `C:\Users\phsebastiao\Pictures\mudae-crop-tests` measured:

| Input   | Run           | Transparent pixels                      |
| ------- | ------------- | --------------------------------------- |
| 450×700 | auto tile, 2× | 480,000 (an 800×600 block, bottom-left) |
| 225×350 | auto tile, 2× | 315,000 (the whole 450×700 output)      |
| 225×350 | auto tile, 4× | 1,260,000 (the whole 900×1400 output)   |
| 450×700 | `-t 128`, 2×  | 0                                       |
| 225×350 | `-t 128`, 2×  | 0                                       |
| 225×350 | `-t 128`, 4×  | 0                                       |

`-t 32` still left 11/22 edge pixels; `-t 64` through `-t 192` were clean; `-t 256` and above failed again. The app now pins **`-t 128`** in `waifu2xArgs` and rejects any sidecar frame that introduces fully transparent pixels into an otherwise opaque Crop, so a future tile failure becomes a visible export error instead of a silently broken card.

## App probe (executed)

`npm run tauri dev` with the sidecar copied into the Tauri resource directory returned `waifu2x probe: ready` from the real `waifu2x_probe` command. This also caught a Windows-only path bug: Tauri's resource directory is an extended-length `\\?\` path, and ncnn could not open the models until `plain_path` stripped the prefix. The probe is now cached, and a fresh document starts with waifu2x off.

## App window pass (run after packaging)

Run this after `npm run waifu2x:install` and `npm run tauri dev`.

1. Launch with a populated `src-tauri/waifu2x` on a Vulkan machine. The top-bar chip reads **waifu2x off**; the waifu2x group is enabled.
2. Rename `src-tauri/waifu2x` and relaunch. The controls are disabled and the group explains that the sidecar is missing; import, Crop, Border and a normal Export still work.
3. On the Vulkan machine, load a noisy still, enable **ligar waifu2x** with denoise 3 at 1×, and Export PNG. The summary dimensions are unchanged, the noise is visibly reduced, and the 1px Border is still the outer pixel.
4. Switch to 2× on a 225×350 Frame. The summary shows 450×700, the Carta 1×/2× buttons and the custom width/height fields are disabled, and the saved PNG is 450×700. Repeat for 4× (900×1400).
5. Load an animated Source, enable waifu2x, and Export a GIF. The notice says **Realçando com waifu2x** with progress over the Trim frames.
6. Cancel during that GIF. The notice says **Render cancelado**, no file is written, and the document (Crop, Trim, waifu2x settings) is exactly as it was.
7. Change denoise or scale while waifu2x is on. The Palette sends up to six sampled frames through the sidecar again and its swatches follow the processed pixels; the size readout updates.
8. Disable or remove the Vulkan GPU (or force a machine without Vulkan) and relaunch. The controls are disabled with an explanation and the rest of the app works.

Sign-off: the real-GPU sidecar smoke test and the app probe above were executed on 2026-11-09. The packaged-window pass is the remaining manual check.
