# waifu2x ships as a bundled Vulkan sidecar

The user wants waifu2x denoise ("improve quality even without upscaling"), not only a resize filter. Remote waifu2x services add a network dependency and an account; ONNX/WASM models run on the CPU and are too slow to apply per GIF frame. We bundle `waifu2x-ncnn-vulkan` with its models as a Tauri sidecar, run it through Vulkan, and expose denoise 0–3 plus 1×/2×/4× scale.

## Consequences

The installer grows by roughly 50 MB and the feature needs a Vulkan-capable GPU; when no Vulkan device is available the option is disabled with an explanation. Per-frame GIF processing needs progress and cancellation. waifu2x stays off by default for every Source, still or animated, and no export size or preset turns it on.
