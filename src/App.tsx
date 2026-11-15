import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { downloadDir, join } from '@tauri-apps/api/path';
import brandIcon from '../assets/icon.svg';
import {
  animationFrameCount,
  baseOutputSize,
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
  withSpeed,
  withTrim,
  withTrimEnabled,
  withWaifu2x,
  type DocumentState,
  type Border,
  type OptimizeSettings,
  type Trim,
  type Waifu2xSettings,
} from './core/document';
import { normalizeHexColor } from './core/color';
import { IDLE_STAGE_MODE, enterPickPad, leavePick, type StageMode } from './core/stageMode';
import { trimDurationMs, videoPreviewRate } from './core/animation';
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
  type Waifu2xFrameRunner,
  type RenderProgress,
  type SizeEstimate,
} from './core/export';
import type { OptimizeResult } from './core/optimize';
import { applyRatio } from './core/geometry';
import { importErrorMessage, loadSource, localPathFrom, type SourceCandidate } from './core/import';
import { extractPaletteAsync, extractPaletteWithWaifu2x, type PaletteColor } from './core/palette';
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
  uploadBatch,
  uploadErrorMessage,
  uploadStill,
  type UploadFile,
} from './core/imagechest';
import { UPLOAD_CREDIT, exportFileName, postTitle } from './core/naming';
import { mudaeExportSize, presetForRatio, ratioSlug, type CartaScale } from './core/ratios';
import { resolveShortcut } from './core/shortcuts';
import {
  chunkItems,
  freeFileName,
  groupPostTitle,
  joinLinks,
  partitionBySize,
  shouldDemoteGold,
} from './core/batch';
import { MAX_UPLOAD_FILE_BYTES, UPLOAD_BATCH_STANDARD, uploadBatchSize } from './core/limits';
import {
  EMPTY_WORKSPACE,
  activateTile,
  activeDocument,
  activeTile,
  addFailedTile,
  addTile,
  moveTile,
  readyTiles,
  removeTile,
  updateActive,
  type Tile,
  type Workspace,
} from './core/workspace';
import { loadHistory, loadSettings, saveHistory, saveSettings } from './core/config';
import { DEFAULT_SETTINGS, type ExportFormat, type Settings } from './core/settings';
import { browserExportAdapter, browserPaletteAdapter, decodeWithBrowser } from './platform/browser';
import { configStore } from './platform/config';
import { gifsicleOptimizer } from './platform/gifOptimizer';
import { tauriImageChestTransport } from './platform/imagechest';
import { historyPreviewAdapter, readExportBytes } from './platform/historyPreview';
import { copyText, openExternal, revealInExplorer } from './platform/system';
import { probeWaifu2x, tauriWaifu2xSpawn, type Waifu2xAvailability } from './platform/waifu2x';
import { runWaifu2x } from './core/waifu2x';
import {
  chooseExportFolder,
  chooseExportPath,
  chooseSourceFiles,
  fileNameOf,
  folderOf,
  isDesktop,
  pathExists,
  readFileBytes,
  tauriDownloadTransport,
  watchFileDrops,
  writeFileBytes,
} from './platform/tauri';
import { RatioMenu } from './components/RatioMenu';
import { Board, type TileBadge } from './components/Board';
import { ToolRail } from './components/ToolRail';
import { ExportPanel } from './components/ExportPanel';
import { BorderBar } from './components/BorderBar';
import { Timeline } from './components/Timeline';
import { FrameGrid } from './components/FrameGrid';
import { SettingsDialog, type TokenTestResult } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { UpdateDialog } from './components/UpdateDialog';
import { WindowControls } from './components/WindowControls';
import { useAppShell } from './hooks/useAppShell';
import { useFrameCrop } from './hooks/useFrameCrop';
import { REPO_URL, RELEASES_URL, useUpdater } from './hooks/useUpdater';

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return 'Algo deu errado.';
}

/** A text field or editable control keeps every key for itself. */
function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    !!element &&
    (element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT' ||
      element.isContentEditable)
  );
}

/** Read a picked or dropped file, naming it when the read fails. */
async function readCandidate(path: string): Promise<SourceCandidate> {
  const name = fileNameOf(path);
  try {
    return { name, path, bytes: await readFileBytes(path) };
  } catch (reason) {
    throw new Error(`Não foi possível ler "${name}". ${messageOf(reason)}`);
  }
}

