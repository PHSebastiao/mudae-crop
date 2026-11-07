import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadDir, join } from '@tauri-apps/api/path';
import {
  emptyDocument,
  frameFor,
  orientationOf,
  outputSize,
  presetOf,
  swappedFrame,
  withCrop,
  withExportScale,
  withFrame,
  withPadColor,
  withSource,
  type DocumentState,
  type ExportScale,
  type Frame,
  type ScaleMode,
} from './core/document';
import {
  DownloadError,
  downloadErrorMessage,
  downloadSource,
  formatBytes,
  sourceUrlFrom,
} from './core/download';
import { renderPng } from './core/export';
import { clampCrop, panBy, resetCrop, rotate90, setScaleMode, zoomAt } from './core/geometry';
import { importErrorMessage, loadSource, type SourceCandidate } from './core/import';
import { appendUpload, type UploadRecord } from './core/history';
import {
  ImageChestError,
  isPostId,
  testConnection,
  uploadErrorMessage,
  uploadStill,
} from './core/imagechest';
import { exportFileName, postTitle } from './core/naming';
import { loadHistory, loadSettings, saveHistory, saveSettings } from './core/config';
import { DEFAULT_SETTINGS, type Settings } from './core/settings';
import { browserExportAdapter, decodeWithBrowser } from './platform/browser';
import { configStore } from './platform/config';
import { tauriImageChestTransport } from './platform/imagechest';
import { copyText, openExternal } from './platform/system';
import {
  chooseExportFolder,
  chooseExportPath,
  chooseSourceFile,
  fileNameOf,
  folderOf,
  isDesktop,
  readFileBytes,
  tauriDownloadTransport,
  watchFileDrops,
  writeFileBytes,
} from './platform/tauri';
import { Stage } from './components/Stage';
import { ToolRail } from './components/ToolRail';
import { ExportPanel } from './components/ExportPanel';
import { BorderBar } from './components/BorderBar';
import { SettingsDialog, type TokenTestResult } from './components/SettingsDialog';

interface NoticeAction {
  readonly label: string;
  readonly run: () => void;
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return 'Algo deu errado.';
}

