use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, Window, WindowEvent,
};

/// The download ceiling matches Image Chest's 30 MB per-file limit, so a fetched
/// Source never exceeds what the upload path accepts. The front-end wrapper
/// enforces the same ceiling before decoding.
const MAX_DOWNLOAD_BYTES: u64 = 30 * 1024 * 1024;

/// How many early cancels may wait for a download that never starts. A cancel
/// whose download never starts is harmless, so the oldest one is dropped.
const MAX_EARLY_CANCELS: usize = 32;

/// The window can never be restored smaller than the configured minimum, and a
/// corrupt state file cannot ask for an unbounded window.
const MIN_WINDOW_WIDTH: u32 = 960;
const MIN_WINDOW_HEIGHT: u32 = 640;
const MAX_WINDOW_SIDE: u32 = 16_384;

/// A restored window must show at least this much of itself on a monitor, so a
/// saved position from a disconnected screen does not hide the app.
const MIN_VISIBLE_EDGE: i32 = 48;

/// The remembered geometry of the main window, in physical pixels.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    #[serde(default)]
    maximized: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ScreenRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// The last normal (not minimized or maximized) window bounds. The window is
/// saved from this on close, so closing while maximized keeps a sensible size
/// to restore to after unmaximizing.
#[derive(Default)]
struct WindowBounds(Mutex<Option<WindowState>>);

impl WindowBounds {
    fn lock(&self) -> MutexGuard<'_, Option<WindowState>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Read a state file leniently: a missing, corrupt or out-of-range file falls
/// back to the default centered window instead of failing the launch.
fn parse_window_state(raw: &str) -> Option<WindowState> {
    let state: WindowState = serde_json::from_str(raw).ok()?;
    if state.width == 0 || state.height == 0 {
        return None;
    }
    Some(WindowState {
        width: state.width.clamp(MIN_WINDOW_WIDTH, MAX_WINDOW_SIDE),
        height: state.height.clamp(MIN_WINDOW_HEIGHT, MAX_WINDOW_SIDE),
        ..state
    })
}

fn intersects_enough(window: &WindowState, monitor: &ScreenRect) -> bool {
    let left = window.x.max(monitor.x);
    let top = window.y.max(monitor.y);
    let right = (window.x + window.width as i32).min(monitor.x + monitor.width as i32);
    let bottom = (window.y + window.height as i32).min(monitor.y + monitor.height as i32);
    right - left >= MIN_VISIBLE_EDGE && bottom - top >= MIN_VISIBLE_EDGE
}

fn visibly_on_screen(window: &WindowState, monitors: &[ScreenRect]) -> bool {
    monitors.is_empty()
        || monitors
            .iter()
            .any(|monitor| intersects_enough(window, monitor))
}

fn current_window_state(window: &Window) -> Option<WindowState> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: false,
    })
}

fn window_state_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("window.json"))
}

fn read_window_state(app: &AppHandle) -> Option<WindowState> {
    parse_window_state(&std::fs::read_to_string(window_state_file(app)?).ok()?)
}

fn write_window_state(app: &AppHandle, state: &WindowState) {
    let Some(path) = window_state_file(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        if std::fs::create_dir_all(dir).is_err() {
            return;
        }
    }
    let Ok(contents) = serde_json::to_string(state) else {
        return;
    };
    let temporary = path.with_extension("json.tmp");
    if std::fs::write(&temporary, contents).is_ok() {
        let _ = std::fs::rename(&temporary, &path);
    }
}