/** A free path in `folder`: the requested name, or `-2`, `-3`… when taken. */
async function uniqueExportPath(folder: string, name: string, extension: string): Promise<string> {
  const fileName = await freeFileName(name, extension, async (candidate) =>
    pathExists(await join(folder, candidate)),
  );
  return join(folder, fileName);
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const active = activeTile(workspace);
  // Every command in this file writes "the document": on a Board that is the
  // Active Tile, so the whole editor keeps its old single-document shape.
  const setDoc = useCallback<Dispatch<SetStateAction<DocumentState>>>((action) => {
    setWorkspace((current) =>
      updateActive(current, (previous) =>
        typeof action === 'function' ? action(previous) : action,
      ),
    );
  }, []);
  /** The card a brand-new Tile starts from, shaped by the saved settings. */
  const [seedDoc, setSeedDoc] = useState<DocumentState>(emptyDocument);
  // An empty Board reports the seed, so the ratio menu, the empty art and the
  // next Tile all agree — and leaving the Board never looks like a ratio choice.
  const doc = active?.doc ?? seedDoc;
  const seedRef = useRef(seedDoc);
  seedRef.current = seedDoc;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const importingRef = useRef(false);
  /** Files waiting for the running import to finish; the drain takes them in order. */
  const pendingImportsRef = useRef<(() => Promise<SourceCandidate>)[]>([]);
  const [importQueue, setImportQueue] = useState<{ done: number; total: number } | null>(null);
  const [batch, setBatch] = useState<{
    label: string;
    done: number;
    total: number;
    name: string;
  } | null>(null);
  const [badges, setBadges] = useState<Record<string, TileBadge>>({});
  /** Drop one Tile's badge: a single success means it is no longer failing. */
  const clearBadge = useCallback((id: string | null) => {
    if (!id) return;
    setBadges((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);
  const {
    busy,
    activity,
    notice,
    download,
    begin: beginRun,
    end: endRun,
    inform,
    fail,
    clearNotice,
    dismissError,
    startDownload,
    reportDownload,
    finishDownload,
    endDownload,
  } = useAppShell();
  /** Read inside callbacks that must not re-register when the lock toggles. */
  const busyRef = useRef(busy);
  busyRef.current = busy;
  /** The operation that owns the app; a URL import holds `download` itself. */
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const [stageMode, setStageMode] = useState<StageMode>(IDLE_STAGE_MODE);
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [history, setHistory] = useState<readonly HistoryEntry[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [testingToken, setTestingToken] = useState(false);
  const [checkingAccount, setCheckingAccount] = useState(false);
  const [tokenResult, setTokenResult] = useState<TokenTestResult | null>(null);
  const [appendPostId, setAppendPostId] = useState('');
  const [palette, setPalette] = useState<readonly PaletteColor[]>([]);
  const [paletteVersion, setPaletteVersion] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  /** The live countdown, so a retry cannot bypass the wait it just started. */
  const cooldownRef = useRef(cooldownSeconds);
  cooldownRef.current = cooldownSeconds;
  const [dragOver, setDragOver] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [sizeEstimate, setSizeEstimate] = useState<SizeEstimate | null>(null);
  /**
   * A Tile's Palette and size readout belong to its document, and a document is
   * immutable: the same object always means the same answer. Caching by identity
   * makes switching back to a Tile instant instead of re-sampling every frame.
   */
  const paletteCacheRef = useRef(new WeakMap<DocumentState, readonly PaletteColor[]>());
  const estimateCacheRef = useRef(new WeakMap<DocumentState, Map<string, SizeEstimate>>());
  const [waifu2xAvailability, setWaifu2xAvailability] = useState<Waifu2xAvailability>({
    status: 'checking',
    detail: null,
  });
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameVersion, setFrameVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [framesOpen, setFramesOpen] = useState(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const frameIndexRef = useRef(frameIndex);
  frameIndexRef.current = frameIndex;
  /** The playhead each Tile was left on, so switching back restores it. */
  const frameIndexByTileRef = useRef<Map<string, number>>(new Map());
  const frameAnimation = effectiveAnimation(doc);
  const hasFrames = frameAnimation !== null;
  const adjustFrame = stageMode.kind === 'adjust';
  const estimateVersionRef = useRef(0);
  const cancelDownloadRef = useRef<(() => void) | null>(null);
  const cancelRenderRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const historyRef = useRef<readonly HistoryEntry[]>(history);
  historyRef.current = history;
  const appendPostIdRef = useRef(appendPostId);
  appendPostIdRef.current = appendPostId;
  const uploadRef = useRef<() => Promise<void>>(async () => undefined);
  const uploadAllRef = useRef<(skip?: ReadonlySet<string>) => Promise<void>>(async () => undefined);
  /** Repeats exactly the last upload that failed, without resending what went up. */
  const retryRef = useRef<() => Promise<void>>(async () => undefined);
  /** Stable click handler: keeps the memoized ExportPanel out of frame renders. */
  const startUploadAll = useCallback(() => void uploadAllRef.current(), []);

  // One loader owns the Export thumbnails and their object URLs. It is keyed by
  // path + size, so re-renders reuse a read and a replaced file is read again.
  const historyPreview = useMemo(
    () => createHistoryPreviewLoader({ read: readExportBytes, adapter: historyPreviewAdapter }),
    [],
  );

  const openSettings = useCallback(() => {
    setStageMode(leavePick);
    dismissError();
    setSettingsOpen(true);
  }, [dismissError]);

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
        // Settings owns the default a launch starts from; the Active Tile is
        // edited by the Border bar and is never touched from here.
        setSeedDoc((current) =>
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

  /**
   * The Border bar edits the Active Tile and remembers the last choice as the
   * setup default for the next launch.
   */
  const changeBorder = useCallback(
    (patch: Partial<Border>) => {
      setDoc((current) => withBorder(current, patch));
      persistSettings(
        patch.color !== undefined
          ? { borderColor: patch.color }
          : { borderWidth: patch.width ?? settingsRef.current.borderWidth },
      );
    },
    [persistSettings, setDoc],
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

  const {
    snapRatios,
    changeMode,
    changeRatio,
    changeZoom,
    zoomBy,
    changeOffset,
    panTo,
    resizeTo,
    zoomAtPoint,
    pan,
    rotate,
    reset,
    toggleAdjustFrame,
    changeSnapRatios,
    markRatioPersisted,
  } = useFrameCrop({
    doc,
    setDoc,
    snapRatios: settings.snapRatios,
    persistSettings,
    setStageMode,
  });

  // The launch check runs once, three seconds after the first paint. The prompt
  // is held back while an Export or an upload owns the app, so an update never
  // closes the window over unfinished work.
  const updater = useUpdater({
    desktop: isDesktop(),
    ready: settingsLoaded,
    skipped: settings.skippedUpdateVersion,
    onSkip: (version) => persistSettings({ skippedUpdateVersion: version }),
  });

  // The update prompt is the topmost modal: an open Settings, Atalhos or
  // proportion popover would keep its own Escape handler and focus trap, so
  // they give way instead of stacking. It is hidden while an Export or an
  // upload owns the app, and that hidden state is not a dialog for shortcuts.
  const updatePromptVisible =
    updater.prompt && (updater.status.phase !== 'available' || (!busy && !uploading));

  useEffect(() => {
    if (!updatePromptVisible) return;
    setSettingsOpen(false);
    setShortcutsOpen(false);
    setRatioOpen(false);
    // A notice bar sits above the backdrop, so its "abrir Configurações"
    // action could open a dialog over the prompt; closing on every attempt
    // keeps the update modal the only one.
  }, [updatePromptVisible, settingsOpen, shortcutsOpen, ratioOpen]);

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
      setSettingsLoaded(true);
      historyRef.current = savedHistory;
      setHistory(savedHistory);
      setSeedDoc((current) =>
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
      // The defaults are what the app runs on, so the launch check may proceed:
      // a broken settings file must not disable updates for the session.
      setSettingsLoaded(true);
      fail(`Não foi possível ler as Configurações; usando os padrões. ${messageOf(reason)}`);
    });
    return () => {
      alive = false;
    };
  }, [fail, markRatioPersisted]);

  // Vulkan and the bundled sidecar are checked once at launch. While the check
  // runs, or when it fails, the waifu2x controls stay disabled but the rest of
  // the editor is unaffected.
  useEffect(() => {
    let alive = true;
    void probeWaifu2x().then((next) => {
      if (alive) setWaifu2xAvailability(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  // A success notice is information, not a modal: let it fade out instead of
  // staying on screen and pushing the workspace around.
  useEffect(() => {
    if (notice.kind !== 'info') return;
    // Give a long link enough time to be read, but never hold the screen.
    const delay = Math.min(9000, Math.max(4000, 1200 + notice.message.length * 40));
    const timer = setTimeout(clearNotice, delay);
    return () => clearTimeout(timer);
  }, [notice, clearNotice]);

  // The Palette follows the Crop, Frame, Pad color and sharpness. It is
  // debounced so dragging or zooming does not sample on every pointer move,
  // and the Border is deliberately not a dependency. With waifu2x on, the
  // sampled frames go through the sidecar too, so the swatches really follow
  // it; that path waits longer and is cancelled on the next edit.
  useEffect(() => {
    if (!doc.source) {
      setPalette([]);
      return;
    }
    const controller = new AbortController();
    const current = docRef.current;
    const paletteUsesWaifu2x = current.waifu2x.enabled && waifu2xAvailability.status === 'ready';
    // A video's Palette is a snapshot of the frame on screen, not a property of
    // the document, so it is neither cached nor trusted across visits.
    const cacheable = !paletteUsesWaifu2x && !current.source?.video;
    // The swatches of this exact document are already known: switching Tiles
    // must not re-sample an animation just to show what it showed before.
    const cached = cacheable ? paletteCacheRef.current.get(current) : undefined;
    if (cached) {
      setPalette(cached);
      return;
    }
    const timer = setTimeout(
      () => {
        const waifu2xFrame = async (png: Uint8Array): Promise<CanvasImageSource> => {
          const bytes = await runWaifu2x(png, current.waifu2x, tauriWaifu2xSpawn, {
            signal: controller.signal,
          });
          const decodePng = browserExportAdapter.decodePng;
          if (!decodePng) throw new Error('Decodificação de PNG indisponível.');
          return decodePng(bytes);
        };
        const paletteWaifu2x = paletteUsesWaifu2x ? waifu2xFrame : null;
        // Without the sidecar the sample runs in slices, so a 60-frame animation
        // never owns the thread while the Preview is playing.
        const task = paletteWaifu2x
          ? extractPaletteWithWaifu2x(
              current,
              browserPaletteAdapter,
              paletteWaifu2x,
              controller.signal,
            )
          : extractPaletteAsync(current, browserPaletteAdapter, {
              signal: controller.signal,
            });
        void task
          .then((next) => {
            if (controller.signal.aborted) return;
            if (cacheable) paletteCacheRef.current.set(current, next);
            setPalette(next);
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            // A mid-session sidecar failure keeps the raw swatches rather than
            // blanking the Palette — and samples them in slices, so the error
            // path never becomes the freeze the slices removed.
            void extractPaletteAsync(current, browserPaletteAdapter, {
              signal: controller.signal,
            })
              .then((next) => {
                if (!controller.signal.aborted) setPalette(next);
              })
              .catch(() => {
                if (!controller.signal.aborted) setPalette([]);
              });
          });
      },
      paletteUsesWaifu2x ? 450 : 150,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    doc.source,
    doc.frame,
    doc.crop,
    doc.padColor,
    doc.sharpness,
    doc.trim,
    doc.animation,
    doc.trimEnabled,
    doc.waifu2x,
    waifu2xAvailability.status,
    paletteVersion,
  ]);

  // The Export panel shows a size before writing the file. A still is encoded
  // for real; a GIF encodes a few evenly spaced frames and extrapolates. The
  // readout follows Trim, scale, format and Optimize, debounced so a drag does
  // not re-encode on every pointer move. While a render runs it reuses the last
  // readout instead of competing for the canvas.
  //
  // A GIF estimate does not depend on the playhead, so playback must not
  // restart it on every frame: only a PNG reads `frameIndex`.
  const estimateFrame =
    exportKindFor(effectiveSource(doc), settings.exportFormat).format === 'png' ? frameIndex : 0;
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
    // A PNG estimate reads the playhead, but a still has no playhead; a video
    // reads the frame on screen. Neither is a property of the document, so
    // only a still PNG and an animation's own estimate are cacheable.
    const cacheable = !doc.source?.video && !(format === 'png' && isAnimated(doc.source));
    const cached = cacheable ? estimateCacheRef.current.get(doc)?.get(format) : undefined;
    if (cached) {
      setSizeEstimate(cached);
      return;
    }
    const timer = setTimeout(() => {
      void estimateExportSize(doc, browserExportAdapter, { format, frameIndex: estimateFrame })
        .then((next) => {
          if (estimateVersionRef.current !== version) return;
          if (cacheable) {
            const byFormat = estimateCacheRef.current.get(doc) ?? new Map<string, SizeEstimate>();
            byFormat.set(format, next);
            estimateCacheRef.current.set(doc, byFormat);
          }
          setSizeEstimate(next);
        })
        .catch(() => {
          if (estimateVersionRef.current === version) setSizeEstimate(null);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [doc, settings.exportFormat, estimateFrame, busy]);

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

  // GIF playback advances at the frame's own delay, scaled by the speed. The
  // clock is drift-corrected: a frame that takes 8 ms to paint must not add
  // 8 ms to a 20 ms delay, or the preview plays slower than the Export.
  const playClockRef = useRef(0);
  useEffect(() => {
    playClockRef.current = 0;
  }, [playing, doc.source, doc.speed, activeTrim]);
  useEffect(() => {
    const source = effectiveSource(doc);
    const trim = activeTrim;
    if (!playing || !source || source.video || !trim) return;
    const current = Math.min(trim.end, Math.max(trim.start, frameIndex));
    const delay = effectiveDelayMs(source, current, doc.speed);
    const now = performance.now();
    if (playClockRef.current === 0 || now - playClockRef.current > 1000) {
      playClockRef.current = now;
    }
    const due = playClockRef.current + delay;
    playClockRef.current = due;
    const timer = setTimeout(
      () => {
        setFrameIndex(current >= trim.end ? trim.start : current + 1);
      },
      Math.max(0, due - now),
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

  // Every decoded video belongs to the session; closing the window drops them.
  useEffect(
    () => () => {
      for (const tile of workspaceRef.current.tiles) tile.doc.source?.video?.dispose();
    },
    [],
  );

  /** Drop the decoded videos of a set of Tiles; their bytes stay on the Tile. */
  const disposeTiles = useCallback((tiles: readonly Tile[]) => {
    for (const tile of tiles) tile.doc.source?.video?.dispose();
  }, []);

  /**
   * Import a batch, one file at a time. Each Tile lands on the Board as soon as
   * its file decodes, so the user can start framing the first one while the
   * rest are still arriving; a file that fails becomes a placeholder Tile
   * instead of sinking the batch.
   */
  const importCandidates = useCallback(
    async (loaders: readonly (() => Promise<SourceCandidate>)[]) => {
      if (loaders.length === 0) return;
      // A URL import holds the 'download' run through its own decode, so only
      // a render or an upload may refuse an import.
      if (activityRef.current === 'export' || activityRef.current === 'upload') {
        fail('Termine a exportação ou o upload em andamento antes de importar.');
        return;
      }
      // Files dropped while a batch is still decoding join the same queue, in
      // order, instead of being refused and lost.
      pendingImportsRef.current.push(...loaders);
      if (importingRef.current) return;
      const replaceMode = settingsRef.current.importMode === 'replace';
      let replaced = false;
      importingRef.current = true;
      const failures: string[] = [];
      let loaded = 0;
      let done = 0;
      setImportQueue({ done, total: pendingImportsRef.current.length });
      try {
        while (pendingImportsRef.current.length > 0) {
          const loader = pendingImportsRef.current.shift();
          if (!loader) break;
          setImportQueue({ done, total: done + pendingImportsRef.current.length + 1 });
          try {
            const candidate = await loader();
            const source = await loadSource(candidate, decodeWithBrowser);
            const takesControls = loaded === 0;
            if (takesControls) {
              // Keep the playhead of the Tile this batch is taking over from.
              const previousId = workspaceRef.current.activeId;
              if (previousId) frameIndexByTileRef.current.set(previousId, frameIndexRef.current);
            }
            if (replaceMode && !replaced) {
              // Only a successful decode wipes the Board: a bad drop must not
              // destroy the work already there.
              disposeTiles(workspaceRef.current.tiles);
              frameIndexByTileRef.current.clear();
              setWorkspace(EMPTY_WORKSPACE);
              setBadges({});
            }
            replaced = true;
            setWorkspace((current) =>
              addTile(current, source, activeDocument(current, seedRef.current), takesControls),
            );
            if (takesControls) {
              setStageMode(leavePick);
              setPlaying(isAnimated(source));
              setFrameIndex(0);
              setOptimizeResult(null);
            }
            loaded += 1;
          } catch (reason) {
            const message = importErrorMessage(reason);
            failures.push(message);
            setWorkspace((current) => addFailedTile(current, message));
          }
          done += 1;
          setImportQueue({ done, total: done + pendingImportsRef.current.length });
          // Let the Board paint the Tile that just landed before the next decode.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } finally {
        importingRef.current = false;
        setImportQueue(null);
      }
      if (failures.length > 0) {
        fail(
          failures.length === 1
            ? failures[0]
            : `${failures.length} arquivos não puderam ser importados. ${failures[0]}`,
        );
        return;
      }
      inform(loaded === 1 ? 'Imagem carregada.' : `${loaded} imagens carregadas.`);
    },
    [disposeTiles, fail, inform],
  );

  const importCandidate = useCallback(
    (candidate: SourceCandidate) => importCandidates([async () => candidate]),
    [importCandidates],
  );

  const importPath = useCallback(
    async (path: string) => {
      await importCandidates([() => readCandidate(path)]);
    },
    [importCandidates],
  );

  const importPaths = useCallback(
    async (paths: readonly string[]) => {
      await importCandidates(paths.map((path) => () => readCandidate(path)));
    },
    [importCandidates],
  );

  const importFromUrl = useCallback(
    async (raw: string) => {
      if (!isDesktop()) {
        fail('Importar por link só funciona no app desktop.');
        return;
      }
      const started = beginRun('download');
      if (!started.ok) {
        fail(started.message);
        return;
      }

      const controller = new AbortController();
      cancelDownloadRef.current = () => controller.abort();
      clearNotice();
      startDownload();
      try {
        const candidate = await downloadSource(raw, {
          transport: tauriDownloadTransport,
          signal: controller.signal,
          onProgress: reportDownload,
        });
        // The link is down; decoding is local and no longer cancellable.
        cancelDownloadRef.current = null;
        finishDownload();
        await importCandidate(candidate);
        setLink('');
      } catch (reason) {
        if (reason instanceof DownloadError && reason.code === 'cancelled') {
          inform('Download cancelado.');
        } else {
          fail(downloadErrorMessage(reason));
        }
      } finally {
        cancelDownloadRef.current = null;
        endDownload();
        endRun('download');
      }
    },
    [
      beginRun,
      clearNotice,
      endDownload,
      endRun,
      fail,
      finishDownload,
      importCandidate,
      inform,
      reportDownload,
      startDownload,
    ],
  );

  const cancelDownload = useCallback(() => {
    cancelDownloadRef.current?.();
  }, []);

  const handleOpen = useCallback(async () => {
    // Same rule as the queue: only a render or an upload refuses the dialog.
    if (activityRef.current === 'export' || activityRef.current === 'upload') {
      fail('Termine a exportação ou o upload em andamento antes de importar.');
      return;
    }
    try {
      if (!isDesktop()) {
        fail('Abrir arquivos só funciona no app desktop.');
        return;
      }
      const paths = await chooseSourceFiles();
      if (paths.length > 0) await importPaths(paths);
    } catch (reason) {
      fail(`Não foi possível abrir o diálogo de arquivos. ${messageOf(reason)}`);
    }
  }, [fail, importPaths]);

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
      // A PNG has one sidecar run, so its own percentages drive the notice. A
      // GIF reports per frame in renderGif instead.
      const waifu2x: Waifu2xFrameRunner | undefined = current.waifu2x.enabled
        ? ({ input, signal }) =>
            runWaifu2x(input, current.waifu2x, tauriWaifu2xSpawn, {
              signal: signal ?? controller.signal,
              onProgress:
                kind.format === 'png'
                  ? (fraction) => setRenderProgress({ phase: 'waifu2x', done: fraction, total: 1 })
                  : undefined,
            })
        : undefined;
      if (kind.format === 'png') {
        if (waifu2x) setRenderProgress({ phase: 'waifu2x', done: 0, total: 1 });
        return renderPng(current, browserExportAdapter, {
          frameIndex: selectedFrame,
          prepare: () => prepareExportFrame(current.source, selectedFrame),
          signal: controller.signal,
          waifu2x,
        });
      }
      setRenderProgress({
        phase: waifu2x ? 'waifu2x' : 'render',
        done: 0,
        total: trimFrameCount(effectiveSource(current), effectiveTrim(current)),
      });
      return renderGif(current, browserExportAdapter, {
        signal: controller.signal,
        onProgress: setRenderProgress,
        optimizer: gifsicleOptimizer,
        onOptimized: setOptimizeResult,
        waifu2x,
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
    if (importingRef.current) {
      fail('Aguarde a importação terminar antes de exportar.');
      return;
    }
    if (!isDesktop()) {
      fail('Exportar só funciona no app desktop.');
      return;
    }
    if (current.waifu2x.enabled && waifu2xAvailability.status !== 'ready') {
      fail('O waifu2x não está disponível neste computador. Desligue-o para exportar.');
      return;
    }
    const startedExport = beginRun('export');
    if (!startedExport.ok) {
      fail(startedExport.message);
      return;
    }
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
      clearBadge(workspaceRef.current.activeId);
      inform(`${label} ${size.width}×${size.height} exportado: ${fileNameOf(path)}`);
    } catch (reason) {
      if (reason instanceof ExportError && reason.cancelled) {
        inform('Render cancelado.');
      } else {
        fail(`Não foi possível exportar o ${label}. ${messageOf(reason)}`);
      }
    } finally {
      setRenderProgress(null);
      endRun('export');
    }
  }, [
    beginRun,
    endRun,
    fail,
    inform,
    persistHistory,
    persistSettings,
    renderWithProgress,
    waifu2xAvailability.status,
  ]);

  /** Remove a Tile and its decoded video; the Board picks the next active. */
  const handleRemoveTile = useCallback(
    (id: string) => {
      // A batch snapshots the Tiles: deleting one mid-run would leave the command
      // acting on a Tile the user can no longer see.
      if (busyRef.current) return;
      const tile = workspaceRef.current.tiles.find((entry) => entry.id === id);
      if (!tile) return;
      const wasActive = workspaceRef.current.activeId === id;
      tile.doc.source?.video?.dispose();
      frameIndexByTileRef.current.delete(id);
      const next = removeTile(workspaceRef.current, id);
      // Commit through the updater: a Tile that lands between the read and the
      // commit (an import draining) must not be discarded.
      setWorkspace((current) => removeTile(current, id));
      setBadges((current) => {
        if (!(id in current)) return current;
        const copy = { ...current };
        delete copy[id];
        return copy;
      });
      // Removing a background Tile must not stop the Active Tile or drop the user
      // out of Ajustar Frame.
      if (!wasActive) return;
      const successor = activeTile(next);
      setPlaying(successor ? isAnimated(effectiveSource(successor.doc)) : false);
      setStageMode(IDLE_STAGE_MODE);
      setOptimizeResult(null);
      setFrameIndex(successor ? (frameIndexByTileRef.current.get(successor.id) ?? 0) : 0);
      // Removing is not a ratio choice: never rewrite the launch default.
      if (successor) markRatioPersisted(successor.doc.frame.ratio);
    },
    [markRatioPersisted],
  );

  const handleActivateTile = useCallback(
    (id: string) => {
      // A failed import has no Source, so it can never own the controls.
      const tile = workspaceRef.current.tiles.find((entry) => entry.id === id);
      if (!tile || !tile.doc.source) return;
      // Double-clicking the Active Tile opens the spotlight; it must not restart
      // playback or drop the stage mode it is already in.
      if (workspaceRef.current.activeId === id) return;
      // Keep the playhead of the Tile being left, and restore the one arriving.
      const previousId = workspaceRef.current.activeId;
      if (previousId) frameIndexByTileRef.current.set(previousId, frameIndexRef.current);
      const nextFrame = frameIndexByTileRef.current.get(id) ?? 0;
      setWorkspace((current) => {
        if (current.activeId === id) return current;
        return activateTile(current, id);
      });
      // A Tile that lands under the focus plays on its own: an animated Source
      // starts, a still stays still.
      setPlaying(isAnimated(effectiveSource(tile.doc)));
      setStageMode(IDLE_STAGE_MODE);
      setFrameIndex(nextFrame);
      setOptimizeResult(null);
      setSizeEstimate(null);
      // Switching Tiles is not a ratio choice: never rewrite the launch default.
      markRatioPersisted(tile.doc.frame.ratio);
    },
    [markRatioPersisted],
  );

  /** The playhead a Tile would render at: the live one for the Active Tile. */
  const frameForTile = useCallback((id: string) => {
    if (id === workspaceRef.current.activeId) return frameIndexRef.current;
    return frameIndexByTileRef.current.get(id) ?? 0;
  }, []);

  const handleMoveTile = useCallback((id: string, beforeId: string | null) => {
    setWorkspace((current) => moveTile(current, id, beforeId));
  }, []);

  /** Write every Tile into one folder, never overwriting an existing file. */
  const handleExportAll = useCallback(async () => {
    const tiles = readyTiles(workspaceRef.current);
    if (tiles.length === 0) return;
    if (!isDesktop()) {
      fail('Exportar só funciona no app desktop.');
      return;
    }
    if (importingRef.current) {
      fail('Aguarde a importação terminar antes de exportar.');
      return;
    }
    if (tiles.some((tile) => tile.doc.waifu2x.enabled && waifu2xAvailability.status !== 'ready')) {
      fail('O waifu2x não está disponível neste computador. Desligue-o nas Tiles que o usam.');
      return;
    }
    const startedExport = beginRun('export');
    if (!startedExport.ok) {
      fail(startedExport.message);
      return;
    }

    try {
      let suggested: string | undefined;
      try {
        suggested = settingsRef.current.saveFolder ?? (await downloadDir());
      } catch {
        suggested = undefined;
      }
      const folder = await chooseExportFolder(suggested);
      if (!folder) return;
      persistSettings({ saveFolder: folder });

      // A new export run starts with a clean slate: an old 'falhou' must not
      // outlive a successful retry. Cleared only after the folder is chosen, so
      // cancelling the picker leaves the Board untouched.
      setBadges((current) => {
        const next = { ...current };
        for (const tile of tiles) {
          // Only the export's own failures: a 'grande' from an upload is still
          // true and stays useful.
          if (next[tile.id]?.label === 'falhou') delete next[tile.id];
        }
        return next;
      });

      let written = 0;
      let cancelled = false;
      const failed: string[] = [];
      for (const [index, tile] of tiles.entries()) {
        const current = tile.doc;
        if (!current.source) continue;
        setBatch({
          label: 'Exportando',
          done: index,
          total: tiles.length,
          name: current.source.name,
        });
        const kind = exportKindFor(effectiveSource(current), settingsRef.current.exportFormat);
        const name = exportFileName(
          current.source.name,
          ratioSlug(current.frame.ratio),
          new Date(),
          kind.format,
        );
        try {
          const path = await uniqueExportPath(folder, name, kind.format);
          const bytes = await renderWithProgress(current, frameForTile(tile.id));
          await writeFileBytes(path, bytes);
          setBadges((current) => {
            // Only an export failure is settled here: a 'grande' from an upload
            // is still true, and the next upload would refuse it again.
            if (current[tile.id]?.label !== 'falhou') return current;
            const next = { ...current };
            delete next[tile.id];
            return next;
          });
          const size = outputSize(current);
          persistHistory(
            appendHistory(historyRef.current, {
              kind: 'export',
              path,
              fileName: fileNameOf(path),
              title: postTitle(current.source.name, size.width, size.height),
              format: kind.format,
              size: bytes.length,
              width: size.width,
              height: size.height,
              createdAt: new Date().toISOString(),
            }),
          );
          written += 1;
        } catch (reason) {
          if (reason instanceof ExportError && reason.cancelled) {
            cancelled = true;
            break;
          }
          failed.push(name);
          setBadges((current) => ({
            ...current,
            [tile.id]: { label: 'falhou', tone: 'bad' },
          }));
        }
      }

      if (cancelled) {
        inform(`Export cancelado. ${written} de ${tiles.length} exportados.`);
      } else if (failed.length > 0) {
        fail(
          `${written} de ${tiles.length} exportados. Falharam: ${failed.slice(0, 3).join(', ')}${
            failed.length > 3 ? '…' : ''
          }`,
        );
      } else {
        inform(
          `${written} ${written === 1 ? 'arquivo exportado' : 'arquivos exportados'} em ${folder}`,
        );
      }
    } catch (reason) {
      fail(`Não foi possível exportar. ${messageOf(reason)}`);
    } finally {
      setBatch(null);
      setRenderProgress(null);
      endRun('export');
    }
  }, [
    beginRun,
    endRun,
    fail,
    frameForTile,
    inform,
    persistHistory,
    persistSettings,
    renderWithProgress,
    waifu2xAvailability.status,
  ]);

  const uploadFailure = useCallback(
    (reason: unknown) => {
      if (reason instanceof ImageChestError) {
        if (reason.code === 'unauthorized' || reason.code === 'no-token') {
          fail(reason.message, { label: 'Abrir Configurações', run: openSettings });
          return;
        }
        if (reason.code === 'offline' || reason.code === 'server' || reason.code === 'malformed') {
          fail(reason.message, {
            label: 'Tentar de novo',
            run: () => void retryRef.current(),
          });
          return;
        }
        if (reason.code === 'rate-limited') {
          setCooldownSeconds(reason.retryAfterSeconds ?? 30);
          // The retry closure is safe: the cooldown check refuses politely
          // until the wait is over, and then it resumes the batch.
          fail(reason.message, { label: 'Tentar de novo', run: () => void retryRef.current() });
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
    // The single-flight lock below reports a double click or a repeated Ctrl+Enter.
    if (importingRef.current) {
      fail('Aguarde a importação terminar antes de subir.');
      return;
    }
    if (!isDesktop()) {
      fail('O upload só funciona no app desktop.');
      return;
    }
    if (current.waifu2x.enabled && waifu2xAvailability.status !== 'ready') {
      fail('O waifu2x não está disponível neste computador. Desligue-o para subir.');
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
    if (cooldownRef.current > 0) {
      // Keep whatever retry is pending: a batch resume must outlive the wait.
      fail(`Aguarde ${cooldownRef.current}s antes de subir de novo.`, {
        label: 'Tentar de novo',
        run: () => void retryRef.current(),
      });
      return;
    }
    const startedUpload = beginRun('upload');
    if (!startedUpload.ok) {
      fail(startedUpload.message);
      return;
    }
    // Only a run that holds the lock owns the retry slot: a refusal must never
    // overwrite a pending batch resume with a single-Tile one.
    const failingId = workspaceRef.current.activeId;
    retryRef.current = () =>
      workspaceRef.current.activeId === failingId
        ? handleUpload()
        : Promise.resolve(fail('A Tile que falhou não é mais a ativa.'));

    const kind = exportKindFor(effectiveSource(current), settingsRef.current.exportFormat);
    const extension = kind.format;
    const contentType = kind.contentType;

    setUploading(true);
    clearNotice();
    try {
      const bytes = await renderWithProgress(current, frameIndexRef.current);
      const size = outputSize(current);
      const title = postTitle(current.source.name, size.width, size.height);
      // The credit line is opt-in; custom descriptions may replace it later.
      // Appending to an existing Post must not add a second credit.
      const description = saved.uploadCredit && !requestedPost ? UPLOAD_CREDIT : '';
      const outcome = await uploadStill({
        transport: tauriImageChestTransport,
        token: saved.token,
        title,
        description,
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
      const noDescription =
        description && !outcome.described ? ' A descrição não foi aplicada.' : '';
      inform(
        copied
          ? `Link copiado: ${outcome.link}${noDescription}`
          : `Export no Post ${outcome.postId}. Não foi possível copiar; use o Histórico.${noDescription}`,
      );
      clearBadge(workspaceRef.current.activeId);
    } catch (reason) {
      if (reason instanceof ExportError && reason.cancelled) {
        inform('Render cancelado.');
      } else {
        uploadFailure(reason);
      }
    } finally {
      setRenderProgress(null);
      setUploading(false);
      endRun('upload');
    }
  }, [
    beginRun,
    clearBadge,
    clearNotice,
    endRun,
    fail,
    inform,
    openSettings,
    persistHistory,
    renderWithProgress,
    uploadFailure,
    waifu2xAvailability.status,
  ]);

  /**
   * Upload every ready Tile. Grouped, the whole batch is one Post: the first
   * request creates it (or appends to the chosen Post) and later chunks append
   * to the same one. Ungrouped, every Tile becomes its own Post.
   */
  const handleUploadAll = useCallback(
    async (
      skip?: ReadonlySet<string>,
      resumePostId?: string | null,
      previousLinks?: readonly string[],
    ) => {
      const allTiles = readyTiles(workspaceRef.current);
      // A retry after a partial batch only sends what did not go up.
      const tiles =
        skip && skip.size > 0 ? allTiles.filter((tile) => !skip.has(tile.id)) : allTiles;
      if (tiles.length === 0) {
        // Everything went up before the failure: hand the whole set back.
        if (previousLinks && previousLinks.length > 0) {
          try {
            await copyText(joinLinks(previousLinks));
            inform(`${previousLinks.length} links copiados.`);
          } catch {
            // The links are in the Histórico.
          }
        }
        return;
      }
      if (!isDesktop()) {
        fail('O upload só funciona no app desktop.');
        return;
      }
      if (importingRef.current) {
        fail('Aguarde a importação terminar antes de subir.');
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
      const requested = appendPostIdRef.current.trim();
      if (requested && !isPostId(requested)) {
        fail('O Post id aceita só letras e números.');
        return;
      }
      if (cooldownRef.current > 0) {
        // Keep the resume handle alive across the wait: dropping it would push
        // the user onto "Subir todas", which duplicates everything already sent.
        fail(`Aguarde ${cooldownRef.current}s antes de subir de novo.`, {
          label: 'Tentar de novo',
          run: () => void retryRef.current(),
        });
        return;
      }
      if (
        tiles.some((tile) => tile.doc.waifu2x.enabled && waifu2xAvailability.status !== 'ready')
      ) {
        fail('O waifu2x não está disponível neste computador. Desligue-o nas Tiles que o usam.');
        return;
      }
      const startedUpload = beginRun('upload');
      if (!startedUpload.ok) {
        fail(startedUpload.message);
        return;
      }

      function titleOfTile(tile: Tile): string {
        const size = outputSize(tile.doc);
        return postTitle(tile.doc.source?.name ?? 'carta', size.width, size.height);
      }

      const group =
        requested !== '' || resumePostId != null || (saved.samePost && tiles.length > 1);
      const groupTitle = group ? groupPostTitle(titleOfTile(tiles[0]), tiles.length) : '';
      let cap = uploadBatchSize(saved.imageChestGold);
      // A retry carries the links the first attempt already copied, so the `$`
      // set the user gets is the whole batch, not just the retried Tiles.
      const links: string[] = [...(previousLinks ?? [])];
      const sent = new Set<string>();
      let postId: string | null = resumePostId ?? (requested || null);
      // The ids the Post already holds, carried from chunk to chunk so an
      // append validates the Post once per batch instead of once per request.
      let knownImages: ReadonlySet<string> | undefined;
      let rendered = 0;

      // "Tentar de novo" repeats this batch without resending what already went
      // up, appends to the Post the first attempt created, and keeps its links.
      retryRef.current = () => handleUploadAll(new Set(sent), postId, links);

      setUploading(true);
      clearNotice();
      setBadges((current) => ({
        ...current,
        ...Object.fromEntries(
          tiles.map((tile) => [tile.id, { label: 'na fila', tone: 'busy' as const }]),
        ),
      }));

      type Entry = { tile: Tile; upload: UploadFile; size: number; format: ExportFormat };

      const record = (entry: Entry, image: { imageId: string; link: string }, owner: string) => {
        const source = entry.tile.doc.source;
        links.push(image.link);
        sent.add(entry.tile.id);
        setBadges((current) => ({
          ...current,
          [entry.tile.id]: { label: 'enviado', tone: 'ok' },
        }));
        if (!source) return;
        const size = outputSize(entry.tile.doc);
        persistHistory(
          appendHistory(historyRef.current, {
            kind: 'upload',
            link: image.link,
            postId: owner,
            imageId: image.imageId,
            title: postTitle(source.name, size.width, size.height),
            format: entry.format,
            size: entry.size,
            createdAt: new Date().toISOString(),
          }),
        );
      };

      const renderEntry = async (tile: Tile): Promise<Entry | null> => {
        const current = tile.doc;
        if (!current.source) return null;
        setBatch({
          label: 'Renderizando',
          done: rendered,
          total: tiles.length,
          name: current.source.name,
        });
        rendered += 1;
        const kind = exportKindFor(effectiveSource(current), saved.exportFormat);
        const bytes = await renderWithProgress(current, frameForTile(tile.id));
        return {
          tile,
          size: bytes.length,
          format: kind.format,
          upload: {
            name: exportFileName(
              current.source.name,
              ratioSlug(current.frame.ratio),
              new Date(),
              kind.format,
            ),
            contentType: kind.contentType,
            bytes,
          },
        };
      };

      /**
       * A Tile that fails to render is one bad Tile, not the end of the batch —
       * unless the user cancelled, which aborts everything.
       */
      const renderOne = async (tile: Tile): Promise<Entry | null> => {
        try {
          return await renderEntry(tile);
        } catch (reason) {
          if (reason instanceof ExportError && reason.cancelled) throw reason;
          setBadges((current) => ({
            ...current,
            [tile.id]: { label: 'falhou', tone: 'bad' },
          }));
          return null;
        }
      };

      /** One file over the ceiling is a bad Tile, never a reason to fail the Post. */
      const usable = (entries: readonly Entry[]): Entry[] => {
        const split = partitionBySize(
          entries,
          (entry) => entry.upload.bytes.length,
          MAX_UPLOAD_FILE_BYTES,
        );
        if (split.tooLarge.length > 0) {
          setBadges((current) => {
            const next = { ...current };
            for (const entry of split.tooLarge) {
              next[entry.tile.id] = { label: 'grande', tone: 'bad' };
            }
            return next;
          });
        }
        return split.ok;
      };

      const send = async (
        entries: readonly Entry[],
        target: string | null,
      ): Promise<string | null> => {
        try {
          const outcome = await uploadBatch({
            transport: tauriImageChestTransport,
            token: saved.token,
            files: entries.map((entry) => entry.upload),
            title: groupTitle,
            privacy: saved.defaultPrivacy,
            postId: target,
            knownImages,
            // One credit per Post: only the first image of a new Post gets it.
            // A retry resumes a Post that already has one, and an explicit Post
            // id may be someone else's, so neither credits.
            description:
              saved.uploadCredit && links.length === 0 && resumePostId == null && requested === ''
                ? UPLOAD_CREDIT
                : '',
          });
          knownImages = outcome.knownImages;
          outcome.images.forEach((image, index) => {
            const entry = entries[index];
            if (entry) record(entry, image, outcome.postId);
          });
          return outcome.postId;
        } catch (reason) {
          const demote = shouldDemoteGold({
            gold: settingsRef.current.imageChestGold,
            chunkSize: entries.length,
            code: reason instanceof ImageChestError ? reason.code : null,
            status: reason instanceof ImageChestError ? reason.status : null,
          });
          if (!demote) throw reason;
          // The account is not Gold after all: remember it, warn, and retry the
          // same files in standard-size pieces. The rest of the batch then uses
          // the smaller chunk too.
          persistSettings({ imageChestGold: false });
          cap = UPLOAD_BATCH_STANDARD;
          inform('O Image Chest recusou o lote maior. A conta voltou para 20 arquivos por Post.');
          let next = target;
          for (const small of chunkItems(entries, UPLOAD_BATCH_STANDARD)) {
            next = await send(small, next);
          }
          return next;
        }
      };

      try {
        if (group) {
          // Render one chunk at a time: a 200-file Gold batch must not hold every
          // encoded file in memory before the first request.
          let cursor = 0;
          while (cursor < tiles.length) {
            const chunkTiles = tiles.slice(cursor, cursor + cap);
            cursor += chunkTiles.length;
            const entries: Entry[] = [];
            for (const tile of chunkTiles) {
              const entry = await renderOne(tile);
              if (entry) entries.push(entry);
            }
            const files = usable(entries);
            if (files.length === 0) continue;
            setBatch({
              label: 'Subindo',
              done: Math.max(0, links.length - (previousLinks?.length ?? 0)),
              total: tiles.length,
              name: files[0].tile.doc.source?.name ?? '',
            });
            postId = await send(files, postId);
          }
        } else {
          for (const tile of tiles) {
            const entry = await renderOne(tile);
            if (!entry) continue;
            if (usable([entry]).length === 0) continue;
            setBatch({
              label: 'Subindo',
              done: Math.max(0, links.length - (previousLinks?.length ?? 0)),
              total: tiles.length,
              name: tile.doc.source?.name ?? '',
            });
            const outcome = await uploadBatch({
              transport: tauriImageChestTransport,
              token: saved.token,
              files: [entry.upload],
              title: titleOfTile(tile),
              privacy: saved.defaultPrivacy,
              postId: null,
              // Each Tile owns its Post here, so each one carries the credit.
              description: saved.uploadCredit ? UPLOAD_CREDIT : '',
            });
            outcome.images.forEach((image) => record(entry, image, outcome.postId));
          }
        }

        if (links.length === 0) {
          fail('Nenhuma imagem subiu.');
          return;
        }
        let copied = true;
        try {
          await copyText(joinLinks(links));
        } catch {
          copied = false;
        }
        const where = group
          ? `Post ${postId ?? '—'}`
          : `${links.length} ${links.length === 1 ? 'Post' : 'Posts'}`;
        inform(
          copied
            ? `${links.length} ${links.length === 1 ? 'imagem' : 'imagens'} no ${where} · links copiados`
            : `${links.length} imagens no ${where}. Não foi possível copiar; use o Histórico.`,
        );
      } catch (reason) {
        const cancelled = reason instanceof ExportError && reason.cancelled;
        if (links.length > 0) {
          try {
            await copyText(joinLinks(links));
          } catch {
            // The links are in the Histórico either way.
          }
        }
        // A cancel is not a failure: drop the queued badges instead of painting
        // the untouched Tiles red, and keep the ones that already went up.
        if (cancelled) {
          setBadges((current) => {
            const next = { ...current };
            for (const tile of tiles) {
              // Only the queued ones: a precise 'grande'/'falhou' stays useful.
              if (!sent.has(tile.id) && next[tile.id]?.label === 'na fila') {
                delete next[tile.id];
              }
            }
            return next;
          });
        } else {
          setBadges((current) => {
            const next = { ...current };
            for (const tile of tiles) {
              // Keep the precise reason a Tile already has ('grande', 'falhou').
              if (!sent.has(tile.id) && next[tile.id]?.label === 'na fila') {
                next[tile.id] = { label: 'falhou', tone: 'bad' };
              }
            }
            return next;
          });
        }
        if (cancelled) {
          inform('Render cancelado.');
        } else {
          uploadFailure(reason);
        }
      } finally {
        setBatch(null);
        setRenderProgress(null);
        setUploading(false);
        endRun('upload');
      }
    },
    [
      beginRun,
      clearNotice,
      endRun,
      fail,
      frameForTile,
      inform,
      openSettings,
      persistHistory,
      persistSettings,
      renderWithProgress,
      uploadFailure,
      waifu2xAvailability.status,
    ],
  );

  uploadRef.current = handleUpload;
  uploadAllRef.current = handleUploadAll;

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
      if (account.gold !== null) persistSettings({ imageChestGold: account.gold });
      setTokenResult({
        ok: true,
        message: `Conectado como ${account.name}${account.gold === true ? ' (Gold)' : ''}.`,
      });
    } catch (reason) {
      setTokenResult({ ok: false, message: uploadErrorMessage(reason) });
    } finally {
      setTestingToken(false);
    }
  }, [persistSettings, testingToken]);

  /**
   * Ask Image Chest for the account tier again. The stored flag decides the
   * batch size, so a check that cannot answer leaves it alone rather than
   * downgrading a Gold account.
   */
  const checkAccount = useCallback(async () => {
    if (checkingAccount) return;
    if (!isDesktop()) {
      fail('Verificar a conta só funciona no app desktop.');
      return;
    }
    if (!settingsRef.current.token.trim()) {
      fail('Salve o token do Image Chest antes de verificar a conta.');
      return;
    }
    setCheckingAccount(true);
    try {
      const account = await testConnection(tauriImageChestTransport, settingsRef.current.token);
      if (account.gold !== null) persistSettings({ imageChestGold: account.gold });
      inform(
        account.gold === true
          ? `${account.name}: conta Gold, 200 arquivos por Post.`
          : `${account.name}: conta padrão, 20 arquivos por Post.`,
      );
    } catch (reason) {
      fail(uploadErrorMessage(reason));
    } finally {
      setCheckingAccount(false);
    }
  }, [checkingAccount, fail, inform, persistSettings]);

  const changeAppendPostId = useCallback((value: string) => {
    setAppendPostId(value);
    appendPostIdRef.current = value;
  }, []);

  const commitAppendPostId = useCallback(() => {
    const trimmed = appendPostIdRef.current.trim();
    appendPostIdRef.current = trimmed;
    setAppendPostId(trimmed);
  }, []);

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
  const exportAllRef = useRef(handleExportAll);
  exportAllRef.current = handleExportAll;

  const changePadColor = useCallback((padColor: string) => {
    setStageMode(leavePick);
    setDoc((current) => withPadColor(current, padColor));
  }, []);

  const togglePickPad = useCallback(() => {
    // Arming the eyedropper leaves the crop phase, mirroring the inverse.
    setStageMode((current) =>
      current.kind === 'pick-pad' ? leavePick(current) : enterPickPad(current),
    );
  }, []);

  const pickPadColor = useCallback(
    (hex: string) => {
      setDoc((current) => withPadColor(current, hex));
      setStageMode(leavePick);
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

  const changeWaifu2x = useCallback(
    (patch: Partial<Waifu2xSettings>) => {
      if (patch.enabled && waifu2xAvailability.status !== 'ready') {
        fail(waifu2xAvailability.detail ?? 'O waifu2x não está disponível neste computador.');
        return;
      }
      setOptimizeResult(null);
      setDoc((current) => withWaifu2x(current, patch));
    },
    [fail, waifu2xAvailability.detail, waifu2xAvailability.status],
  );

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
      // The fields edit the raster handed to waifu2x, before its upscale.
      const size = baseOutputSize(current);
      return withResize(current, {
        width,
        height: current.resize?.height ?? size.height,
      });
    });
  }, []);

  const changeResizeHeight = useCallback((height: number) => {
    setOptimizeResult(null);
    setDoc((current) => {
      const size = baseOutputSize(current);
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
    // A manual refresh must re-sample instead of replaying the cached swatches.
    paletteCacheRef.current.delete(docRef.current);
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
      const size = baseOutputSize(current);
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

  /**
   * The proportion belongs to the Active Tile, so an empty Board writes it into
   * the seed instead — the first Tile still arrives at the chosen Frame.
   */
  const changeRatioWithSeed = useCallback(
    (ratio: number) => {
      if (workspaceRef.current.tiles.length > 0 && activeTile(workspaceRef.current)) {
        changeRatio(ratio);
        return;
      }
      setSeedDoc((current) => applyRatio(current, ratio));
      const preset = presetForRatio(ratio);
      // Flush any pending seed write first: the choice must be the last write,
      // otherwise the previous ratio reaches the disk after it.
      markRatioPersisted(preset?.ratio ?? ratio);
      if (preset) persistSettings({ frameRatio: preset.ratio });
    },
    [changeRatio, markRatioPersisted, persistSettings],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog (the proportion popover) already handled this key.
      if (event.defaultPrevented) return;
      // An open dialog owns the keyboard; global shortcuts must not fire.
      if (settingsOpen || shortcutsOpen || ratioOpen || updatePromptVisible) return;
      if (event.key === 'Escape') {
        if (isTextEntry(event.target)) return;
        if (stageMode.kind !== 'idle') {
          event.preventDefault();
          setStageMode(IDLE_STAGE_MODE);
          return;
        }
      }
      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTextEntry(event.target)) return;
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (
        (event.key === 'f' || event.key === 'F') &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        if (isTextEntry(event.target)) return;
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
        if (isTextEntry(event.target)) return;
        if (!doc.source) return;
        event.preventDefault();
        toggleAdjustFrame();
        return;
      }
      if (event.key === ' ' && isAnimated(effectiveSource(doc))) {
        const element = event.target as HTMLElement | null;
        if (isTextEntry(element) || element?.tagName === 'BUTTON') return;
        event.preventDefault();
        togglePlay();
        return;
      }
      const typing = isTextEntry(event.target);
      const shortcut = resolveShortcut(event, { typing });
      if (shortcut) {
        event.preventDefault();
        if (shortcut.kind === 'border') {
          changeBorder({
            width: clampBorderWidth(docRef.current.border.width + shortcut.delta),
          });
        } else if (shortcut.kind === 'preset') {
          changeRatioWithSeed(shortcut.ratio);
        } else if (doc.source && shortcut.kind === 'nudge') {
          pan(shortcut.dx, shortcut.dy, false, 0);
        } else if (doc.source && shortcut.kind === 'zoom') {
          zoomBy(shortcut.factor);
        } else if (doc.source && shortcut.kind === 'rotate') {
          rotate();
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'o') {
        event.preventDefault();
        void handleOpen();
      } else if (key === 's') {
        event.preventDefault();
        void (event.shiftKey ? exportAllRef.current() : exportRef.current());
      } else if (key === 'enter') {
        event.preventDefault();
        void (event.shiftKey ? uploadAllRef.current() : uploadRef.current());
      } else if (key === ',') {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    changeBorder,
    changeRatioWithSeed,
    doc.source,
    handleOpen,
    hasFrames,
    openSettings,
    pan,
    ratioOpen,
    rotate,
    settingsOpen,
    shortcutsOpen,
    stageMode,
    toggleAdjustFrame,
    toggleFrames,
    togglePlay,
    updatePromptVisible,
    zoomBy,
  ]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;

      const files: File[] = [];
      for (const item of data.items) {
        if (item.kind !== 'file' || !/^(image|video)\//.test(item.type)) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length > 0) {
        event.preventDefault();
        void importCandidates(
          files.map((file) => async () => ({
            name: file.name || 'clipboard.png',
            path: null,
            bytes: new Uint8Array(await file.arrayBuffer()),
          })),
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
  }, [importCandidates, importFromUrl, importPath]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    watchFileDrops((paths) => {
      if (paths.length > 0) void importPaths(paths);
    }, setDragOver)
      .then((stop) => {
        dispose = stop;
      })
      .catch(() => {
        fail('Não foi possível ativar o arrastar e soltar. Use Ctrl+O ou Ctrl+V.');
      });
    return () => dispose?.();
  }, [fail, importPaths]);

  // Browser-only fallback so `npm run dev` can exercise the same import path.
  // The desktop window receives OS drops through Tauri instead.
  useEffect(() => {
    if (isDesktop()) return;
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragOver(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      void importCandidates(
        files.map((file) => async () => ({
          name: file.name,
          path: null,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [importCandidates]);

  const sourceView = effectiveSource(doc);

  /** What the Source bar currently holds, so the button can name the action. */
  const linkTarget = sourceUrlFrom(link) ? 'link' : localPathFrom(link) ? 'path' : null;

  return (
    <div className="app">
      {dragOver && (
        <div className="drop-overlay" role="status">
          <div className="drop-overlay-card">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <strong>Solte para abrir</strong>
            <span>PNG · JPG · GIF · WebP · APNG · MP4 · MOV · WebM</span>
          </div>
        </div>
      )}
      <div className="topbar-shell">
        <header className="topbar" data-tauri-drag-region="deep">
          <div className="brand">
            <img className="brand-mark" src={brandIcon} alt="" />
            <span className="brand-name">mudae crop</span>
          </div>
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
            onRatio={changeRatioWithSeed}
            onSnapEnabled={changeSnapRatios}
            onOpenChange={setRatioOpen}
          />
          <div className="topbar-right">
            <form
              className="link-import"
              data-tauri-drag-region="false"
              onSubmit={(event) => {
                event.preventDefault();
                submitLink();
              }}
            >
              <span className="link-import-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <path
                    d="M6.6 9.4a2.5 2.5 0 0 0 3.54 0l2.12-2.12a2.5 2.5 0 0 0-3.54-3.54l-.7.7M9.4 6.6a2.5 2.5 0 0 0-3.54 0L3.74 8.72a2.5 2.5 0 0 0 3.54 3.54l.7-.7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <input
                type="text"
                inputMode="url"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="Cole um link ou caminho"
                aria-label="Link ou caminho da Source"
                spellCheck={false}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !linkTarget}>
                Abrir
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
            <button
              type="button"
              className="chip chip-button shortcuts-button"
              onClick={() => setShortcutsOpen(true)}
              title="Atalhos (?)"
              aria-label="Atalhos"
            >
              ?
            </button>
            <button
              type="button"
              className="chip chip-button"
              onClick={openSettings}
              title="Configurações (Ctrl+,)"
            >
              Configurações
            </button>
          </div>
          <WindowControls />
        </header>

        {notice.kind === 'info' && (
          <div className="notice overlay" role="status">
            <span>{notice.message}</span>
            <button type="button" aria-label="Fechar aviso" onClick={clearNotice}>
              ×
            </button>
          </div>
        )}
      </div>

      {download.kind === 'downloading' ? (
        <div className="notice download" role="status">
          <span>
            Baixando link… {formatBytes(download.received)}
            {download.total ? ` de ${formatBytes(download.total)}` : ''}
          </span>
          <progress
            value={download.total ? download.received : undefined}
            max={download.total ?? undefined}
          />
          <button type="button" onClick={cancelDownload}>
            cancelar
          </button>
        </div>
      ) : importQueue ? (
        <div className="notice download" role="status">
          <span>
            Importando {Math.min(importQueue.total, importQueue.done + 1)} de {importQueue.total}…
          </span>
          <progress value={importQueue.done} max={importQueue.total} />
        </div>
      ) : download.kind === 'finishing' ? (
        <div className="notice download" role="status">
          <span>Importando…</span>
          <progress />
        </div>
      ) : batch ? (
        <div className="notice download render" role="status">
          <span>
            {batch.label} {Math.min(batch.total, batch.done + 1)} de {batch.total}
            {batch.name ? ` · ${batch.name}` : ''}…
          </span>
          <progress value={batch.done} max={batch.total} />
          {batch.label !== 'Subindo' && (
            <button type="button" onClick={cancelRender}>
              cancelar
            </button>
          )}
        </div>
      ) : renderProgress ? (
        <div className="notice download render" role="status">
          <span>
            {renderProgress.phase === 'optimize'
              ? 'Otimizando GIF'
              : renderProgress.phase === 'waifu2x'
                ? 'Realçando com waifu2x'
                : 'Renderizando'}
            …{' '}
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
      ) : notice.kind === 'error' ? (
        <div className="notice error" role="alert">
          <span>{notice.message}</span>
          {notice.action && (
            <button type="button" className="notice-action" onClick={notice.action.run}>
              {notice.action.label}
            </button>
          )}
          <button type="button" aria-label="Fechar aviso" onClick={clearNotice}>
            ×
          </button>
        </div>
      ) : null}

      <main className={`workspace${workspace.tiles.length === 0 ? ' workspace-empty' : ''}`}>
        {active && (
          <ToolRail
            doc={doc}
            onMode={changeMode}
            onZoom={changeZoom}
            onOffset={changeOffset}
            onPadColor={changePadColor}
            onRotate={rotate}
            onResetCrop={reset}
            onSharpness={changeSharpness}
            waifu2x={doc.waifu2x}
            waifu2xStatus={waifu2xAvailability.status}
            waifu2xDetail={waifu2xAvailability.detail}
            onWaifu2x={changeWaifu2x}
            onPickPadColor={togglePickPad}
            onTrim={changeTrim}
            onSpeed={changeSpeed}
            pickingPad={stageMode.kind === 'pick-pad'}
            framesOpen={framesOpen}
            onToggleFrames={toggleFrames}
            adjustFrame={adjustFrame}
            onToggleAdjustFrame={toggleAdjustFrame}
          />
        )}
        <div className="stage-column">
          <Board
            workspace={workspace}
            frameIndex={frameIndex}
            frameVersion={frameVersion}
            mode={stageMode}
            snapRatios={snapRatios}
            busy={busy}
            emptyRatio={seedDoc.frame.ratio}
            exportFormat={settings.exportFormat}
            frameIndexFor={frameForTile}
            badges={badges}
            onActivate={handleActivateTile}
            onRemove={handleRemoveTile}
            onMove={handleMoveTile}
            onOpen={handleOpen}
            onPanTo={panTo}
            onZoomAt={zoomAtPoint}
            onResizeTo={resizeTo}
            onPickColor={pickPadColor}
            onPickMiss={pickPadMiss}
            onExitAdjust={() => setStageMode(IDLE_STAGE_MODE)}
            onExitPick={() => setStageMode(IDLE_STAGE_MODE)}
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
          {isAnimated(sourceView) && (
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
        {active && (
          <ExportPanel
            doc={doc}
            busy={busy}
            exporting={activity === 'export'}
            downloading={download.kind === 'downloading'}
            uploading={uploading}
            settings={settings}
            history={history}
            preview={historyPreview}
            cooldownSeconds={cooldownSeconds}
            appendPostId={appendPostId}
            optimizeResult={optimizeResult}
            sizeEstimate={sizeEstimate}
            waifu2xReady={waifu2xAvailability.status === 'ready'}
            tileCount={readyTiles(workspace).length}
            samePost={settings.samePost}
            onSamePost={(samePost) => persistSettings({ samePost })}
            onExport={handleExport}
            onExportAll={handleExportAll}
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
            onUploadAll={startUploadAll}
            onOpenSettings={openSettings}
            onCopyText={copyExportText}
            onOpenLink={openExportLink}
            onRevealPath={revealExportPath}
            onClearHistory={clearHistory}
          />
        )}
      </main>

      {doc.source && (
        <BorderBar
          border={doc.border}
          palette={palette}
          hasSource
          onColor={(color) => changeBorder({ color })}
          onWidth={(width) => changeBorder({ width })}
          onCopy={copyExportText}
          onRecalc={recalcPalette}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          desktop={isDesktop()}
          testing={testingToken}
          testResult={tokenResult}
          checkingAccount={checkingAccount}
          version={updater.version}
          updateStatus={updater.status}
          onChange={persistSettings}
          onClose={() => setSettingsOpen(false)}
          onTestConnection={() => void testToken()}
          onCheckAccount={() => void checkAccount()}
          onClearToken={clearToken}
          onOpenApiKeyPage={() => void openLink(IMAGE_CHEST_API_KEY_URL)}
          onChooseFolder={() => void chooseFolder()}
          onClearFolder={() => persistSettings({ saveFolder: null })}
          onCheckUpdate={updater.check}
          onOpenRepository={() => void openLink(REPO_URL)}
        />
      )}

      {updatePromptVisible && (
        <UpdateDialog
          phase={updater.status.phase}
          version={updater.status.version}
          current={updater.version}
          detail={updater.status.detail}
          progressLabel={updater.progressLabel}
          percent={updater.percent}
          canCancel={!updater.portable}
          onInstall={updater.install}
          onLater={updater.later}
          onSkip={updater.skip}
          onCancel={updater.cancel}
          onCloseFailure={updater.closeFailure}
          onOpenReleases={() => void openLink(RELEASES_URL)}
        />
      )}

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
