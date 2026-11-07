import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadDir, join } from '@tauri-apps/api/path';
import {
  animationFrameCount,
  clampBorderWidth,
  effectiveDelayMs,
  effectiveTrim,
  emptyDocument,
  frameFor,
  isAnimated,
  orientationOf,
  outputSize,
  presetOf,
  swappedFrame,
  trimFrameCount,
  withBorder,
  withCrop,
  withExportScale,
  withFrame,
  withOptimize,
  withPadColor,
  withResize,
  withResizeLocked,
  withSharpness,
  withSource,
  withSpeed,
  withTrim,
  withTrimEnabled,
  type DocumentState,
  type ExportScale,
  type Frame,
  type OptimizeSettings,
  type ScaleMode,
  type Trim,
} from './core/document';
import { normalizeHexColor } from './core/color';
import { formatFps, formatPlaybackDuration, trimDurationMs, videoPreviewRate } from './core/animation';
import {
  DownloadError,
  downloadErrorMessage,
  downloadSource,
  formatBytes,
  sourceUrlFrom,
} from './core/download';
import {
  exportKindFor,
  prepareFrame as prepareExportFrame,
  renderGif,
  renderPng,
  ExportError,
  type RenderProgress,
} from './core/export';
import type { OptimizeResult } from './core/optimize';
import {
  applyScaleMode,
  clampCrop,
  panBy,
  resetCrop,
  rotate90,
  zoomAt,
} from './core/geometry';
import {
  importErrorMessage,
  loadSource,
  localPathFrom,
  type SourceCandidate,
} from './core/import';
import { extractPalette, type PaletteColor } from './core/palette';
import {
  appendHistory,
  type ExportEntry,
  type HistoryEntry,
  type UploadEntry,
} from './core/history';
import { createHistoryPreviewLoader } from './core/historyPreview';
import {
  IMAGE_CHEST_API_KEY_URL,
  ImageChestError,
  isPostId,
  testConnection,
  uploadErrorMessage,
  uploadStill,
} from './core/imagechest';
import { exportFileName, postTitle } from './core/naming';
import { loadHistory, loadSettings, saveHistory, saveSettings } from './core/config';
import { DEFAULT_SETTINGS, type ExportFormat, type Settings } from './core/settings';
import { browserExportAdapter, browserPaletteAdapter, decodeWithBrowser } from './platform/browser';
import { configStore } from './platform/config';
import { gifsicleOptimizer } from './platform/gifOptimizer';
import { tauriImageChestTransport } from './platform/imagechest';
import { historyPreviewAdapter, readExportBytes } from './platform/historyPreview';
import { copyText, openExternal, revealInExplorer } from './platform/system';
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
import { Timeline } from './components/Timeline';
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
  const [history, setHistory] = useState<readonly HistoryEntry[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testingToken, setTestingToken] = useState(false);
  const [tokenResult, setTokenResult] = useState<TokenTestResult | null>(null);
  const [appendPostId, setAppendPostId] = useState('');
  const [palette, setPalette] = useState<readonly PaletteColor[]>([]);
  const [paletteVersion, setPaletteVersion] = useState(0);
  const [pickTarget, setPickTarget] = useState<'pad' | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState<{
    received: number;
    total: number | null;
  } | null>(null);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameVersion, setFrameVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const runningRef = useRef(false);
  const cancelDownloadRef = useRef<(() => void) | null>(null);
  const cancelRenderRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const historyRef = useRef<readonly HistoryEntry[]>(history);
  historyRef.current = history;
  const appendPostIdRef = useRef(appendPostId);
  appendPostIdRef.current = appendPostId;
  const uploadRef = useRef<() => Promise<void>>(async () => undefined);

  // One loader owns the Export thumbnails and their object URLs. It is keyed by
  // path + size, so re-renders reuse a read and a replaced file is read again.
  const historyPreview = useMemo(
    () => createHistoryPreviewLoader({ read: readExportBytes, adapter: historyPreviewAdapter }),
    [],
  );

  const openSettings = useCallback(() => {
    setPickTarget(null);
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
      const borderColor =
        patch.borderColor !== undefined
          ? (normalizeHexColor(patch.borderColor) ?? settingsRef.current.borderColor)
          : settingsRef.current.borderColor;
      const borderWidth =
        patch.borderWidth !== undefined
          ? clampBorderWidth(patch.borderWidth)
          : settingsRef.current.borderWidth;
      const next: Settings = { ...settingsRef.current, ...patch, borderColor, borderWidth };
      settingsRef.current = next;
      setSettings(next);
      if (patch.exportScale !== undefined) {
        setDoc((current) => withExportScale(current, patch.exportScale as ExportScale));
      }
      if (patch.borderColor !== undefined || patch.borderWidth !== undefined) {
        setDoc((current) =>
          withBorder(current, {
            color: borderColor,
            width: borderWidth,
          }),
        );
      }
      if (patch.token !== undefined) setTokenResult(null);
      void saveSettings(configStore, next).catch((reason) => {
        fail(`Não foi possível salvar as Configurações. ${messageOf(reason)}`);
      });
    },
    [fail],
  );

  const persistHistory = useCallback(
    (next: readonly HistoryEntry[]) => {
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
      setDoc((current) =>
        withBorder(withExportScale(current, savedSettings.exportScale), {
          color: savedSettings.borderColor,
          width: savedSettings.borderWidth,
        }),
      );
    })().catch((reason) => {
      if (!alive) return;
      fail(`Não foi possível ler as Configurações; usando os padrões. ${messageOf(reason)}`);
    });
    return () => {
      alive = false;
    };
  }, [fail]);

  // The Palette follows the Crop, Frame, Pad color and sharpness. It is
  // debounced so dragging or zooming does not sample on every pointer move,
  // and the Border is deliberately not a dependency.
  useEffect(() => {
    if (!doc.source) {
      setPalette([]);
      return;
    }
    const timer = setTimeout(() => {
      try {
        setPalette(extractPalette(docRef.current, browserPaletteAdapter));
      } catch {
        setPalette([]);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [
    doc.source,
    doc.frame,
    doc.crop,
    doc.padColor,
    doc.sharpness,
    doc.trim,
    doc.trimEnabled,
    paletteVersion,
  ]);

  const activeTrim = useMemo(
    () => effectiveTrim(doc),
    [doc.source, doc.trim, doc.trimEnabled],
  );

  // Keep the visible frame inside a Trim that just moved, and never play a still.
  useEffect(() => {
    const trim = effectiveTrim(docRef.current);
    if (!trim) {
      setPlaying(false);
      setFrameIndex(0);
      return;
    }
    setFrameIndex((current) => Math.min(trim.end, Math.max(trim.start, current)));
  }, [doc.source, doc.trim, doc.trimEnabled]);

  // Seeking while paused is what makes scrub, Trim and PNG export agree.
  useEffect(() => {
    const video = doc.source?.video;
    if (!video || playing) return;
    let alive = true;
    void video.seekToFrame(frameIndex).then(() => {
      if (alive) setFrameVersion((value) => value + 1);
    });
    return () => {
      alive = false;
    };
  }, [doc.source, frameIndex, playing]);

  // GIF playback advances at the frame's own delay, scaled by the speed.
  useEffect(() => {
    const source = doc.source;
    const trim = activeTrim;
    if (!playing || !source || source.video || !trim) return;
    const current = Math.min(trim.end, Math.max(trim.start, frameIndex));
    const timer = setTimeout(() => {
      setFrameIndex(current >= trim.end ? trim.start : current + 1);
    }, effectiveDelayMs(source, current, doc.speed));
    return () => clearTimeout(timer);
  }, [activeTrim, playing, frameIndex, doc.source, doc.speed]);

  // Video preview uses native playback; rAF only moves the in-app playhead.
  useEffect(() => {
    const video = doc.source?.video;
    const trim = activeTrim;
    if (!playing || !video || !trim) {
      video?.pause();
      return;
    }
    const rate = videoPreviewRate(doc.source, doc.speed);
    video.play(rate);
    let frame = 0;
    let cancelled = false;
    const tick = () => {
      const endMs = Math.min(video.durationMs, ((trim.end + 1) / video.fps) * 1000);
      const startMs = (trim.start / video.fps) * 1000;
      if (video.currentTimeMs >= endMs - 1) {
        void video.seekToMs(startMs).then(() => {
          if (!cancelled) video.play(rate);
        });
      }
      setFrameIndex(
        Math.min(
          trim.end,
          Math.max(trim.start, Math.floor((video.currentTimeMs / 1000) * video.fps)),
        ),
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      video.pause();
    };
  }, [activeTrim, playing, doc.source, doc.speed]);

  useEffect(() => () => docRef.current.source?.video?.dispose(), []);

  const refuseBecauseBusy = useCallback(() => {
    fail('Termine a operação em andamento antes de importar outra Source.');
  }, [fail]);

  const applyCandidate = useCallback(
    async (candidate: SourceCandidate) => {
      const source = await loadSource(candidate, decodeWithBrowser);
      docRef.current.source?.video?.dispose();
      setPickTarget(null);
      setPlaying(false);
      setFrameIndex(0);
      setOptimizeResult(null);
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

  /** The Source bar takes a link or a local path; Enter and the button share this. */
  const submitLink = useCallback(() => {
    const url = sourceUrlFrom(link);
    if (url) {
      void importFromUrl(url.href);
      return;
    }
    const path = localPathFrom(link);
    if (!path) {
      fail(
        'Cole um link http(s) ou o caminho de um arquivo PNG, JPG, GIF, WebP, APNG, MP4, MOV ou WebM.',
      );
      return;
    }
    if (!isDesktop()) {
      fail('Importar por caminho de arquivo só funciona no app desktop.');
      return;
    }
    void importPath(path);
  }, [fail, importFromUrl, importPath, link]);

  const renderForExport = useCallback(
    async (
      current: DocumentState,
      controller: AbortController,
      selectedFrame: number,
    ): Promise<Uint8Array> => {
      const kind = exportKindFor(current.source, settingsRef.current.exportFormat);
      if (kind.format === 'png') {
        return renderPng(current, browserExportAdapter, {
          frameIndex: selectedFrame,
          prepare: () => prepareExportFrame(current.source, selectedFrame),
        });
      }
      setRenderProgress({
        phase: 'render',
        done: 0,
        total: trimFrameCount(current.source, effectiveTrim(current)),
      });
      return renderGif(current, browserExportAdapter, {
        signal: controller.signal,
        onProgress: setRenderProgress,
        optimizer: gifsicleOptimizer,
        onOptimized: setOptimizeResult,
      });
    },
    [],
  );

  const renderWithProgress = useCallback(
    async (current: DocumentState, selectedFrame: number): Promise<Uint8Array> => {
      const controller = new AbortController();
      cancelRenderRef.current = controller;
      setPlaying(false);
      setOptimizeResult(null);
      try {
        return await renderForExport(current, controller, selectedFrame);
      } finally {
        cancelRenderRef.current = null;
        setRenderProgress(null);
      }
    },
    [renderForExport],
  );

  const cancelRender = useCallback(() => {
    cancelRenderRef.current?.abort();
  }, []);

  const handleExport = useCallback(async () => {
    const current = docRef.current;
    if (!current.source) return;
    if (!isDesktop()) {
      fail('Exportar só funciona no app desktop.');
      return;
    }
    if (!beginRun()) return;
    const kind = exportKindFor(current.source, settingsRef.current.exportFormat);
    const extension = kind.format;
    const label = kind.label;
    try {
      const name = exportFileName(current.source.name, current.frame.id, new Date(), extension);
      let defaultPath = name;
      try {
        const folder = settingsRef.current.saveFolder ?? (await downloadDir());
        defaultPath = await join(folder, name);
      } catch {
        // Without a known folder the bare file name still works.
      }
      const chosen = await chooseExportPath(defaultPath, extension);
      if (!chosen) return;
      const suffix = new RegExp(`\\.${extension}$`, 'i');
      const path = suffix.test(chosen) ? chosen : `${chosen}.${extension}`;
      if (current.source.path && path.toLowerCase() === current.source.path.toLowerCase()) {
        throw new Error('o Export não pode sobrescrever a Source. Escolha outro nome.');
      }

      const bytes = await renderWithProgress(current, frameIndex);
      await writeFileBytes(path, bytes);

      // Remember the folder the user actually saved into, so the next dialog
      // opens there instead of Downloads.
      const folder = folderOf(path) || settingsRef.current.saveFolder;
      persistSettings({ saveFolder: folder });

      const size = outputSize(current);
      const entry: ExportEntry = {
        kind: 'export',
        path,
        fileName: fileNameOf(path),
        title: postTitle(current.source.name, size.width, size.height),
        format: extension,
        size: bytes.length,
        width: size.width,
        height: size.height,
        createdAt: new Date().toISOString(),
      };
      persistHistory(appendHistory(historyRef.current, entry));
      inform(`${label} ${size.width}×${size.height} exportado: ${fileNameOf(path)}`);
    } catch (reason) {
      if (reason instanceof ExportError && reason.cancelled) {
        inform('Render cancelado. A Source continua carregada.');
      } else {
        fail(`Não foi possível exportar o ${label}. ${messageOf(reason)}`);
      }
    } finally {
      setRenderProgress(null);
      endRun();
    }
  }, [
    beginRun,
    endRun,
    fail,
    frameIndex,
    inform,
    persistHistory,
    persistSettings,
    renderWithProgress,
  ]);

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

    const kind = exportKindFor(current.source, settingsRef.current.exportFormat);
    const extension = kind.format;
    const contentType = kind.contentType;

    setUploading(true);
    setError(null);
    setStatus(null);
    setNoticeAction(null);
    try {
      const bytes = await renderWithProgress(current, frameIndex);
      const size = outputSize(current);
      const title = postTitle(current.source.name, size.width, size.height);
      const outcome = await uploadStill({
        transport: tauriImageChestTransport,
        token: saved.token,
        title,
        privacy: saved.defaultPrivacy,
        postId: requestedPost || null,
        file: {
          name: exportFileName(current.source.name, current.frame.id, new Date(), extension),
          contentType,
          bytes,
        },
      });

      let copied = true;
      try {
        await copyText(outcome.link);
      } catch {
        copied = false;
      }

      const record: UploadEntry = {
        kind: 'upload',
        link: outcome.link,
        postId: outcome.postId,
        imageId: outcome.imageId,
        title,
        format: extension,
        size: bytes.length,
        createdAt: new Date().toISOString(),
      };
      persistHistory(appendHistory(historyRef.current, record));
      inform(
        copied
          ? `Link copiado: ${outcome.link}`
          : `Export no Post ${outcome.postId}. Não foi possível copiar; use o Histórico.`,
      );
    } catch (reason) {
      if (reason instanceof ExportError && reason.cancelled) {
        inform('Render cancelado. A Source continua carregada.');
      } else {
        uploadFailure(reason);
      }
    } finally {
      setRenderProgress(null);
      setUploading(false);
      endRun();
    }
  }, [
    beginRun,
    cooldownSeconds,
    endRun,
    fail,
    frameIndex,
    inform,
    openSettings,
    persistHistory,
    renderWithProgress,
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

  const copyValue = useCallback(
    async (value: string) => {
      try {
        await copyText(value);
        inform(`Copiado: ${value}`);
      } catch (reason) {
        fail(`Não foi possível copiar. ${messageOf(reason)}`);
      }
    },
    [fail, inform],
  );

  const openLink = useCallback(
    async (value: string) => {
      try {
        await openExternal(value);
      } catch (reason) {
        fail(`Não foi possível abrir o link. ${messageOf(reason)}`);
      }
    },
    [fail],
  );

  const revealHistoryFile = useCallback(
    async (path: string) => {
      try {
        await revealInExplorer(path);
      } catch (reason) {
        fail(`Não foi possível abrir no Explorador. ${messageOf(reason)}`);
      }
    },
    [fail],
  );

  const clearHistory = useCallback(() => {
    persistHistory([]);
    inform('Histórico limpo.');
  }, [inform, persistHistory]);

  const exportRef = useRef(handleExport);
  exportRef.current = handleExport;

  const applyFrame = useCallback((frame: Frame) => {
    setPickTarget(null);
    setDoc((current) => {
      const next = withFrame(current, frame);
      // Rotated bounds and the mode scale move with the Frame, so keep the
      // pan inside whatever limits the new Frame allows.
      return withCrop(next, clampCrop(next, next.crop));
    });
  }, []);

  const changeMode = useCallback((mode: ScaleMode) => {
    setDoc((current) => applyScaleMode(current, mode));
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
    setPickTarget(null);
    setDoc((current) => withPadColor(current, padColor));
  }, []);

  const togglePickPad = useCallback(() => {
    setPickTarget((current) => (current === 'pad' ? null : 'pad'));
  }, []);

  const pickPadColor = useCallback(
    (hex: string) => {
      setDoc((current) => withPadColor(current, hex));
      setPickTarget(null);
      inform(`Cor do Pad: ${hex}`);
    },
    [inform],
  );

  const pickPadMiss = useCallback(
    (reason: 'outside' | 'transparent') => {
      inform(
        reason === 'transparent'
          ? 'Essa área é transparente. Escolha outro ponto.'
          : 'Clique dentro do Frame para pegar uma cor.',
      );
    },
    [inform],
  );

  const changeSharpness = useCallback((sharpness: number) => {
    setDoc((current) => withSharpness(current, sharpness));
  }, []);

  const changeTrim = useCallback((trim: Trim | null) => {
    setPlaying(false);
    setOptimizeResult(null);
    setDoc((current) => withTrim(current, trim));
  }, []);

  const changeTrimEnabled = useCallback((trimEnabled: boolean) => {
    setPlaying(false);
    setOptimizeResult(null);
    setDoc((current) => withTrimEnabled(current, trimEnabled));
  }, []);

  const changeSpeed = useCallback((speed: number) => {
    setPlaying(false);
    setOptimizeResult(null);
    setDoc((current) => withSpeed(current, speed));
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((current) => !current);
  }, []);

  const scrubFrame = useCallback((index: number) => {
    setPlaying(false);
    setFrameIndex(index);
  }, []);

  const changeResizeWidth = useCallback((width: number) => {
    setOptimizeResult(null);
    setDoc((current) => {
      const size = outputSize(current);
      return withResize(current, {
        width,
        height: current.resize?.height ?? size.height,
      });
    });
  }, []);

  const changeResizeHeight = useCallback((height: number) => {
    setOptimizeResult(null);
    setDoc((current) => {
      const size = outputSize(current);
      const width = current.resizeLocked
        ? Math.round((height * current.frame.width) / current.frame.height)
        : (current.resize?.width ?? size.width);
      return withResize(current, { width, height });
    });
  }, []);

  const changeResizeLocked = useCallback((resizeLocked: boolean) => {
    setDoc((current) => withResizeLocked(current, resizeLocked));
  }, []);

  const changeOptimize = useCallback((patch: Partial<OptimizeSettings>) => {
    setOptimizeResult(null);
    setDoc((current) => withOptimize(current, patch));
  }, []);

  const recalcPalette = useCallback(() => {
    setPaletteVersion((value) => value + 1);
  }, []);

  const changeExportScale = useCallback(
    (exportScale: ExportScale) => {
      setOptimizeResult(null);
      persistSettings({ exportScale });
    },
    [persistSettings],
  );

  const changeExportFormat = useCallback(
    (exportFormat: ExportFormat) => {
      setOptimizeResult(null);
      persistSettings({ exportFormat });
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
      if (event.key === 'Escape' && pickTarget !== null) {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return;
        }
        event.preventDefault();
        setPickTarget(null);
        return;
      }
      if (settingsOpen) return;
      if (event.key === ' ' && isAnimated(doc.source)) {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'BUTTON' ||
            target.isContentEditable)
        ) {
          return;
        }
        event.preventDefault();
        togglePlay();
        return;
      }
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
  }, [doc.source, handleOpen, openSettings, pickTarget, settingsOpen, togglePlay]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;

      for (const item of data.items) {
        if (item.kind !== 'file' || !/^(image|video)\//.test(item.type)) continue;
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
      // Ctrl+V turns a link or a local path into a Source.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const text = data.getData('text');
      const url = sourceUrlFrom(text);
      if (url) {
        event.preventDefault();
        void importFromUrl(url.href);
        return;
      }
      // "Copy as path" in Explorer pastes a quoted local path; open it directly.
      const path = localPathFrom(text);
      if (path && isDesktop()) {
        event.preventDefault();
        void importPath(path);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [importCandidate, importFromUrl, importPath]);

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

  const sourceAnimated = isAnimated(doc.source);
  const sourceChip = doc.source
    ? `${doc.source.format.toUpperCase()} · ${doc.source.width}×${doc.source.height} · ${formatBytes(
        doc.source.bytes,
      )} · ${
        doc.source.video
          ? `vídeo ${formatFps(doc.source.video.fps)} fps · ${formatPlaybackDuration(doc.source.video.durationMs)}`
          : sourceAnimated
            ? `animado ${animationFrameCount(doc.source)}f`
            : 'estático'
      }`
    : 'sem Source';

  /** What the Source bar currently holds, so the button can name the action. */
  const linkTarget = sourceUrlFrom(link) ? 'link' : localPathFrom(link) ? 'path' : null;

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
            submitLink();
          }}
        >
          <input
            type="text"
            inputMode="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="link ou caminho de arquivo"
            aria-label="Link ou caminho da Source"
            spellCheck={false}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !linkTarget}>
            {linkTarget === 'path' ? 'Abrir arquivo' : 'Abrir link'}
          </button>
          <button
            type="button"
            className="link-import-browse"
            onClick={() => void handleOpen()}
            disabled={busy}
            aria-label="Abrir arquivo do computador"
            title="Abrir arquivo do computador (Ctrl+O)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M1.75 3.25h4l1.5 1.5h6.75v7.5a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1-.75-.75V3.25Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
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
      ) : renderProgress ? (
        <div className="notice download render" role="status">
          <span>
            {renderProgress.phase === 'render' ? 'Renderizando' : 'Otimizando'} GIF…{' '}
            {renderProgress.total > 0
              ? Math.min(100, Math.round((renderProgress.done / renderProgress.total) * 100))
              : 0}
            %
          </span>
          <progress value={renderProgress.done} max={renderProgress.total} />
          <button type="button" onClick={cancelRender}>
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
          onSharpness={changeSharpness}
          onPickPadColor={togglePickPad}
          onTrim={changeTrim}
          onSpeed={changeSpeed}
          pickingPad={pickTarget === 'pad'}
        />
        <div className="stage-column">
          <Stage
            doc={doc}
            frameIndex={frameIndex}
            frameVersion={frameVersion}
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
            picking={pickTarget === 'pad'}
            onPickColor={pickPadColor}
            onPickMiss={pickPadMiss}
          />
          {sourceAnimated && (
            <Timeline
              frameIndex={frameIndex}
              frameCount={animationFrameCount(doc.source)}
              trim={activeTrim ?? { start: 0, end: 0 }}
              trimEnabled={doc.trimEnabled}
              durationMs={trimDurationMs(doc.source, activeTrim, doc.speed)}
              playing={playing}
              disabled={busy}
              onScrub={scrubFrame}
              onTogglePlay={togglePlay}
              onTrimEnabled={changeTrimEnabled}
              onTrimChange={changeTrim}
            />
          )}
        </div>
        <ExportPanel
          doc={doc}
          busy={busy}
          downloading={downloadProgress !== null}
          uploading={uploading}
          settings={settings}
          history={history}
          preview={historyPreview}
          cooldownSeconds={cooldownSeconds}
          appendPostId={appendPostId}
          optimizeResult={optimizeResult}
          onExport={handleExport}
          onExportScale={changeExportScale}
          onExportFormat={changeExportFormat}
          onResizeWidth={changeResizeWidth}
          onResizeHeight={changeResizeHeight}
          onResizeLocked={changeResizeLocked}
          onOptimize={changeOptimize}
          onAppendPostId={changeAppendPostId}
          onCommitAppendPostId={commitAppendPostId}
          onUpload={handleUpload}
          onOpenSettings={openSettings}
          onCopyText={(value) => void copyValue(value)}
          onOpenLink={(value) => void openLink(value)}
          onRevealPath={(value) => void revealHistoryFile(value)}
          onClearHistory={clearHistory}
        />
      </main>

      <BorderBar
        border={doc.border}
        palette={palette}
        hasSource={doc.source !== null}
        onColor={(color) => persistSettings({ borderColor: color })}
        onWidth={(width) => persistSettings({ borderWidth: width })}
        onCopy={(hex) => void copyValue(hex)}
        onRecalc={recalcPalette}
      />

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
          onOpenApiKeyPage={() => void openLink(IMAGE_CHEST_API_KEY_URL)}
          onChooseFolder={() => void chooseFolder()}
          onClearFolder={() => persistSettings({ saveFolder: null })}
        />
      )}
    </div>
  );
}