/// Restore the saved geometry before the first frame is shown. A position that
/// no longer lands on a monitor is dropped, so the window stays reachable.
fn restore_window_state(window: &tauri::WebviewWindow) {
    let Some(state) = read_window_state(&window.app_handle()) else {
        return;
    };
    let monitors: Vec<ScreenRect> = window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| ScreenRect {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect();
    let on_screen = visibly_on_screen(&state, &monitors);
    let _ = window.set_size(PhysicalSize::new(state.width, state.height));
    if on_screen {
        let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
    }
    if state.maximized {
        let _ = window.maximize();
    }
    *window.state::<WindowBounds>().lock() = Some(WindowState {
        maximized: false,
        ..state
    });
}

/// Keep the latest normal size and position while the window moves or resizes.
fn record_window_bounds(window: &Window) {
    if window.label() != "main" {
        return;
    }
    if window.is_minimized().unwrap_or(false) || window.is_maximized().unwrap_or(false) {
        return;
    }
    let Some(state) = current_window_state(window) else {
        return;
    };
    *window.state::<WindowBounds>().lock() = Some(state);
}

/// Write the normal bounds plus whether the window was maximized. A close while
/// maximized saves the last normal geometry, so the next launch can restore to
/// a maximized window with a usable normal size underneath.
fn save_window_state(window: &Window) {
    if window.label() != "main" {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    if !maximized {
        if let Some(state) = current_window_state(window) {
            *window.state::<WindowBounds>().lock() = Some(state);
        }
    }
    let Some(mut state) = window.state::<WindowBounds>().lock().clone() else {
        return;
    };
    state.maximized = maximized;
    write_window_state(&window.app_handle(), &state);
}

/// Cancellation state of one download, keyed by the id the front-end chose.
///
/// ```text
///                    start()                       cancel()
///   (absent) ───────────────────▶ Running(false) ───────────▶ Running(true)
///      │                              │
///      │ cancel()                     │ finish()
///      ▼                              ▼
///   AwaitingStart ──start()──▶ Running(true)              (absent)
///   (bounded FIFO, MAX_EARLY_CANCELS)
/// ```
///
/// `AwaitingStart` marks a cancel that arrived before its download began; it
/// waits in its own bounded queue and never displaces a live flag. `start()`
/// consumes only the id it is starting, and `finish()` drops only a running
/// entry, so a later cancel for a finished id becomes an early cancel again.
enum DownloadState {
    /// A cancel arrived first. `enqueued_at` keeps the queue's insertion order.
    AwaitingStart { enqueued_at: u64 },
    /// The download is streaming. The flag is the shared cancel signal the
    /// stream polls.
    Running(Arc<AtomicBool>),
}

#[derive(Default)]
struct DownloadRegistry {
    states: HashMap<String, DownloadState>,
    /// How many `AwaitingStart` entries `states` holds, so the cap check does
    /// not scan the live downloads.
    pending: usize,
    next_sequence: u64,
}

impl DownloadRegistry {
    /// Enter the running state and publish the flag the stream polls. A pending
    /// early cancel is consumed and starts the download already cancelled.
    fn start(&mut self, id: &str) -> Arc<AtomicBool> {
        let cancelled = match self.states.remove(id) {
            Some(DownloadState::AwaitingStart { .. }) => {
                self.pending -= 1;
                true
            }
            // Starting an id that is already running keeps the previous
            // behaviour: a fresh flag replaces it and the old stream keeps its
            // own handle.
            Some(DownloadState::Running(_)) | None => false,
        };
        let flag = Arc::new(AtomicBool::new(cancelled));
        self.states
            .insert(id.to_string(), DownloadState::Running(flag.clone()));
        flag
    }

    /// Cancel a download whatever its state: set the live flag, keep an existing
    /// early cancel, or queue a new one when no download has started yet.
    fn cancel(&mut self, id: String) {
        match self.states.get_mut(&id) {
            Some(DownloadState::Running(flag)) => {
                flag.store(true, Ordering::Relaxed);
            }
            Some(DownloadState::AwaitingStart { .. }) => {}
            None => {
                if self.pending >= MAX_EARLY_CANCELS {
                    self.evict_oldest_pending();
                }
                let enqueued_at = self.next_sequence;
                self.next_sequence = self.next_sequence.saturating_add(1);
                self.states
                    .insert(id, DownloadState::AwaitingStart { enqueued_at });
                self.pending += 1;
            }
        }
    }

    /// Leave the machine once the stream ends. A later cancel for the id is an
    /// early cancel again.
    fn finish(&mut self, id: &str) {
        if matches!(self.states.get(id), Some(DownloadState::Running(_))) {
            self.states.remove(id);
        }
    }

    /// Drop the oldest id still waiting, keeping the queue at
    /// `MAX_EARLY_CANCELS`. Live flags are never evicted.
    fn evict_oldest_pending(&mut self) {
        let oldest = self
            .states
            .iter()
            .filter_map(|(id, state)| match state {
                DownloadState::AwaitingStart { enqueued_at } => Some((*enqueued_at, id.clone())),
                DownloadState::Running(_) => None,
            })
            .min_by_key(|(enqueued_at, _)| *enqueued_at)
            .map(|(_, id)| id);
        if let Some(id) = oldest {
            self.states.remove(&id);
            self.pending -= 1;
        }
    }
}

/// Cancellation state for in-flight downloads, keyed by the id the front-end
/// chose. A cancel can arrive before its download starts; `DownloadState`
/// records that out-of-order case explicitly.
#[derive(Default)]
struct Downloads(Mutex<DownloadRegistry>);

impl Downloads {
    fn lock(&self) -> MutexGuard<'_, DownloadRegistry> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadMeta {
    id: String,
    content_type: Option<String>,
    content_length: Option<u64>,
    final_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    id: String,
    received: u64,
    total: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadFailure {
    code: &'static str,
    status: Option<u16>,
    detail: Option<String>,
}

impl DownloadFailure {
    fn new(code: &'static str) -> Self {
        Self {
            code,
            status: None,
            detail: None,
        }
    }

    fn http(status: u16) -> Self {
        Self {
            code: "http",
            status: Some(status),
            detail: None,
        }
    }

    fn detail(code: &'static str, detail: String) -> Self {
        Self {
            code,
            status: None,
            detail: Some(detail),
        }
    }
}

/// Read the bytes of a local Source: a file the user picked in the native
/// dialog or a path pasted into the Source bar. Returning a raw Response keeps
/// large GIFs out of the JSON IPC path.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

/// Write an Export to the path chosen in the native save dialog.
#[tauri::command]
fn write_file_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    if Path::new(&path).is_dir() {
        return Err("O caminho escolhido é uma pasta, não um arquivo.".into());
    }
    std::fs::write(&path, contents).map_err(|error| error.to_string())
}

/// Read a saved Export so its History row can show a thumbnail. The file lives
/// wherever the save dialog wrote it, outside the web root, so the bytes cross
/// through the native side. Missing paths, folders and files over the Image
/// Chest ceiling are refused.
#[tauri::command]
async fn read_export_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    read_export_preview(Path::new(&path), MAX_DOWNLOAD_BYTES).map(tauri::ipc::Response::new)
}

fn read_export_preview(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    if !path.is_absolute() {
        return Err("O caminho do Export precisa ser absoluto.".into());
    }
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("O caminho do Export não é um arquivo.".into());
    }
    // Read one byte past the cap, so a file that grows after the metadata check
    // is still refused instead of being loaded whole.
    let mut bytes = Vec::with_capacity(metadata.len().min(max_bytes) as usize);
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err("O arquivo do Export é grande demais para a prévia.".into());
    }
    Ok(bytes)
}

