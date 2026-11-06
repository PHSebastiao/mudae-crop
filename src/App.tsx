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
import { exportFileName } from './core/naming';
import { browserExportAdapter, decodeWithBrowser } from './platform/browser';
import {
  chooseExportPath,
  chooseSourceFile,
  fileNameOf,
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

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return 'Algo deu errado.';
}

export default function App() {
  const [doc, setDoc] = useState<DocumentState>(emptyDocument);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<{
    received: number;
    total: number | null;
  } | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const runningRef = useRef(false);
  const cancelDownloadRef = useRef<(() => void) | null>(null);

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

  const refuseBecauseBusy = useCallback(() => {
    setError('Termine a operação em andamento antes de importar outra Source.');
    setStatus(null);
  }, []);

  const applyCandidate = useCallback(async (candidate: SourceCandidate) => {
    const source = await loadSource(candidate, decodeWithBrowser);
    setDoc((current) => withSource(current, source));
    setError(null);
    setStatus(`Source carregada: ${source.name}`);
  }, []);

  const importCandidate = useCallback(
    async (candidate: SourceCandidate) => {
      if (!beginRun()) {
        refuseBecauseBusy();
        return;
      }
      try {
        await applyCandidate(candidate);
      } catch (reason) {
        setError(importErrorMessage(reason));
        setStatus(null);
      } finally {
        endRun();
      }
    },
    [applyCandidate, beginRun, endRun, refuseBecauseBusy],
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
          setError(`Não foi possível ler "${name}". ${messageOf(reason)}`);
          setStatus(null);
          return;
        }
        try {
          await applyCandidate({ name, path, bytes });
        } catch (reason) {
          setError(importErrorMessage(reason));
          setStatus(null);
        }
      } finally {
        endRun();
      }
    },
    [applyCandidate, beginRun, endRun, refuseBecauseBusy],
  );

  const importFromUrl = useCallback(
    async (raw: string) => {
      if (!isDesktop()) {
        setError('Importar por link só funciona no app desktop.');
        setStatus(null);
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
          setError(null);
          setStatus('Download cancelado.');
        } else {
          setError(downloadErrorMessage(reason));
          setStatus(null);
        }
      } finally {
        cancelDownloadRef.current = null;
        setDownloadProgress(null);
        endRun();
      }
    },
    [applyCandidate, beginRun, endRun, refuseBecauseBusy],
  );

  const cancelDownload = useCallback(() => {
    cancelDownloadRef.current?.();
  }, []);

  const handleOpen = useCallback(async () => {
    if (runningRef.current) return;
    try {
      if (!isDesktop()) {
        setError('Abrir arquivos só funciona no app desktop.');
        return;
      }
      const path = await chooseSourceFile();
      if (path) await importPath(path);
    } catch (reason) {
      setError(`Não foi possível abrir o diálogo de arquivos. ${messageOf(reason)}`);
    }
  }, [importPath]);

  const handleExport = useCallback(async () => {
    const current = docRef.current;
    if (!current.source) return;
    if (!isDesktop()) {
      setError('Exportar só funciona no app desktop.');
      return;
    }
    if (!beginRun()) return;
    try {
      const name = exportFileName(current.source.name, current.frame.id, new Date());
      let defaultPath = name;
      try {
        defaultPath = await join(await downloadDir(), name);
      } catch {
        // Without a known download folder the bare file name still works.
      }
      const chosen = await chooseExportPath(defaultPath);
      if (!chosen) return;
      const path = /\.png$/i.test(chosen) ? chosen : `${chosen}.png`;
      if (current.source.path && path.toLowerCase() === current.source.path.toLowerCase()) {
        throw new Error('o Export não pode sobrescrever a Source. Escolha outro nome.');
      }
      const bytes = await renderPng(current, current.exportScale, browserExportAdapter);
      await writeFileBytes(path, bytes);
      const size = outputSize(current);
      setError(null);
      setStatus(`PNG ${size.width}×${size.height} exportado: ${fileNameOf(path)}`);
    } catch (reason) {
      setError(`Não foi possível exportar o PNG. ${messageOf(reason)}`);
      setStatus(null);
    } finally {
      endRun();
    }
  }, [beginRun, endRun]);

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

  const changeExportScale = useCallback((exportScale: ExportScale) => {
    setDoc((current) => withExportScale(current, exportScale));
  }, []);

  const rotate = useCallback(() => {
    setDoc((current) => withCrop(current, rotate90(current, current.crop)));
  }, []);

  const reset = useCallback(() => {
    setDoc((current) => withCrop(current, resetCrop(current.crop)));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'o') {
        event.preventDefault();
        void handleOpen();
      } else if (key === 's') {
        event.preventDefault();
        void exportRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleOpen]);

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
        setError('Não foi possível ativar o arrastar e soltar. Use Ctrl+O ou Ctrl+V.');
      });
    return () => dispose?.();
  }, [importPath]);

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
            <button
              type="button"
              aria-label="Fechar aviso"
              onClick={() => {
                setError(null);
                setStatus(null);
              }}
            >
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
          onExport={handleExport}
          onExportScale={changeExportScale}
        />
      </main>

      <BorderBar />
    </div>
  );
}
