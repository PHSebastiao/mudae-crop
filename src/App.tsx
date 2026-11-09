import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadDir, join } from '@tauri-apps/api/path';
import {
  animationFrameCount,
  clampBorderWidth,
  effectiveAnimation,
  effectiveDelayMs,
  effectiveSource,
  effectiveTrim,
  emptyDocument,
  isAnimated,
  MIN_EXPORT_SIDE,
  outputSize,
  trimFrameCount,
  withBorder,
  withFrameEffectiveDelay,
  withFrameRemoved,
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
  type OptimizeSettings,
  type Trim,
} from './core/document';
import { normalizeHexColor } from './core/color';
import {
  formatFps,
  formatPlaybackDuration,
  trimDurationMs,
  videoPreviewRate,
} from './core/animation';
import {
  DownloadError,
  downloadErrorMessage,
  downloadSource,
  formatBytes,
  sourceUrlFrom,
} from './core/download';
import {
  estimateExportSize,
  exportKindFor,
  prepareFrame as prepareExportFrame,
  renderGif,
  renderPng,
  ExportError,
  type RenderProgress,
  type SizeEstimate,
} from './core/export';
import type { OptimizeResult } from './core/optimize';
import { applyRatio } from './core/geometry';
import { importErrorMessage, loadSource, localPathFrom, type SourceCandidate } from './core/import';
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
import { mudaeExportSize, ratioSlug, type CartaScale } from './core/ratios';
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
import { RatioMenu } from './components/RatioMenu';
import { Stage } from './components/Stage';
import { ToolRail } from './components/ToolRail';
import { ExportPanel } from './components/ExportPanel';
import { BorderBar } from './components/BorderBar';
import { Timeline } from './components/Timeline';
import { FrameGrid } from './components/FrameGrid';
import { SettingsDialog, type TokenTestResult } from './components/SettingsDialog';
import { useFrameCrop } from './hooks/useFrameCrop';

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
  const [ratioOpen, setRatioOpen] = useState(false);
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
  const [sizeEstimate, setSizeEstimate] = useState<SizeEstimate | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameVersion, setFrameVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [framesOpen, setFramesOpen] = useState(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const frameIndexRef = useRef(frameIndex);
  frameIndexRef.current = frameIndex;
  const frameAnimation = effectiveAnimation(doc);
  const hasFrames = frameAnimation !== null;
  const estimateVersionRef = useRef(0);
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

  const leavePick = useCallback(() => setPickTarget(null), []);
  const {
    adjustFrame,
    snapRatios,
    changeMode,
    changeRatio,
    changeZoom,
    changeOffset,
    resizeFrame,
    zoomAtPoint,
    pan,
    rotate,
    reset,
    toggleAdjustFrame,
    closeAdjustFrame,
    changeSnapRatios,
    markRatioPersisted,
  } = useFrameCrop({
    doc,
    setDoc,
    snapRatios: settings.snapRatios,
    persistSettings,
    playing,
    setPlaying,
    leavePick,
  });

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
        applyRatio(
          withBorder(current, {
            color: savedSettings.borderColor,
            width: savedSettings.borderWidth,
          }),
          savedSettings.frameRatio,
        ),
      );
      // The loaded proportion is already on disk: do not write it back on launch.
      markRatioPersisted(savedSettings.frameRatio);
    })().catch((reason) => {
      if (!alive) return;
      fail(`Não foi possível ler as Configurações; usando os padrões. ${messageOf(reason)}`);
    });
    return () => {
      alive = false;
    };
  }, [fail, markRatioPersisted]);

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
    doc.animation,
    doc.trimEnabled,
    paletteVersion,
  ]);

  // The Export panel shows a size before writing the file. A still is encoded
  // for real; a GIF encodes a few evenly spaced frames and extrapolates. The
  // readout follows Trim, scale, format and Optimize, debounced so a drag does
  // not re-encode on every pointer move. While a render runs it reuses the last
  // readout instead of competing for the canvas.
  useEffect(() => {
    if (!doc.source) {
      // Invalidate an estimate already in flight so it cannot land afterwards.
      estimateVersionRef.current += 1;
      setSizeEstimate(null);
      return;
    }
    // A render owns the canvas while it runs; keep the last readout instead.
    if (busy) return;
    const version = estimateVersionRef.current + 1;
    estimateVersionRef.current = version;
    const format = exportKindFor(effectiveSource(doc), settings.exportFormat).format;
    const timer = setTimeout(() => {
      void estimateExportSize(doc, browserExportAdapter, { format, frameIndex })
        .then((next) => {
          if (estimateVersionRef.current === version) setSizeEstimate(next);
        })
        .catch(() => {
          if (estimateVersionRef.current === version) setSizeEstimate(null);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [doc, settings.exportFormat, frameIndex, busy]);

  const activeTrim = useMemo(
    () => effectiveTrim(doc),
    [doc.source, doc.trim, doc.trimEnabled, doc.animation],
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
  }, [doc.source, doc.trim, doc.trimEnabled, doc.animation]);

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
    const source = effectiveSource(doc);
    const trim = activeTrim;
    if (!playing || !source || source.video || !trim) return;
    const current = Math.min(trim.end, Math.max(trim.start, frameIndex));
    const timer = setTimeout(
      () => {
        setFrameIndex(current >= trim.end ? trim.start : current + 1);
      },
      effectiveDelayMs(source, current, doc.speed),
    );
    return () => clearTimeout(timer);
  }, [activeTrim, playing, frameIndex, doc.source, doc.animation, doc.speed]);

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
      const kind = exportKindFor(effectiveSource(current), settingsRef.current.exportFormat);
      if (kind.format === 'png') {
        return renderPng(current, browserExportAdapter, {
          frameIndex: selectedFrame,
          prepare: () => prepareExportFrame(current.source, selectedFrame),
        });
      }
      setRenderProgress({
        phase: 'render',
        done: 0,
        total: trimFrameCount(effectiveSource(current), effectiveTrim(current)),
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
    const kind = exportKindFor(effectiveSource(current), settingsRef.current.exportFormat);
    const extension = kind.format;
    const label = kind.label;
    try {
      const name = exportFileName(
        current.source.name,
        ratioSlug(current.frame.ratio),
        new Date(),
        extension,
      );
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

      const bytes = await renderWithProgress(current, frameIndexRef.current);
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
  }, [beginRun, endRun, fail, inform, persistHistory, persistSettings, renderWithProgress]);

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

    const kind = exportKindFor(effectiveSource(current), settingsRef.current.exportFormat);
    const extension = kind.format;
    const contentType = kind.contentType;

    setUploading(true);
    setError(null);
    setStatus(null);
    setNoticeAction(null);
    try {
      const bytes = await renderWithProgress(current, frameIndexRef.current);
      const size = outputSize(current);
      const title = postTitle(current.source.name, size.width, size.height);
      const outcome = await uploadStill({
        transport: tauriImageChestTransport,
        token: saved.token,
        title,
        privacy: saved.defaultPrivacy,
        postId: requestedPost || null,
        file: {
          name: exportFileName(
            current.source.name,
            ratioSlug(current.frame.ratio),
            new Date(),
            extension,
          ),
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

  const changePadColor = useCallback((padColor: string) => {
    setPickTarget(null);
    setDoc((current) => withPadColor(current, padColor));
  }, []);

  const togglePickPad = useCallback(() => {
    // Arming the eyedropper leaves the crop phase, mirroring the inverse.
    closeAdjustFrame();
    setPickTarget((current) => (current === 'pad' ? null : 'pad'));
  }, [closeAdjustFrame]);

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

  const changeFrameDelay = useCallback((frameIndex: number, delayMs: number) => {
    setPlaying(false);
    setOptimizeResult(null);
    setDoc((current) => withFrameEffectiveDelay(current, frameIndex, delayMs));
  }, []);

  const removeFrame = useCallback((frameIndex: number) => {
    setPlaying(false);
    setOptimizeResult(null);
    setDoc((current) => withFrameRemoved(current, frameIndex));
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((current) => !current);
  }, []);

  const toggleFrames = useCallback(() => {
    setFramesOpen((current) => !current);
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
        ? Math.round(height * current.frame.ratio)
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

  const changeExportScale = useCallback((scale: CartaScale) => {
    setOptimizeResult(null);
    setDoc((current) => {
      const size = mudaeExportSize(current.frame.ratio, scale);
      return size ? withResize(current, size) : current;
    });
  }, []);

  const useNativeSize = useCallback(() => {
    setOptimizeResult(null);
    setDoc((current) => withResize(current, null));
  }, []);

  const scaleOutput = useCallback((factor: number) => {
    setOptimizeResult(null);
    setDoc((current) => {
      const size = outputSize(current);
      return withResize(current, {
        width: Math.max(MIN_EXPORT_SIDE, Math.round(size.width * factor)),
        height: Math.max(MIN_EXPORT_SIDE, Math.round(size.height * factor)),
      });
    });
  }, []);

  const halveOutput = useCallback(() => scaleOutput(0.5), [scaleOutput]);
  const doubleOutput = useCallback(() => scaleOutput(2), [scaleOutput]);

  // Stable handlers keep ExportPanel's memo meaningful.
  const copyExportText = useCallback((value: string) => void copyValue(value), [copyValue]);
  const openExportLink = useCallback((value: string) => void openLink(value), [openLink]);
  const revealExportPath = useCallback(
    (path: string) => void revealHistoryFile(path),
    [revealHistoryFile],
  );

  const changeExportFormat = useCallback(
    (exportFormat: ExportFormat) => {
      setOptimizeResult(null);
      persistSettings({ exportFormat });
    },
    [persistSettings],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog (the proportion popover) already handled this key.
      if (event.defaultPrevented) return;
      // An open dialog owns the keyboard; global shortcuts must not fire.
      if (settingsOpen || ratioOpen) return;
      if (event.key === 'Escape') {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        ) {
          return;
        }
        if (pickTarget !== null || adjustFrame) {
          event.preventDefault();
          setPickTarget(null);
          closeAdjustFrame();
          return;
        }
      }
      if (
        (event.key === 'f' || event.key === 'F') &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          return;
        }
        if (!hasFrames) return;
        event.preventDefault();
        toggleFrames();
        return;
      }
      if (
        (event.key === 'c' || event.key === 'C') &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          return;
        }
        if (!doc.source) return;
        event.preventDefault();
        toggleAdjustFrame();
        return;
      }
      if (event.key === ' ' && isAnimated(effectiveSource(doc))) {
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
  }, [
    adjustFrame,
    closeAdjustFrame,
    doc.source,
    handleOpen,
    hasFrames,
    openSettings,
    pickTarget,
    ratioOpen,
    settingsOpen,
    toggleAdjustFrame,
    toggleFrames,
    togglePlay,
  ]);

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

  const sourceView = effectiveSource(doc);
  const sourceAnimated = isAnimated(sourceView);
  const sourceChip = doc.source
    ? `${doc.source.format.toUpperCase()} · ${doc.source.width}×${doc.source.height} · ${formatBytes(
        doc.source.bytes,
      )} · ${
        doc.source.video
          ? `vídeo ${formatFps(doc.source.video.fps)} fps · ${formatPlaybackDuration(doc.source.video.durationMs)}`
          : sourceAnimated
            ? `animado ${animationFrameCount(sourceView)}f`
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
        <RatioMenu
          ratio={doc.frame.ratio}
          sourceRatio={
            doc.source
              ? doc.crop.rotation === 90 || doc.crop.rotation === 270
                ? doc.source.height / doc.source.width
                : doc.source.width / doc.source.height
              : null
          }
          snapEnabled={snapRatios}
          onRatio={changeRatio}
          onSnapEnabled={changeSnapRatios}
          onOpenChange={setRatioOpen}
        />
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
          framesOpen={framesOpen}
          onToggleFrames={toggleFrames}
          adjustFrame={adjustFrame}
          onToggleAdjustFrame={toggleAdjustFrame}
        />
        <div className="stage-column">
          <Stage
            doc={doc}
            frameIndex={frameIndex}
            frameVersion={frameVersion}
            onPan={pan}
            onZoomAt={zoomAtPoint}
            onResize={resizeFrame}
            adjustFrame={adjustFrame}
            snapRatios={snapRatios}
            onOpen={handleOpen}
            busy={busy}
            picking={pickTarget === 'pad'}
            onPickColor={pickPadColor}
            onPickMiss={pickPadMiss}
          />
          {framesOpen && frameAnimation && (
            <FrameGrid
              animation={frameAnimation}
              width={doc.source?.width ?? 1}
              height={doc.source?.height ?? 1}
              selectedIndex={frameIndex}
              speed={doc.speed}
              disabled={busy}
              onSelect={scrubFrame}
              onDelete={removeFrame}
              onRetime={changeFrameDelay}
            />
          )}
          {sourceAnimated && (
            <Timeline
              frameIndex={frameIndex}
              frameCount={animationFrameCount(sourceView)}
              trim={activeTrim ?? { start: 0, end: 0 }}
              trimEnabled={doc.trimEnabled}
              durationMs={trimDurationMs(sourceView, activeTrim, doc.speed)}
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
          sizeEstimate={sizeEstimate}
          onExport={handleExport}
          onExportScale={changeExportScale}
          onExportFormat={changeExportFormat}
          onResizeWidth={changeResizeWidth}
          onResizeHeight={changeResizeHeight}
          onResizeLocked={changeResizeLocked}
          onNative={useNativeSize}
          onHalve={halveOutput}
          onDouble={doubleOutput}
          onOptimize={changeOptimize}
          onAppendPostId={changeAppendPostId}
          onCommitAppendPostId={commitAppendPostId}
          onUpload={handleUpload}
          onOpenSettings={openSettings}
          onCopyText={copyExportText}
          onOpenLink={openExportLink}
          onRevealPath={revealExportPath}
          onClearHistory={clearHistory}
        />
      </main>

      <BorderBar
        border={doc.border}
        palette={palette}
        hasSource={doc.source !== null}
        onColor={(color) => persistSettings({ borderColor: color })}
        onWidth={(width) => persistSettings({ borderWidth: width })}
        onCopy={copyExportText}
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