/// Fetch a Source from a URL on the native side, so CORS never applies. The
/// body is streamed, capped and cancellable; progress travels as events and the
/// bytes come back through the raw IPC response.
#[tauri::command(rename_all = "snake_case")]
async fn download_source(
    app: AppHandle,
    downloads: State<'_, Downloads>,
    url: String,
    download_id: String,
) -> Result<tauri::ipc::Response, DownloadFailure> {
    let cancelled = downloads.lock().start(&download_id);

    let outcome = stream_download(&app, &url, &download_id, &cancelled).await;

    downloads.lock().finish(&download_id);
    outcome.map(tauri::ipc::Response::new)
}

#[tauri::command(rename_all = "snake_case")]
fn cancel_download(downloads: State<'_, Downloads>, download_id: String) {
    downloads.lock().cancel(download_id);
}

async fn stream_download(
    app: &AppHandle,
    url: &str,
    download_id: &str,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, DownloadFailure> {
    if cancelled.load(Ordering::Relaxed) {
        return Err(DownloadFailure::new("cancelled"));
    }

    let client = reqwest::Client::builder()
        .user_agent("mudae-crop/0.1")
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| DownloadFailure::detail("unreachable", error.to_string()))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| DownloadFailure::detail("unreachable", error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(DownloadFailure::http(status.as_u16()));
    }

    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let content_length = response.content_length();

    let _ = app.emit(
        "download-meta",
        DownloadMeta {
            id: download_id.to_string(),
            content_type,
            content_length,
            final_url,
        },
    );

    if cancelled.load(Ordering::Relaxed) {
        return Err(DownloadFailure::new("cancelled"));
    }
    if content_length.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
        return Err(DownloadFailure::new("too-large"));
    }

    let mut bytes =
        Vec::with_capacity(content_length.unwrap_or(0).min(MAX_DOWNLOAD_BYTES) as usize);
    let mut received: u64 = 0;
    let mut chunks = response.bytes_stream();

    while let Some(chunk) = chunks.next().await {
        if cancelled.load(Ordering::Relaxed) {
            return Err(DownloadFailure::new("cancelled"));
        }
        let chunk =
            chunk.map_err(|error| DownloadFailure::detail("unreachable", error.to_string()))?;
        received += chunk.len() as u64;
        if received > MAX_DOWNLOAD_BYTES {
            return Err(DownloadFailure::new("too-large"));
        }
        bytes.extend_from_slice(&chunk);
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                id: download_id.to_string(),
                received,
                total: content_length,
            },
        );
    }

    Ok(bytes)
}

