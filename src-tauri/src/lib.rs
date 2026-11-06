use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// The download ceiling matches Image Chest's 30 MB per-file limit, so a fetched
/// Source never exceeds what the upload path accepts. The front-end wrapper
/// enforces the same ceiling before decoding.
const MAX_DOWNLOAD_BYTES: u64 = 30 * 1024 * 1024;

#[derive(Default)]
struct DownloadRegistry {
    live: HashMap<String, Arc<AtomicBool>>,
    early_cancels: VecDeque<String>,
}

/// Cancellation flags for in-flight downloads, keyed by the id the front-end
/// chose. A cancel can arrive before its download starts, so early ids wait in
/// their own queue and never displace a live flag.
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

/// Read the bytes of a file the user picked in the native dialog. Returning a
/// raw Response keeps large GIFs out of the JSON IPC path.
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
    let cancelled = {
        let mut registry = downloads.lock();
        let early = registry
            .early_cancels
            .iter()
            .position(|id| id == &download_id);
        if let Some(index) = early {
            registry.early_cancels.remove(index);
        }
        let flag = Arc::new(AtomicBool::new(early.is_some()));
        registry.live.insert(download_id.clone(), flag.clone());
        flag
    };

    let outcome = stream_download(&app, &url, &download_id, &cancelled).await;

    downloads.lock().live.remove(&download_id);
    outcome.map(tauri::ipc::Response::new)
}

#[tauri::command(rename_all = "snake_case")]
fn cancel_download(downloads: State<'_, Downloads>, download_id: String) {
    let mut registry = downloads.lock();
    if let Some(flag) = registry.live.get(&download_id) {
        flag.store(true, Ordering::Relaxed);
        return;
    }
    if registry.early_cancels.iter().any(|id| id == &download_id) {
        return;
    }
    // A cancel whose download never starts is harmless, so the queue is bounded.
    if registry.early_cancels.len() >= 32 {
        registry.early_cancels.pop_front();
    }
    registry.early_cancels.push_back(download_id);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Downloads::default())
        .invoke_handler(tauri::generate_handler![
            read_file_bytes,
            write_file_bytes,
            download_source,
            cancel_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running mudae crop");
}
