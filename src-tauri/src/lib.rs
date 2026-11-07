use std::collections::{HashMap, VecDeque};
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

/// Settings and History live as JSON files in the app config directory. Only
/// the known keys map to files, so the front-end never chooses a path. `uploads`
/// stays readable so the pre-export History file is not lost.
fn config_file_name(key: &str) -> Option<&'static str> {
    match key {
        "settings" => Some("settings.json"),
        "history" => Some("history.json"),
        "uploads" => Some("uploads.json"),
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

/// Before the Local AppData override, config lived in
/// `{RoamingAppData}/{identifier}`. Copy each file once on first read, so an
/// update keeps the token and History. Best effort: a failed copy still lets
/// the read return the legacy contents.
fn legacy_config_path(root: &Path, identifier: &str, file: &str) -> PathBuf {
    root.join(identifier).join(file)
}

fn migrate_legacy_config(
    app: &AppHandle,
    key: &str,
    destination: &Path,
) -> Result<Option<String>, String> {
    let Some(file) = config_file_name(key) else {
        return Ok(None);
    };
    let Ok(legacy_root) = app.path().config_dir() else {
        return Ok(None);
    };
    let legacy = legacy_config_path(&legacy_root, app.config().identifier.as_str(), file);
    let Ok(contents) = std::fs::read_to_string(&legacy) else {
        return Ok(None);
    };
    if let Some(parent) = destination.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(destination, &contents);
    Ok(Some(contents))
}

#[tauri::command]
fn read_config(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = config_path(&app, &key)?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            migrate_legacy_config(&app, &key, &path)
        }
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
        assert_eq!(config_file_name("uploads"), Some("uploads.json"));
        assert_eq!(config_file_name("../settings"), None);
        assert_eq!(config_file_name("other"), None);
    }

    #[test]
    fn legacy_config_path_is_identifier_under_root() {
        let root = Path::new("roaming");
        assert_eq!(
            legacy_config_path(root, "com.phsebastiao.mudaecrop", "settings.json"),
            Path::new("roaming")
                .join("com.phsebastiao.mudaecrop")
                .join("settings.json")
        );
    }
}