/// Settings and History live as JSON files in the app config directory. Only
/// the known keys map to files, so the front-end never chooses a path.
fn config_file_name(key: &str) -> Option<&'static str> {
    match key {
        "settings" => Some("settings.json"),
        "history" => Some("history.json"),
        _ => None,
    }
}

fn config_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let file = config_file_name(key).ok_or("Chave de configuração desconhecida.")?;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(file))
}

#[tauri::command]
fn read_config(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = config_path(&app, &key)?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn write_config(app: AppHandle, key: String, contents: String) -> Result<(), String> {
    if contents.len() > 1_048_576 {
        return Err("Arquivo de configuração grande demais.".into());
    }
    let path = config_path(&app, &key)?;
    // Write beside the target and rename, so a crash never leaves half a file.
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageChestReply {
    status: u16,
    body: String,
    retry_after_seconds: Option<u64>,
}

/// One Image Chest API request on the native side, where CORS does not apply.
/// The front-end still owns the request shape and the response interpretation;
/// this command only carries the multipart body and reports the status.
#[tauri::command(rename_all = "snake_case")]
async fn imagechest_request(
    method: String,
    path: String,
    token: String,
    form: Option<HashMap<String, String>>,
    file_field: Option<String>,
    file_name: Option<String>,
    file_type: Option<String>,
    file_bytes: Option<Vec<u8>>,
) -> Result<ImageChestReply, String> {
    if !path.starts_with("/v1/") || path.contains("..") {
        return Err("Caminho de API inválido.".into());
    }
    if token.trim().is_empty() {
        return Err("Token do Image Chest vazio.".into());
    }

    let client = reqwest::Client::builder()
        .user_agent("mudae-crop/0.1")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?;

    let url = format!("https://api.imgchest.com{path}");
    let mut request = match method.as_str() {
        "GET" => client.get(url),
        "POST" => client.post(url),
        _ => return Err("Método HTTP inválido.".into()),
    }
    .bearer_auth(token.trim());

    if method == "POST" {
        let mut multipart = reqwest::multipart::Form::new();
        for (key, value) in form.unwrap_or_default() {
            multipart = multipart.text(key, value);
        }
        if let (Some(field), Some(name), Some(bytes)) = (file_field, file_name, file_bytes) {
            let mut part = reqwest::multipart::Part::bytes(bytes).file_name(name);
            if let Some(mime) = file_type {
                part = part.mime_str(&mime).map_err(|error| error.to_string())?;
            }
            multipart = multipart.part(field, part);
        }
        request = request.multipart(multipart);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let retry_after_seconds = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok());
    let body = response.text().await.map_err(|error| error.to_string())?;

    Ok(ImageChestReply {
        status,
        body,
        retry_after_seconds,
    })
}

#[tauri::command]
fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Só links http(s) podem ser abertos.".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

/// Reveal a saved Export in the system file manager, selecting the file.
#[tauri::command]
fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(Path::new(&path))
        .map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// waifu2x sidecar
//
// The binary and its cunet model live together in a `waifu2x` folder next to
// the app, in the resource directory, or in the per-user data directory. The
// front-end owns the arguments and the progress parsing; this side writes the
// rendered PNG to a temp file, substitutes the path placeholders, streams
// stderr lines as events, enforces cancellation and returns the output bytes.
// ---------------------------------------------------------------------------

const WAIFU2X_BINARY: &str = if cfg!(windows) {
    "waifu2x-ncnn-vulkan.exe"
} else {
    "waifu2x-ncnn-vulkan"
};
const WAIFU2X_MODEL: &str = "models-cunet";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Waifu2xProbe {
    /// ready | unsupported | missing | failed
    status: String,
    detail: Option<String>,
}

#[derive(Default)]
struct Waifu2xProbeCache(Mutex<Option<Waifu2xProbe>>);

impl Waifu2xProbeCache {
    fn lock(&self) -> MutexGuard<'_, Option<Waifu2xProbe>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Cancellation for one sidecar run. A cancel can arrive before the process
/// command has started, so `early` remembers those ids until `start` consumes
/// them. The queue is bounded exactly like the download registry's.
#[derive(Default)]
struct Waifu2xRuns {
    live: Mutex<HashMap<String, Arc<AtomicBool>>>,
    early: Mutex<VecDeque<String>>,
}

impl Waifu2xRuns {
    fn start(&self, job_id: &str) -> Arc<AtomicBool> {
        let cancelled = {
            let mut queue = self.early.lock().unwrap_or_else(|p| p.into_inner());
            match queue.iter().position(|id| id == job_id) {
                Some(index) => {
                    queue.remove(index);
                    true
                }
                None => false,
            }
        };
        let flag = Arc::new(AtomicBool::new(cancelled));
        self.live
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(job_id.to_string(), flag.clone());
        flag
    }

    fn cancel(&self, job_id: String) {
        if let Some(flag) = self
            .live
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&job_id)
        {
            flag.store(true, Ordering::Relaxed);
            return;
        }
        let mut queue = self.early.lock().unwrap_or_else(|p| p.into_inner());
        if queue.len() >= MAX_EARLY_CANCELS {
            queue.pop_front();
        }
        if !queue.iter().any(|id| id == &job_id) {
            queue.push_back(job_id);
        }
    }

    fn finish(&self, job_id: &str) {
        self.live
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(job_id);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Waifu2xLog {
    id: String,
    line: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Waifu2xFailure {
    code: &'static str,
    detail: Option<String>,
}

impl Waifu2xFailure {
    fn new(code: &'static str) -> Self {
        Self { code, detail: None }
    }

    fn detail(code: &'static str, detail: String) -> Self {
        Self {
            code,
            detail: Some(detail),
        }
    }
}

fn waifu2x_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = app.path().app_local_data_dir() {
        roots.push(dir.join("waifu2x"));
    }
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(dir.join("waifu2x"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("waifu2x"));
        }
    }
    // `npm run tauri dev` runs from target/debug, so the repo folder is the
    // only place a developer's sidecar can be found without bundling first.
    #[cfg(debug_assertions)]
    {
        roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("waifu2x"));
    }
    roots
}

fn find_waifu2x(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    for root in waifu2x_roots(app) {
        let binary = root.join(WAIFU2X_BINARY);
        let models = root.join(WAIFU2X_MODEL);
        if binary.is_file() && models.is_dir() {
            return Some((binary, models));
        }
    }
    None
}

/// Tauri's resource dir is an extended-length `\\?\` path on Windows, which the
/// sidecar's `_wfopen` does not understand when it appends a model file name.
/// Give it a plain absolute path instead.
fn plain_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    text.into_owned()
}

/// The front-end chooses the job id, but it becomes part of a temp path, so
/// strip anything that could walk out of the directory.
fn sanitize_job_id(job_id: &str) -> String {
    let cleaned: String = job_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(64)
        .collect();
    if cleaned.is_empty() {
        "job".into()
    } else {
        cleaned
    }
}

/// Keep the useful tail of a sidecar failure and name the common Vulkan case.
fn waifu2x_failure_detail(stderr: &str) -> String {
    let text = stderr.trim();
    if text.is_empty() {
        return "O waifu2x falhou sem detalhes.".into();
    }
    let lower = text.to_lowercase();
    let mut tail: Vec<&str> = text.lines().rev().take(3).collect();
    tail.reverse();
    let summary = tail.join(" · ");
    let summary: String = summary.chars().take(400).collect();
    if lower.contains("vulkan") || lower.contains("no device") || lower.contains("vkcreate") {
        format!("Este computador não tem uma GPU com Vulkan. {summary}")
    } else {
        summary
    }
}

/// Run the sidecar once on `input` and return its output bytes. The child is
/// polled so a cancel or the timeout can kill it even while stderr is being
/// drained on another thread.
fn execute_waifu2x(
    app: &AppHandle,
    binary: &Path,
    models: &Path,
    args: &[String],
    input: &[u8],
    job_id: &str,
    cancel: &AtomicBool,
    timeout: Duration,
    emit_log: bool,
) -> Result<Vec<u8>, Waifu2xFailure> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "mudae-crop-waifu2x-{}-{}-{}",
        std::process::id(),
        nanos,
        sanitize_job_id(job_id)
    ));
    std::fs::create_dir_all(&dir).map_err(|error| {
        Waifu2xFailure::detail(
            "failed",
            format!("Não foi possível criar o diretório temporário: {error}"),
        )
    })?;
    let input_path = dir.join("input.png");
    let output_path = dir.join("output.png");
    if let Err(error) = std::fs::write(&input_path, input) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(Waifu2xFailure::detail(
            "failed",
            format!("Não foi possível gravar a imagem para o waifu2x: {error}"),
        ));
    }

    let input_text = plain_path(&input_path);
    let output_text = plain_path(&output_path);
    let models_text = plain_path(models);
    let resolved: Vec<String> = args
        .iter()
        .map(|arg| {
            arg.replace("{input}", &input_text)
                .replace("{output}", &output_text)
                .replace("{models}", &models_text)
        })
        .collect();

    let mut child = match Command::new(binary)
        .args(&resolved)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(Waifu2xFailure::detail(
                "failed",
                format!("Não foi possível iniciar o waifu2x: {error}"),
            ));
        }
    };

    let mut stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_dir_all(&dir);
            return Err(Waifu2xFailure::detail(
                "failed",
                "O waifu2x não abriu a saída de erro.".into(),
            ));
        }
    };

    let app_for_log = app.clone();
    let id_for_log = job_id.to_string();
    let reader = std::thread::spawn(move || {
        let mut collected = String::new();
        let mut pending = String::new();
        let mut chunk = [0u8; 4096];
        loop {
            match stderr.read(&mut chunk) {
                Ok(0) => break,
                Ok(count) => {
                    let text = String::from_utf8_lossy(&chunk[..count]).into_owned();
                    collected.push_str(&text);
                    pending.push_str(&text);
                    loop {
                        let split = pending.find(|ch| ch == '\n' || ch == '\r');
                        let Some(index) = split else { break };
                        let line = pending[..index].to_string();
                        pending = pending[index + 1..].to_string();
                        if emit_log && !line.is_empty() {
                            let _ = app_for_log.emit(
                                "waifu2x-log",
                                Waifu2xLog {
                                    id: id_for_log.clone(),
                                    line,
                                },
                            );
                        }
                    }
                }
                Err(_) => break,
            }
        }
        if emit_log && !pending.is_empty() {
            let _ = app_for_log.emit(
                "waifu2x-log",
                Waifu2xLog {
                    id: id_for_log,
                    line: pending,
                },
            );
        }
        collected
    });

    let started = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            let _ = std::fs::remove_dir_all(&dir);
            return Err(Waifu2xFailure::new("cancelled"));
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            let _ = std::fs::remove_dir_all(&dir);
            return Err(Waifu2xFailure::detail(
                "failed",
                "O waifu2x demorou demais para responder.".into(),
            ));
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let stderr_text = reader.join().unwrap_or_default();
                if !status.success() {
                    let _ = std::fs::remove_dir_all(&dir);
                    return Err(Waifu2xFailure::detail(
                        "failed",
                        waifu2x_failure_detail(&stderr_text),
                    ));
                }
                let bytes = match std::fs::read(&output_path) {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        let _ = std::fs::remove_dir_all(&dir);
                        return Err(Waifu2xFailure::detail(
                            "failed",
                            format!("O waifu2x não gravou a imagem: {error}"),
                        ));
                    }
                };
                let _ = std::fs::remove_dir_all(&dir);
                if bytes.is_empty() {
                    return Err(Waifu2xFailure::detail(
                        "failed",
                        "O waifu2x gravou uma imagem vazia.".into(),
                    ));
                }
                return Ok(bytes);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                let _ = std::fs::remove_dir_all(&dir);
                return Err(Waifu2xFailure::detail(
                    "failed",
                    format!("O waifu2x falhou: {error}"),
                ));
            }
        }
    }
}

