# Manual QA

The checks automation cannot cover: native drops, the clipboard, the OS dialogs,
the remembered save folder, the real Image Chest upload, GIF playback in
WebView2 and the installed/portable/standalone builds. The automated suites and
their scope are listed in the README; this file is the sign-off record.

## Environment

| Item     | Value                      |
| -------- | -------------------------- |
| Date     | 2026-11-10                 |
| OS       | Windows 11                 |
| GPU      | NVIDIA GeForce RTX 5060    |
| Vulkan   | available (`vulkan-1.dll`) |
| WebView2 | installed                  |

## Automated checks (executed)

| Check                                                   | Result |
| ------------------------------------------------------- | ------ |
| `npm run typecheck`                                     | pass   |
| `npm test`                                              | pass   |
| `npm run build`                                         | pass   |
| `npm run format:check`                                  | pass   |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | pass   |
| `cargo check --manifest-path src-tauri/Cargo.toml`      | pass   |
| `npm run tauri build -- --bundles nsis`                 | pass   |
| `pwsh -File scripts/make-portable.ps1`                  | pass   |

These cover the render seam, Crop geometry, Presets, GIF decode/assemble,
Export sizing and naming, Settings, Palette, Image Chest request shape and the
waifu2x wrapper; the Rust tests cover config-key whitelisting, download/waifu2x
cancellation and the window-state parsing, clamping and on-screen check. The
build row produced `Mudae-Crop-0.1.0-win64-setup.exe` (36.3 MiB),
`Mudae-Crop-0.1.0-portable-win64.zip` (29.5 MiB) and
`Mudae-Crop-0.1.0-win64.exe` (14.8 MiB) in `dist-portable/`.

## Application

Run `npm run tauri dev`, or the installed build for the packaging rows.

| #   | Check                                                                                                                      | Result         |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Drag a PNG and a GIF from Explorer onto the window. Both become the Source and the old Crop/Border/Preset survive.         |                |
| 2   | Copy an image with the Snipping Tool, then press Ctrl+V in the window. The clipboard image becomes the Source.             |                |
| 3   | Copy an image **file** in Explorer and press Ctrl+V. The file is read from the clipboard.                                  |                |
| 4   | Ctrl+O opens the native open dialog; a URL in the Source bar downloads with progress and can be cancelled.                 |                |
| 5   | Resize and move the window, close it, and launch again. The same size and position return.                                 | pass (harness) |
| 6   | Change the document (Source, Crop, Border, Trim), close and launch again. The document is empty; Settings survive.         |                |
| 7   | Ctrl+S opens the native save dialog in the remembered folder; the file is written and the History shows its path.          |                |
| 8   | **explorador** in a saved Export reveals the file in Explorer.                                                             |                |
| 9   | Play an animated Source, scrub its Timeline and toggle Trim. Playback and the exported loop match.                         |                |
| 10  | Export a GIF and open it in a browser and in Discord. It loops and plays at the same speed as Preview.                     |                |
| 11  | Press the arrows (1 px), Shift+arrows (10 px), `+`/`-`, `R`, `[`/`]`, `1` and `2`. Each does what the Atalhos dialog says. |                |
| 12  | `?` lists every shortcut above and Esc closes the list.                                                                    |                |
| 13  | Save an Image Chest token, test it, upload a PNG and a GIF, then paste the copied link into Discord.                       |                |

## Installer

| #   | Check                                                                                                      | Result         |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------- |
| 14  | `Mudae-Crop-<version>-win64-setup.exe` installs without a developer prompt and adds a Start-menu shortcut. | pass (harness) |
| 15  | The installed app starts, finds the bundled `waifu2x` sidecar, and the waifu2x group is ready on this GPU. |                |
| 16  | The installed app runs with the network disconnected except for Image Chest upload.                        |                |
| 17  | Uninstall from Windows Settings removes the program files and the Start-menu shortcut.                     | pass (harness) |
| 18  | `settings.json`, `history.json` and `window.json` remain in `%LOCALAPPDATA%\Mudae Crop` across reinstall.  |                |

## Portable ZIP

| #   | Check                                                                                                           | Result         |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| 19  | Unzip `Mudae-Crop-<version>-portable-win64.zip` into an empty folder; `waifu2x/` sits next to `Mudae-Crop.exe`. | pass (harness) |
| 20  | Launch the ZIP build on this Vulkan machine; the waifu2x controls are ready.                                    |                |
| 21  | On a machine without Vulkan, launch the same ZIP; the controls are disabled with the unsupported explanation.   |                |

## Standalone executable

| #   | Check                                                                                                                                                      | Result         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 22  | Put `Mudae-Crop-<version>-win64.exe` in an empty folder with no `waifu2x/` beside it and no sidecar in `%LOCALAPPDATA%\com.phsebastiao.mudaecrop\waifu2x`. | pass (harness) |
| 23  | The waifu2x controls are disabled and explain that the sidecar is missing.                                                                                 |                |
| 24  | Import, Crop, Border, Palette, PNG Export, GIF Export and upload still work.                                                                               |                |

## Sign-off

Record the build under test for each pass:

| Date       | Build                    | Rows passed       | Notes                                                                                                                      |
| ---------- | ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-10 | Mudae Crop 0.1.0 (win64) | 5, 14, 17, 19, 22 | Window restore, installer install/launch/uninstall, ZIP contents and standalone startup were run by the packaging harness. |
|            |                          |                   |                                                                                                                            |

A row is only checked after it was run on the build named above. The automated
checks and the packaging harness rows are the only ones this repository can sign
off without a person and a real Image Chest token. Rows 1-4, 6-13, 15-16, 18,
20-21 and 23-24 still need the manual pass.
