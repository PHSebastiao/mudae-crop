# Desktop app on Tauri, no backend

Mudae cards are made from clipboard images, local files, arbitrary URLs and animated GIFs, and the user wants a taskbar app rather than a tab. A browser-only app cannot fetch arbitrary image links (CORS), needs hosting to be convenient, and cannot reliably process 20–30 MB GIFs with native speed. We build a Tauri 2 app (React + TypeScript front-end, Rust commands for file dialogs, downloads, sidecars and uploads) with no server, single-user, Windows-first; credentials and settings live as JSON in the app config directory.

## Consequences

There is no server to hold secrets, so the Image Chest token is stored in plain text in that config file. That is accepted for a single-user local app; it never enters the repository. WebView2 is the only runtime dependency on Windows 11.