export default function App() {
  const [doc, setDoc] = useState<DocumentState>(emptyDocument);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [noticeAction, setNoticeAction] = useState<NoticeAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<readonly UploadRecord[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testingToken, setTestingToken] = useState(false);
  const [tokenResult, setTokenResult] = useState<TokenTestResult | null>(null);
  const [appendPostId, setAppendPostId] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState<{
    received: number;
    total: number | null;
  } | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const runningRef = useRef(false);
  const cancelDownloadRef = useRef<(() => void) | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const historyRef = useRef<readonly UploadRecord[]>(history);
  historyRef.current = history;
  const appendPostIdRef = useRef(appendPostId);
  appendPostIdRef.current = appendPostId;
  const uploadRef = useRef<() => Promise<void>>(async () => undefined);

  const openSettings = useCallback(() => {
    setNoticeAction(null);
    setError(null);
    setSettingsOpen(true);
  }, []);

  const fail = useCallback((message: string, action: NoticeAction | null = null) => {
    setError(message);
    setStatus(null);
    setNoticeAction(action);
  }, []);

  const inform = useCallback((message: string) => {
    setError(null);
    setStatus(message);
    setNoticeAction(null);
  }, []);

  const beginRun = useCallback(() => {
    if (runningRef.current) return false;
    runningRef.current = true;
    setBusy(true);
    return true;
  }, []);

  const endRun = useCallback(() => {
    runningRef.current = false;
    setBusy(false);
  }, []);

  const persistSettings = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      if (patch.exportScale !== undefined) {
        setDoc((current) => withExportScale(current, patch.exportScale as ExportScale));
      }
      if (patch.token !== undefined) setTokenResult(null);
      void saveSettings(configStore, next).catch((reason) => {
        fail(`Não foi possível salvar as Configurações. ${messageOf(reason)}`);
      });
    },
    [fail],
  );

  const persistHistory = useCallback(
    (next: readonly UploadRecord[]) => {
      historyRef.current = next;
      setHistory(next);
      void saveHistory(configStore, next).catch((reason) => {
        fail(`Não foi possível salvar o Histórico. ${messageOf(reason)}`);
      });
    },
    [fail],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [savedSettings, savedHistory] = await Promise.all([
        loadSettings(configStore),
        loadHistory(configStore),
      ]);
      if (!alive) return;
      settingsRef.current = savedSettings;
      setSettings(savedSettings);
      historyRef.current = savedHistory;
      setHistory(savedHistory);
      appendPostIdRef.current = savedSettings.appendPostId;
      setAppendPostId(savedSettings.appendPostId);
      setDoc((current) => withExportScale(current, savedSettings.exportScale));
    })().catch((reason) => {
      if (!alive) return;
      fail(`Não foi possível ler as Configurações; usando os padrões. ${messageOf(reason)}`);
    });
    return () => {
      alive = false;
    };
  }, [fail]);

  const refuseBecauseBusy = useCallback(() => {
    fail('Termine a operação em andamento antes de importar outra Source.');
  }, [fail]);

  const applyCandidate = useCallback(
    async (candidate: SourceCandidate) => {
      const source = await loadSource(candidate, decodeWithBrowser);
      setDoc((current) => withSource(current, source));
      inform(`Source carregada: ${source.name}`);
    },
    [inform],
  );

  const importCandidate = useCallback(
    async (candidate: SourceCandidate) => {
      if (!beginRun()) {
        refuseBecauseBusy();
        return;
      }
      try {
        await applyCandidate(candidate);
      } catch (reason) {
        fail(importErrorMessage(reason));
      } finally {
        endRun();
      }
    },
    [applyCandidate, beginRun, endRun, fail, refuseBecauseBusy],
  );

  const importPath = useCallback(
    async (path: string) => {
      if (!beginRun()) {
        refuseBecauseBusy();
        return;
      }
      const name = fileNameOf(path);
      try {
        let bytes: Uint8Array;
        try {
          bytes = await readFileBytes(path);
        } catch (reason) {
          fail(`Não foi possível ler "${name}". ${messageOf(reason)}`);
          return;
        }
        try {
          await applyCandidate({ name, path, bytes });
        } catch (reason) {
          fail(importErrorMessage(reason));
        }
      } finally {
        endRun();
      }
    },
    [applyCandidate, beginRun, endRun, fail, refuseBecauseBusy],
  );

  const importFromUrl = useCallback(
    async (raw: string) => {
      if (!isDesktop()) {
        fail('Importar por link só funciona no app desktop.');
        return;
      }
      if (!beginRun()) {
        refuseBecauseBusy();
        return;
      }

      const controller = new AbortController();
      cancelDownloadRef.current = () => controller.abort();
      setError(null);
      setStatus(null);
      setNoticeAction(null);
      setDownloadProgress({ received: 0, total: null });
      try {
        const candidate = await downloadSource(raw, {
          transport: tauriDownloadTransport,
          signal: controller.signal,
          onProgress: (progress) => setDownloadProgress(progress),
        });
        // The link is down; decoding is local and no longer cancellable.
        cancelDownloadRef.current = null;
        setDownloadProgress(null);
        await applyCandidate(candidate);
        setLink('');
      } catch (reason) {
        if (reason instanceof DownloadError && reason.code === 'cancelled') {
          inform('Download cancelado.');
        } else {
          fail(downloadErrorMessage(reason));
        }
      } finally {
        cancelDownloadRef.current = null;
        setDownloadProgress(null);
        endRun();
      }
    },
    [applyCandidate, beginRun, endRun, fail, inform, refuseBecauseBusy],
  );

  const cancelDownload = useCallback(() => {
    cancelDownloadRef.current?.();
  }, []);

  const handleOpen = useCallback(async () => {
    if (runningRef.current) return;
    try {
      if (!isDesktop()) {
        fail('Abrir arquivos só funciona no app desktop.');
        return;
      }
      const path = await chooseSourceFile();
      if (path) await importPath(path);
    } catch (reason) {
      fail(`Não foi possível abrir o diálogo de arquivos. ${messageOf(reason)}`);
    }
  }, [fail, importPath]);

  const handleExport = useCallback(async () => {
    const current = docRef.current;
    if (!current.source) return;
    if (!isDesktop()) {
      fail('Exportar só funciona no app desktop.');
      return;
    }
    if (!beginRun()) return;
    try {
      const name = exportFileName(current.source.name, current.frame.id, new Date());
      let defaultPath = name;
      try {
        const folder = settingsRef.current.saveFolder ?? (await downloadDir());
        defaultPath = await join(folder, name);
      } catch {
        // Without a known folder the bare file name still works.
      }
      const chosen = await chooseExportPath(defaultPath);
      if (!chosen) return;
      const path = /\.png$/i.test(chosen) ? chosen : `${chosen}.png`;
      if (current.source.path && path.toLowerCase() === current.source.path.toLowerCase()) {
        throw new Error('o Export não pode sobrescrever a Source. Escolha outro nome.');
      }
      const bytes = await renderPng(current, current.exportScale, browserExportAdapter);
      await writeFileBytes(path, bytes);

      // Remember the folder the user actually saved into, so the next dialog
      // opens there instead of Downloads.
      const folder = folderOf(path) || settingsRef.current.saveFolder;
      persistSettings({ saveFolder: folder, exportFormat: 'png' });

      const size = outputSize(current);
      inform(`PNG ${size.width}×${size.height} exportado: ${fileNameOf(path)}`);
    } catch (reason) {
      fail(`Não foi possível exportar o PNG. ${messageOf(reason)}`);
    } finally {
      endRun();
    }
  }, [beginRun, endRun, fail, inform, persistSettings]);

  const uploadFailure = useCallback(
    (reason: unknown) => {
      if (reason instanceof ImageChestError) {
        if (reason.code === 'unauthorized' || reason.code === 'no-token') {
          fail(reason.message, { label: 'Abrir Configurações', run: openSettings });
          return;
        }
        if (reason.code === 'offline') {
          fail(reason.message, {
            label: 'Tentar de novo',
            run: () => void uploadRef.current(),
          });
          return;
        }
        if (reason.code === 'rate-limited') {
          setCooldownSeconds(reason.retryAfterSeconds ?? 30);
          fail(reason.message);
          return;
        }
        fail(reason.message);
        return;
      }
      fail(uploadErrorMessage(reason));
    },
    [fail, openSettings],
  );

  const handleUpload = useCallback(async () => {
    const current = docRef.current;
    if (!current.source) return;
    // A double click or a repeated Ctrl+Enter never starts a second upload.
    if (runningRef.current) return;
    if (!isDesktop()) {
      fail('O upload só funciona no app desktop.');
      return;
    }

    const saved = settingsRef.current;
    if (!saved.token.trim()) {
      fail('Salve o token do Image Chest em Configurações antes de subir.', {
        label: 'Abrir Configurações',
        run: openSettings,
      });
      return;
    }

    const requestedPost = appendPostIdRef.current.trim();
    if (requestedPost && !isPostId(requestedPost)) {
      fail('O Post id aceita só letras e números.');
      return;
    }
    if (cooldownSeconds > 0) {
      fail(`Aguarde ${cooldownSeconds}s antes de subir de novo.`);
      return;
    }
    if (!beginRun()) return;

    setUploading(true);
    setError(null);
    setStatus(null);
    setNoticeAction(null);
    try {
      const size = outputSize(current);
      const bytes = await renderPng(current, current.exportScale, browserExportAdapter);
      const title = postTitle(current.source.name, size.width, size.height);
      const outcome = await uploadStill({
        transport: tauriImageChestTransport,
        token: saved.token,
        title,
        privacy: saved.defaultPrivacy,
        postId: requestedPost || null,
        file: {
          name: exportFileName(current.source.name, current.frame.id, new Date()),
          contentType: 'image/png',
          bytes,
        },
      });

      let copied = true;
      try {
        await copyText(outcome.link);
      } catch {
        copied = false;
      }

      const record: UploadRecord = {
        link: outcome.link,
        postId: outcome.postId,
        imageId: outcome.imageId,
        title,
        format: 'png',
        size: bytes.length,
        uploadedAt: new Date().toISOString(),
      };
      persistHistory(appendUpload(historyRef.current, record));
      persistSettings({ exportFormat: 'png' });
      inform(
        copied
          ? `Link copiado: ${outcome.link}`
          : `Export no Post ${outcome.postId}. Não foi possível copiar; use o Histórico.`,
      );
    } catch (reason) {
      uploadFailure(reason);
    } finally {
      setUploading(false);
      endRun();
    }
  }, [
    beginRun,
    cooldownSeconds,
    endRun,
    fail,
    inform,
    openSettings,
    persistHistory,
    persistSettings,
    uploadFailure,
  ]);

  uploadRef.current = handleUpload;

  const cooling = cooldownSeconds > 0;
  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  const clearToken = useCallback(() => {
    persistSettings({ token: '' });
    setTokenResult({ ok: true, message: 'Token removido deste computador.' });
    inform('Token do Image Chest removido.');
  }, [inform, persistSettings]);

  const chooseFolder = useCallback(async () => {
    if (!isDesktop()) {
      fail('A pasta só pode ser escolhida no app desktop.');
      return;
    }
    try {
      const folder = await chooseExportFolder();
      if (!folder) return;
      persistSettings({ saveFolder: folder });
      inform(`Pasta dos Exports: ${folder}`);
    } catch (reason) {
      fail(`Não foi possível escolher a pasta. ${messageOf(reason)}`);
    }
  }, [fail, inform, persistSettings]);

  const testToken = useCallback(async () => {
    if (testingToken) return;
    if (!isDesktop()) {
      setTokenResult({ ok: false, message: 'Testar o token só funciona no app desktop.' });
      return;
    }
    const token = settingsRef.current.token;
    if (!token.trim()) {
      setTokenResult({ ok: false, message: 'Cole o token antes de testar.' });
      return;
    }
    setTestingToken(true);
    setTokenResult(null);
    try {
      const account = await testConnection(tauriImageChestTransport, token);
      setTokenResult({ ok: true, message: `Conectado como ${account.name}.` });
    } catch (reason) {
      setTokenResult({ ok: false, message: uploadErrorMessage(reason) });
    } finally {
      setTestingToken(false);
    }
  }, [testingToken]);

  const changeAppendPostId = useCallback((value: string) => {
    setAppendPostId(value);
    appendPostIdRef.current = value;
  }, []);

  const commitAppendPostId = useCallback(() => {
    const trimmed = appendPostIdRef.current.trim();
    appendPostIdRef.current = trimmed;
    setAppendPostId(trimmed);
    if (trimmed !== settingsRef.current.appendPostId) {
      persistSettings({ appendPostId: isPostId(trimmed) ? trimmed : '' });
    }
  }, [persistSettings]);

  const copyHistoryLink = useCallback(
    async (value: string) => {
      try {
        await copyText(value);
        inform(`Link copiado: ${value}`);
      } catch (reason) {
        fail(`Não foi possível copiar o link. ${messageOf(reason)}`);
      }
    },
    [fail, inform],
  );

  const openHistoryLink = useCallback(
    async (value: string) => {
      try {
        await openExternal(value);
      } catch (reason) {
        fail(`Não foi possível abrir o link. ${messageOf(reason)}`);
      }
    },
    [fail],
  );

  const clearHistory = useCallback(() => {
    persistHistory([]);
    inform('Histórico de uploads limpo.');
  }, [inform, persistHistory]);

  const exportRef = useRef(handleExport);
  exportRef.current = handleExport;

  const applyFrame = useCallback((frame: Frame) => {
    setDoc((current) => {
      const next = withFrame(current, frame);
      // Rotated bounds and the mode scale move with the Frame, so keep the
      // pan inside whatever limits the new Frame allows.
      return withCrop(next, clampCrop(next, next.crop));
    });
  }, []);

  const changeMode = useCallback((mode: ScaleMode) => {
    setDoc((current) =>
      withCrop(current, clampCrop(current, setScaleMode(current.crop, mode))),
    );
  }, []);

  const changeZoom = useCallback((zoom: number) => {
    setDoc((current) => withCrop(current, clampCrop(current, { ...current.crop, zoom })));
  }, []);

  const changeOffset = useCallback((offsetX: number, offsetY: number) => {
    setDoc((current) =>
      withCrop(current, clampCrop(current, { ...current.crop, offsetX, offsetY })),
    );
  }, []);

  const changePadColor = useCallback((padColor: string) => {
    setDoc((current) => withPadColor(current, padColor));
  }, []);

  const changeExportScale = useCallback(
    (exportScale: ExportScale) => {
      persistSettings({ exportScale });
    },
    [persistSettings],
  );

  const rotate = useCallback(() => {
    setDoc((current) => withCrop(current, rotate90(current, current.crop)));
  }, []);

  const reset = useCallback(() => {
    setDoc((current) => withCrop(current, resetCrop(current.crop)));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'o') {
        event.preventDefault();
        void handleOpen();
      } else if (key === 's') {
        event.preventDefault();
        void exportRef.current();
      } else if (key === 'enter') {
        event.preventDefault();
        void uploadRef.current();
      } else if (key === ',') {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleOpen, openSettings, settingsOpen]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;

      for (const item of data.items) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) return;
        event.preventDefault();
        void file.arrayBuffer().then((buffer) =>
          importCandidate({
            name: file.name || 'clipboard.png',
            path: null,
            bytes: new Uint8Array(buffer),
          }),
        );
        return;
      }

      // Text pasted into a field stays an ordinary paste; only page-level
      // Ctrl+V turns a link into a Source.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const url = sourceUrlFrom(data.getData('text'));
      if (!url) return;
      event.preventDefault();
      void importFromUrl(url.href);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [importCandidate, importFromUrl]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    watchFileDrops((paths) => {
      const first = paths[0];
      if (first) void importPath(first);
    })
      .then((stop) => {
        dispose = stop;
      })
      .catch(() => {
        fail('Não foi possível ativar o arrastar e soltar. Use Ctrl+O ou Ctrl+V.');
      });
    return () => dispose?.();
  }, [fail, importPath]);

  // Browser-only fallback so `npm run dev` can exercise the same import path.
  // The desktop window receives OS drops through Tauri instead.
  useEffect(() => {
    if (isDesktop()) return;
    const onDragOver = (event: DragEvent) => event.preventDefault();
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      void file.arrayBuffer().then((buffer) =>
        importCandidate({
          name: file.name,
          path: null,
          bytes: new Uint8Array(buffer),
        }),
      );
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [importCandidate]);

  const sourceChip = doc.source
    ? `${doc.source.format.toUpperCase()} · ${doc.source.width}×${doc.source.height}`
    : 'sem Source';

  const clearNotice = () => {
    setError(null);
    setStatus(null);
    setNoticeAction(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">mudae crop</div>
        <form
          className="link-import"
          onSubmit={(event) => {
            event.preventDefault();
            void importFromUrl(link);
          }}
        >
          <input
            type="text"
            inputMode="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="cole um link de imagem"
            aria-label="Link da Source"
            spellCheck={false}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !sourceUrlFrom(link)}>
            Abrir link
          </button>
        </form>
        <div className="preset-toggle" role="group" aria-label="Preset do Frame">
          <button
            type="button"
            className={presetOf(doc.frame) === 'mudae' ? 'on' : ''}
            onClick={() => applyFrame(frameFor('mudae', orientationOf(doc.frame)))}
          >
            {presetOf(doc.frame) === 'mudae' ? doc.frame.label : 'Mudae 225×350'}
          </button>
          <button
            type="button"
            className={presetOf(doc.frame) === 'square' ? 'on' : ''}
            onClick={() => applyFrame(frameFor('square', 'portrait'))}
          >
            Square 350×350
          </button>
          <button
            type="button"
            onClick={() => applyFrame(swappedFrame(doc.frame))}
            disabled={presetOf(doc.frame) === 'square'}
            title="Trocar retrato e paisagem"
          >
            {orientationOf(doc.frame) === 'portrait' ? '↔ paisagem' : '↕ retrato'}
          </button>
        </div>
        <div className="topbar-right">
          <span className="chip">{sourceChip}</span>
          <span className="chip">waifu2x off</span>
          <button
            type="button"
            className="chip chip-button"
            onClick={openSettings}
            title="Configurações (Ctrl+,)"
          >
            Configurações
          </button>
        </div>
      </header>

      {downloadProgress ? (
        <div className="notice download" role="status">
          <span>
            Baixando link… {formatBytes(downloadProgress.received)}
            {downloadProgress.total ? ` de ${formatBytes(downloadProgress.total)}` : ''}
          </span>
          <progress
            value={downloadProgress.total ? downloadProgress.received : undefined}
            max={downloadProgress.total ?? undefined}
          />
          <button type="button" onClick={cancelDownload}>
            cancelar
          </button>
        </div>
      ) : (
        (error || status) && (
          <div className={`notice${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>
            <span>{error ?? status}</span>
            {noticeAction && (
              <button type="button" className="notice-action" onClick={noticeAction.run}>
                {noticeAction.label}
              </button>
            )}
            <button type="button" aria-label="Fechar aviso" onClick={clearNotice}>
              x
            </button>
          </div>
        )
      )}

      <main className="workspace">
        <ToolRail
          doc={doc}
          onMode={changeMode}
          onZoom={changeZoom}
          onOffset={changeOffset}
          onPadColor={changePadColor}
          onRotate={rotate}
          onResetCrop={reset}
        />
        <Stage
          doc={doc}
          onPan={(dx, dy) =>
            setDoc((current) =>
              current.source ? withCrop(current, panBy(current, current.crop, dx, dy)) : current,
            )
          }
          onZoomAt={(point, factor) =>
            setDoc((current) =>
              current.source
                ? withCrop(current, zoomAt(current, current.crop, current.crop.zoom * factor, point))
                : current,
            )
          }
          onOpen={handleOpen}
          busy={busy}
        />
        <ExportPanel
          doc={doc}
          busy={busy}
          downloading={downloadProgress !== null}
          uploading={uploading}
          settings={settings}
          history={history}
          cooldownSeconds={cooldownSeconds}
          appendPostId={appendPostId}
          onExport={handleExport}
          onExportScale={changeExportScale}
          onAppendPostId={changeAppendPostId}
          onCommitAppendPostId={commitAppendPostId}
          onUpload={handleUpload}
          onOpenSettings={openSettings}
          onCopyLink={(value) => void copyHistoryLink(value)}
          onOpenLink={(value) => void openHistoryLink(value)}
          onClearHistory={clearHistory}
        />
      </main>

      <BorderBar />

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          desktop={isDesktop()}
          testing={testingToken}
          testResult={tokenResult}
          onChange={persistSettings}
          onClose={() => setSettingsOpen(false)}
          onTestConnection={() => void testToken()}
          onClearToken={clearToken}
          onChooseFolder={() => void chooseFolder()}
          onClearFolder={() => persistSettings({ saveFolder: null })}
        />
      )}
    </div>
  );
}
