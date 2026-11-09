# waifu2x sidecar

This folder is where the packaged `waifu2x-ncnn-vulkan.exe` and its models live.
The binary is about 35 MB and is not committed, so a fresh clone contains only
this note and the folder is empty as far as the app is concerned.

Populate it with:

```powershell
npm run waifu2x:install
```

That downloads the pinned Windows release into this folder, next to
`models-cunet`. The app checks, in order:

1. `%LOCALAPPDATA%\com.phsebastiao.mudaecrop\waifu2x\`
2. the Tauri resource directory (`<install>\waifu2x\`)
3. the executable's own folder (`<install>\waifu2x\`)
4. this repo folder in a debug build

If neither the executable nor `models-cunet` is found, the waifu2x controls are
disabled with an explanation and the rest of the app keeps working.