fn probe_waifu2x(app: &AppHandle, args: &[String], input: &[u8]) -> Waifu2xProbe {
    let Some((binary, models)) = find_waifu2x(app) else {
        return Waifu2xProbe {
            status: "missing".into(),
            detail: Some(
                "O waifu2x não faz parte desta versão. Use o instalador ou o ZIP portátil para tê-lo; o resto do editor continua funcionando."
                    .into(),
            ),
        };
    };
    let cancel = AtomicBool::new(false);
    match execute_waifu2x(
        app,
        &binary,
        &models,
        args,
        input,
        "probe",
        &cancel,
        Duration::from_secs(30),
        false,
    ) {
        Ok(bytes) if !bytes.is_empty() => Waifu2xProbe {
            status: "ready".into(),
            detail: None,
        },
        Ok(_) => Waifu2xProbe {
            status: "failed".into(),
            detail: Some("O waifu2x não produziu uma imagem de teste.".into()),
        },
        Err(failure) => {
            let detail = failure.detail.unwrap_or_else(|| "falha do waifu2x".into());
            let unsupported = detail.to_lowercase().contains("vulkan");
            Waifu2xProbe {
                status: if unsupported { "unsupported" } else { "failed" }.into(),
                detail: Some(detail),
            }
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn waifu2x_probe(
    app: AppHandle,
    cache: State<'_, Waifu2xProbeCache>,
    args: Vec<String>,
    input: Vec<u8>,
) -> Result<Waifu2xProbe, String> {
    if let Some(cached) = cache.lock().clone() {
        return Ok(cached);
    }
    let probe = tauri::async_runtime::spawn_blocking(move || probe_waifu2x(&app, &args, &input))
        .await
        .unwrap_or_else(|_| Waifu2xProbe {
            status: "failed".into(),
            detail: Some("A verificação do waifu2x falhou.".into()),
        });
    *cache.lock() = Some(probe.clone());
    Ok(probe)
}

#[tauri::command(rename_all = "snake_case")]
async fn waifu2x_process(
    app: AppHandle,
    runs: State<'_, Waifu2xRuns>,
    args: Vec<String>,
    input: Vec<u8>,
    job_id: String,
) -> Result<tauri::ipc::Response, Waifu2xFailure> {
    let Some((binary, models)) = find_waifu2x(&app) else {
        return Err(Waifu2xFailure::new("missing"));
    };
    let cancel = runs.start(&job_id);

    let app_for_run = app.clone();
    let id_for_run = job_id.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        execute_waifu2x(
            &app_for_run,
            &binary,
            &models,
            &args,
            &input,
            &id_for_run,
            &cancel,
            Duration::from_secs(300),
            true,
        )
    })
    .await;

    runs.finish(&job_id);
    match outcome {
        Ok(Ok(bytes)) => Ok(tauri::ipc::Response::new(bytes)),
        Ok(Err(failure)) => Err(failure),
        Err(error) => Err(Waifu2xFailure::detail("failed", error.to_string())),
    }
}

#[tauri::command(rename_all = "snake_case")]
fn cancel_waifu2x(runs: State<'_, Waifu2xRuns>, job_id: String) {
    runs.cancel(job_id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Downloads::default())
        .manage(Waifu2xRuns::default())
        .manage(Waifu2xProbeCache::default())
        .manage(WindowBounds::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                restore_window_state(&window);
                let _ = window.show();
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => record_window_bounds(window),
            WindowEvent::CloseRequested { .. } => save_window_state(window),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            read_file_bytes,
            write_file_bytes,
            read_export_bytes,
            download_source,
            cancel_download,
            read_config,
            write_config,
            imagechest_request,
            copy_text,
            open_external,
            reveal_path,
            waifu2x_probe,
            waifu2x_process,
            cancel_waifu2x
        ])
        .run(tauri::generate_context!())
        .expect("error while running mudae crop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_keys_are_whitelisted() {
        assert_eq!(config_file_name("settings"), Some("settings.json"));
        assert_eq!(config_file_name("history"), Some("history.json"));
        assert_eq!(config_file_name("uploads"), None);
        assert_eq!(config_file_name("../settings"), None);
        assert_eq!(config_file_name("other"), None);
    }

    fn temp_path(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "mudae-crop-{}-{}-{}",
            std::process::id(),
            nanos,
            name
        ))
    }

    #[test]
    fn export_preview_refuses_missing_and_relative_paths() {
        assert!(read_export_preview(&temp_path("missing.png"), MAX_DOWNLOAD_BYTES).is_err());
        assert!(read_export_preview(Path::new("relative.png"), MAX_DOWNLOAD_BYTES).is_err());
    }

    #[test]
    fn export_preview_refuses_a_directory() {
        assert!(read_export_preview(&std::env::temp_dir(), MAX_DOWNLOAD_BYTES).is_err());
    }

    #[test]
    fn export_preview_reads_a_file_under_the_cap() {
        let path = temp_path("read.png");
        std::fs::write(&path, [1u8, 2, 3]).unwrap();

        let bytes = read_export_preview(&path, MAX_DOWNLOAD_BYTES).unwrap();

        assert_eq!(bytes, vec![1, 2, 3]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_preview_caps_the_read() {
        let path = temp_path("big.png");
        std::fs::write(&path, [0u8; 16]).unwrap();

        assert!(read_export_preview(&path, 8).is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn cancel_before_start_cancels_the_running_download() {
        let mut registry = DownloadRegistry::default();

        registry.cancel("early".into());
        let flag = registry.start("early");

        assert!(flag.load(Ordering::Relaxed));
        assert!(matches!(
            registry.states.get("early"),
            Some(DownloadState::Running(_))
        ));
        assert_eq!(registry.pending, 0);
    }

    #[test]
    fn cancel_during_run_sets_the_live_flag() {
        let mut registry = DownloadRegistry::default();
        let flag = registry.start("live");

        assert!(!flag.load(Ordering::Relaxed));
        registry.cancel("live".into());

        assert!(flag.load(Ordering::Relaxed));
        assert_eq!(registry.pending, 0);
    }

    #[test]
    fn cancel_after_finish_becomes_an_early_cancel_again() {
        let mut registry = DownloadRegistry::default();
        registry.start("done");
        registry.finish("done");

        assert!(registry.states.is_empty());

        registry.cancel("done".into());
        let flag = registry.start("done");

        assert!(flag.load(Ordering::Relaxed));
    }

    #[test]
    fn waifu2x_cancel_before_start_cancels_the_run() {
        let runs = Waifu2xRuns::default();

        runs.cancel("early".into());
        let flag = runs.start("early");

        assert!(flag.load(Ordering::Relaxed));
    }

    #[test]
    fn waifu2x_cancel_during_run_sets_the_live_flag() {
        let runs = Waifu2xRuns::default();
        let flag = runs.start("live");

        runs.cancel("live".into());
        runs.finish("live");

        assert!(flag.load(Ordering::Relaxed));
    }

    #[test]
    fn waifu2x_early_cancels_stay_bounded() {
        let runs = Waifu2xRuns::default();
        for index in 0..MAX_EARLY_CANCELS {
            runs.cancel(index.to_string());
        }
        runs.cancel("overflow".into());

        assert!(!runs.start("0").load(Ordering::Relaxed));
        assert!(runs.start("overflow").load(Ordering::Relaxed));
    }

    #[test]
    fn waifu2x_paths_lose_the_extended_length_prefix() {
        assert_eq!(plain_path(Path::new(r"\\?\C:\x\y")), r"C:\x\y");
        assert_eq!(
            plain_path(Path::new(r"\\?\UNC\server\share\y")),
            r"\\server\share\y"
        );
        assert_eq!(plain_path(Path::new(r"C:\x\y")), r"C:\x\y");
    }

    #[test]
    fn waifu2x_failure_names_a_vulkan_problem() {
        let detail = waifu2x_failure_detail("vkCreateInstance failed");
        assert!(detail.to_lowercase().contains("vulkan"));
        assert_eq!(waifu2x_failure_detail("boom"), "boom");
    }

    #[test]
    fn waifu2x_job_ids_cannot_escape_the_temp_directory() {
        let cleaned = sanitize_job_id("../x y/..\\z");
        assert!(!cleaned.contains(".."));
        assert!(!cleaned.contains('/'));
        assert!(!cleaned.contains('\\'));
        assert_eq!(cleaned, "xyz");
        assert_eq!(sanitize_job_id("!!!"), "job");
    }

    #[test]
    fn early_cancels_keep_at_most_thirty_two_in_fifo_order() {
        let mut registry = DownloadRegistry::default();
        for index in 0..MAX_EARLY_CANCELS {
            registry.cancel(index.to_string());
        }

        // Cancelling an id already queued neither reorders nor evicts.
        registry.cancel("0".into());
        assert_eq!(registry.pending, MAX_EARLY_CANCELS);

        registry.cancel("overflow".into());

        assert_eq!(registry.pending, MAX_EARLY_CANCELS);
        assert!(!registry.start("0").load(Ordering::Relaxed));
        assert!(registry.start("1").load(Ordering::Relaxed));
        assert!(registry.start("overflow").load(Ordering::Relaxed));
    }

    #[test]
    fn window_state_keeps_a_valid_geometry() {
        let state =
            parse_window_state(r#"{"x":120,"y":80,"width":1280,"height":720,"maximized":true}"#)
                .unwrap();

        assert_eq!(
            state,
            WindowState {
                x: 120,
                y: 80,
                width: 1280,
                height: 720,
                maximized: true,
            }
        );
    }

    #[test]
    fn window_state_clamps_an_unbounded_size() {
        let state = parse_window_state(r#"{"x":0,"y":0,"width":99999,"height":1}"#).unwrap();

        assert_eq!(state.width, MAX_WINDOW_SIDE);
        assert_eq!(state.height, MIN_WINDOW_HEIGHT);
    }

    #[test]
    fn window_state_rejects_a_corrupt_or_empty_file() {
        assert!(parse_window_state("not json").is_none());
        assert!(parse_window_state(r#"{"x":0,"y":0,"width":0,"height":700}"#).is_none());
    }

    #[test]
    fn a_saved_position_on_a_connected_monitor_is_restored() {
        let monitors = [ScreenRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }];
        let state = WindowState {
            x: 100,
            y: 100,
            width: 1200,
            height: 800,
            maximized: false,
        };

        assert!(visibly_on_screen(&state, &monitors));
    }

    #[test]
    fn a_saved_position_off_every_monitor_is_dropped() {
        let monitors = [ScreenRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }];
        let state = WindowState {
            x: 5000,
            y: 5000,
            width: 1200,
            height: 800,
            maximized: false,
        };

        assert!(!visibly_on_screen(&state, &monitors));
    }
}
