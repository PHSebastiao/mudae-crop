use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// The download ceiling matches Image Chest's 30 MB per-file limit, so a fetched
/// Source never exceeds what the upload path accepts. The front-end wrapper
/// enforces the same ceiling before decoding.
const MAX_DOWNLOAD_BYTES: u64 = 30 * 1024 * 1024;

/// How many early cancels may wait for a download that never starts. A cancel
/// whose download never starts is harmless, so the oldest one is dropped.
const MAX_EARLY_CANCELS: usize = 32;

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
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Downloads::default())
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
            reveal_path
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
}
