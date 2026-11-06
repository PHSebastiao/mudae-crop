import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadDir, join } from '@tauri-apps/api/path';
import { emptyDocument, withCrop, withSource, FIT_CROP, type DocumentState } from './core/document';
import { renderPng } from './core/export';
import { panBy, zoomAt } from './core/geometry';
import { importErrorMessage, loadSource, type SourceCandidate } from './core/import';
import { exportFileName } from './core/naming';
import { browserExportAdapter, decodeWithBrowser } from './platform/browser';
import {
  chooseExportPath,
  chooseSourceFile,
  fileNameOf,
  isDesktop,
  readFileBytes,
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
  const docRef = useRef(doc);
  docRef.current = doc;

  const importCandidate = useCallback(async (candidate: SourceCandidate) => {
    setBusy(true);
    try {
      const source = await loadSource(candidate, decodeWithBrowser);
      setDoc((current) => withSource(current, source));
      setError(null);
      setStatus(`Source carregada: ${source.name}`);
    } catch (reason) {
      setError(importErrorMessage(reason));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const importPath = useCallback(
    async (path: string) => {
      const name = fileNameOf(path);
      try {
        const bytes = await readFileBytes(path);
        await importCandidate({ name, path, bytes });
      } catch (reason) {
        setError(`Não foi possível ler "${name}". ${messageOf(reason)}`);
        setStatus(null);
        setBusy(false);
      }
    },
    [importCandidate],
  );

  const handleOpen = useCallback(async () => {
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
    try {
      if (!isDesktop()) {
        setError('Exportar só funciona no app desktop.');
        return;
      }
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
      setBusy(true);
      const bytes = await renderPng(current, 1, browserExportAdapter);
      await writeFileBytes(path, bytes);
      setError(null);
      setStatus(`PNG ${current.frame.width}×${current.frame.height} exportado: ${fileNameOf(path)}`);
    } catch (reason) {
      setError(`Não foi possível exportar o PNG. ${messageOf(reason)}`);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const exportRef = useRef(handleExport);
  exportRef.current = handleExport;

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
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
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
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [importCandidate]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    watchFileDrops((paths) => {
      const first = paths[0];
      if (first) void importPath(first);
    })
      .then((stop) => {
        dispose = stop;
      })
      .catch(() => undefined);
    return () => dispose?.();
  }, [importPath]);

  const sourceChip = doc.source
    ? `${doc.source.format.toUpperCase()} · ${doc.source.width}×${doc.source.height}`
    : 'sem Source';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">mudae crop</div>
        <div className="preset-toggle" role="group" aria-label="Preset do Frame">
          <span className="on">Mudae 225×350</span>
          <span className="disabled" title="Square chega numa próxima etapa">
            Square 350×350
          </span>
        </div>
        <div className="topbar-right">
          <span className="chip">{sourceChip}</span>
          <span className="chip">waifu2x off</span>
        </div>
      </header>

      {(error || status) && (
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
            ×
          </button>
        </div>
      )}

      <main className="workspace">
        <ToolRail doc={doc} onResetCrop={() => setDoc((current) => withCrop(current, FIT_CROP))} />
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
        <ExportPanel doc={doc} busy={busy} onExport={handleExport} />
      </main>

      <BorderBar />
    </div>
  );
}
