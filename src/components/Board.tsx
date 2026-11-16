import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  BOARD_GAP,
  BOARD_PAD,
  boardTileWidth,
  boardZoomAfterWheel,
  fitAllTileWidth,
  MIN_BOARD_ZOOM,
  tileCardHeight,
} from '../core/board';
import { effectiveSource, outputSize, type DocumentState, type Rect } from '../core/document';
import { exportKindFor, type ExportFileFormat } from '../core/export';
import { borderReferenceWidth, renderFrame } from '../core/render';
import type { StageMode } from '../core/stageMode';
import { activeTile, type Tile, type Workspace } from '../core/workspace';
import { EmptyBoard } from './EmptyBoard';
import { Stage } from './Stage';

/** A transient note on one Tile: uploading, sent, or a batch failure. */
export interface TileBadge {
  readonly label: string;
  readonly tone: 'busy' | 'ok' | 'bad';
}

interface BoardProps {
  readonly workspace: Workspace;
  readonly frameIndex: number;
  readonly frameVersion: number;
  readonly mode: StageMode;
  readonly snapRatios: boolean;
  readonly busy: boolean;
  /** The Frame proportion an empty Board draws in its invitation. */
  readonly emptyRatio: number;
  /** The format a batch would write, so a Tile can name its output. */
  readonly exportFormat: ExportFileFormat;
  readonly badges?: Readonly<Record<string, TileBadge>>;
  /** The playhead a background Tile previews at. */
  readonly frameIndexFor?: (id: string) => number;
  readonly onActivate: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, beforeId: string | null) => void;
  readonly onOpen: () => void;
  readonly onPanTo: (rect: Rect) => void;
  readonly onZoomAt: (point: { x: number; y: number }, factor: number) => void;
  readonly onResizeTo: (rect: Rect, ratio: number) => void;
  readonly onPickColor: (hex: string) => void;
  readonly onPickMiss: (reason: 'outside' | 'transparent') => void;
  /** Leaves the adjust phase, which the Board shows as an exposed Tile. */
  readonly onExitAdjust: () => void;
  /** Leaves the eyedropper, which also shows the Active Tile exposed. */
  readonly onExitPick: () => void;
}

interface TileCardProps {
  readonly doc: DocumentState;
  readonly width: number;
  readonly height: number;
  readonly frameIndex: number;
  readonly frameVersion: number;
}

/**
 * The static card of a Tile that is not active. It paints the same renderFrame
 * the Export writes, at the Tile's display size, so the Board reads as a wall
 * of finished cards.
 */
const TileCard = memo(function TileCard({
  doc,
  width,
  height,
  frameIndex,
  frameVersion,
}: TileCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !(width > 0) || !(height > 0)) return;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    renderFrame(context, doc, {
      outputWidth: pixelWidth,
      outputHeight: pixelHeight,
      border: doc.source
        ? {
            scale: pixelWidth / outputSize(doc).width,
            minPx: 1,
            referenceWidth: borderReferenceWidth(doc),
          }
        : undefined,
      frameIndex,
    });
  }, [doc, width, height, frameIndex, frameVersion]);

  return (
    <canvas ref={canvasRef} className="tile-preview" style={{ width, height }} aria-hidden="true" />
  );
});

interface TileViewProps {
  readonly tile: Tile;
  readonly index: number;
  readonly active: boolean;
  readonly reordering: boolean;
  readonly dragging: boolean;
  readonly width: number;
  readonly height: number;
  readonly badge: TileBadge | null;
  readonly format: string;
  readonly size: { width: number; height: number } | null;
  readonly busy: boolean;
  readonly children: ReactNode;
  readonly onActivate: () => void;
  readonly onRemove: () => void;
  readonly onExpose: () => void;
  readonly onReorderStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onReorderMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onReorderEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Move this Tile one slot left or right from the keyboard. */
  readonly onReorderStep: (delta: -1 | 1) => void;
}

/**
 * One Tile on the Board: a title row, a card and a footer with the output size.
 * The remove button floats over the card corner and only exists on hover, so a
 * wall of cards stays calm and the title row never reserves space for it.
 */
function TileView({
  tile,
  index,
  active,
  reordering,
  dragging,
  width,
  height,
  badge,
  format,
  size,
  busy,
  children,
  onActivate,
  onRemove,
  onExpose,
  onReorderStart,
  onReorderMove,
  onReorderEnd,
  onReorderStep,
}: TileViewProps) {
  const name = tile.doc.source?.name ?? 'Importação falhou';

  return (
    <div
      className={`tile${active ? ' active' : ''}${reordering ? ' reordering' : ''}${
        dragging ? ' dragging' : ''
      }`}
      data-tile-id={tile.id}
      style={{ width }}
      tabIndex={0}
      role="group"
      aria-label={`${name}${active ? ' (ativa)' : ''}`}
      aria-current={active ? 'true' : undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // The remove button owns its click: it must not activate (and start
        // playing) a Tile that is about to disappear.
        if ((event.target as HTMLElement).closest('.tile-kill')) return;
        if (reordering) {
          onReorderStart(event);
          return;
        }
        if (!active) onActivate();
      }}
      onPointerMove={onReorderMove}
      onPointerUp={onReorderEnd}
      onPointerCancel={onReorderEnd}
      onDoubleClick={(event) => {
        if (reordering) return;
        event.preventDefault();
        onExpose();
      }}
      onKeyDown={(event) => {
        if (
          reordering &&
          event.altKey &&
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        ) {
          event.preventDefault();
          onReorderStep(event.key === 'ArrowLeft' ? -1 : 1);
          return;
        }
        if (event.key !== 'Enter') return;
        // The remove button owns Enter too: never activate a Tile being deleted.
        if ((event.target as HTMLElement).closest('.tile-kill')) return;
        event.preventDefault();
        onActivate();
      }}
    >
      <div className="tile-head">
        {reordering && <span className="tile-num">{index + 1}</span>}
        <span className="tile-name" title={`${name} · duplo clique para expor`}>
          {name}
        </span>
        {badge && (
          <span className={`tile-badge ${badge.tone}`} title={badge.label}>
            {badge.label}
          </span>
        )}
      </div>
      <div className="tile-card" style={{ width, height }}>
        {children}
        {!reordering && !busy && (
          <button
            type="button"
            className="tile-kill"
            aria-label={`Remover ${name}`}
            title="Remover do Board"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div className="tile-foot">
        {tile.doc.source && size ? (
          <>
            <span>{format}</span>
            <span>
              {size.width}×{size.height}
            </span>
          </>
        ) : (
          <span className="tile-error">{tile.error}</span>
        )}
      </div>
    </div>
  );
}

/**
 * The Board: a scrollable canvas of Tiles. The wheel scrolls it like any other
 * surface; Ctrl+wheel zooms around the cursor. It opens at "fit all" and never
 * zooms out past it, so the wall always fills the viewport.
 *
 * Reordering is a live pointer drag: the number badges show the Post/Export
 * order and a Tile follows the pointer into its new slot.
 */
export function Board({
  workspace,
  frameIndex,
  frameVersion,
  mode,
  snapRatios,
  busy,
  emptyRatio,
  exportFormat,
  badges = {},
  frameIndexFor,
  onActivate,
  onRemove,
  onMove,
  onOpen,
  onPanTo,
  onZoomAt,
  onResizeTo,
  onPickColor,
  onPickMiss,
  onExitAdjust,
  onExitPick,
}: BoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(MIN_BOARD_ZOOM);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [reordering, setReordering] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [exposedId, setExposedId] = useState<string | null>(null);
  const active = activeTile(workspace);
  const exposed = exposedId
    ? (workspace.tiles.find((tile) => tile.id === exposedId) ?? null)
    : null;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Mixed ratios fit by their tallest card, so no Tile is cut off.
  const ratio = useMemo(() => {
    const ratios = workspace.tiles
      .map((tile) => tile.doc.frame.ratio)
      .filter((value) => Number.isFinite(value) && value > 0);
    return ratios.length > 0 ? Math.min(...ratios) : emptyRatio;
  }, [workspace.tiles, emptyRatio]);

  const fit = fitAllTileWidth(viewport.width, viewport.height, workspace.tiles.length, ratio);
  const tileWidth = boardTileWidth(fit, zoom);

  // The spotlight gets the whole stage: the Source is fitted so the Crop stays
  // visible with its surroundings, and the adjust phase gets the same box.
  const adjusting = mode.kind === 'adjust' && active !== null;
  // Adjusting and picking both need the full stage: the handles, and a Frame
  // canvas big enough for an exact colour sample.
  const spotlightTile = adjusting || mode.kind === 'pick-pad' ? active : exposed;
  const spotlightBox = {
    width: Math.max(320, viewport.width - 64),
    height: Math.max(280, viewport.height - 96),
  };

  function closeSpotlight() {
    if (adjusting) {
      // Leaving adjust must not leave a stale spotlight behind.
      setExposedId(null);
      onExitAdjust();
      return;
    }
    if (mode.kind === 'pick-pad') {
      setExposedId(null);
      onExitPick();
      return;
    }
    setExposedId(null);
  }

  // A Board with one Tile has nothing to reorder, and leaving the mode on would
  // keep every card inert.
  useEffect(() => {
    if (workspace.tiles.length < 2) setReordering(false);
  }, [workspace.tiles.length]);

  // An emptied Board forgets its zoom, and so does a replace import that swaps
  // every Tile in one commit (no empty render ever happens there).
  const previousIdsRef = useRef<readonly string[]>([]);
  useEffect(() => {
    const previous = previousIdsRef.current;
    const current = workspace.tiles.map((tile) => tile.id);
    previousIdsRef.current = current;
    if (current.length === 0) {
      setZoom(MIN_BOARD_ZOOM);
      return;
    }
    if (previous.length > 0 && !current.some((id) => previous.includes(id))) {
      setZoom(MIN_BOARD_ZOOM);
    }
  }, [workspace.tiles]);

  // A removed Tile cannot stay exposed.
  useEffect(() => {
    if (!exposedId) return;
    if (workspace.tiles.some((tile) => tile.id === exposedId)) return;
    setExposedId(null);
  }, [workspace.tiles, exposedId]);

  // Esc leaves the exposed Tile, then the reorder mode.
  useEffect(() => {
    if (!exposedId && !reordering) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (exposedId) setExposedId(null);
      else setReordering(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exposedId, reordering]);

  // Plain wheel scrolls the Board; Ctrl+wheel zooms around the pointer. The
  // listener sits on the wrap so the spotlight (a sibling of the scroller) is
  // covered too, and the WebView never page-zooms instead.
  useEffect(() => {
    const element = wrapRef.current;
    const viewport = viewportRef.current;
    if (!element || !viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      if (!workspace.tiles.length) return;
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const contentX = pointerX + viewport.scrollLeft;
      const contentY = pointerY + viewport.scrollTop;
      const current = zoomRef.current;
      const next = boardZoomAfterWheel(current, event.deltaY);
      if (next === current) return;
      const scale = next / current;
      setZoom(next);
      requestAnimationFrame(() => {
        viewport.scrollLeft = contentX * scale - pointerX;
        viewport.scrollTop = contentY * scale - pointerY;
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [workspace.tiles.length]);

  function startReorder(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    // preventDefault also blocks the focus the Alt+Arrow reorder needs.
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(id);
  }

  function moveReorder(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingId) return;
    // Hit-test the slots by rect instead of elementFromPoint: the dragged Tile
    // is under the pointer and would answer for itself.
    const slots = Array.from(
      viewportRef.current?.querySelectorAll<HTMLElement>('[data-tile-id]') ?? [],
    );
    const hovered = slots.find((slot) => {
      const bounds = slot.getBoundingClientRect();
      return (
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom
      );
    });
    const overId = hovered?.dataset.tileId;
    if (!overId || overId === draggingId) return;
    const order = workspace.tiles.map((tile) => tile.id);
    const from = order.indexOf(draggingId);
    const to = order.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    // One event moves the Tile onto the hovered slot and no further. After the
    // reorder the hovered slot holds the dragged Tile, so the next event over
    // the same spot is a no-op instead of a runaway.
    onMove(draggingId, from < to ? (order[to + 1] ?? null) : order[to]);
  }

  function endReorder() {
    setDraggingId(null);
  }

  function outputOf(doc: DocumentState): {
    format: string;
    size: { width: number; height: number } | null;
  } {
    const kind = exportKindFor(effectiveSource(doc), exportFormat);
    return { format: kind.label, size: doc.source ? outputSize(doc) : null };
  }

  function renderCard(
    tile: Tile,
    width: number,
    height: number,
    live = true,
    surround = false,
  ): ReactNode {
    if (tile.error !== null) {
      return (
        <div className="tile-placeholder" role="alert">
          <strong>Não foi possível importar</strong>
          <span>{tile.error}</span>
        </div>
      );
    }
    if (live && tile.id === active?.id) {
      return (
        <Stage
          doc={tile.doc}
          frameIndex={frameIndex}
          frameVersion={frameVersion}
          onPanTo={onPanTo}
          onZoomAt={onZoomAt}
          onResizeTo={onResizeTo}
          mode={mode}
          snapRatios={snapRatios}
          embedded
          surround={surround}
          onPickColor={onPickColor}
          onPickMiss={onPickMiss}
        />
      );
    }
    return (
      <TileCard
        doc={tile.doc}
        width={width}
        height={height}
        frameIndex={frameIndexFor?.(tile.id) ?? 0}
        frameVersion={tile.doc.source?.video ? frameVersion : 0}
      />
    );
  }

  const spotlightOutput = spotlightTile ? outputOf(spotlightTile.doc) : null;

  return (
    <div className="board-wrap" id="tour-board" ref={wrapRef}>
      <div
        ref={viewportRef}
        className={`board${reordering ? ' reordering' : ''}`}
        onPointerUp={endReorder}
        onPointerCancel={endReorder}
        onContextMenu={(event) => event.preventDefault()}
      >
        {workspace.tiles.length === 0 ? (
          <EmptyBoard ratio={emptyRatio} busy={busy} onOpen={onOpen} />
        ) : (
          <div
            className={`board-canvas${workspace.tiles.length === 1 ? ' single' : ''}`}
            style={{ gap: BOARD_GAP, padding: BOARD_PAD }}
          >
            {workspace.tiles.map((tile, index) => {
              const cardHeight = tileCardHeight(tileWidth, tile.doc.frame.ratio || ratio);
              const output = outputOf(tile.doc);
              return (
                <TileView
                  key={tile.id}
                  tile={tile}
                  index={index}
                  active={tile.id === active?.id}
                  reordering={reordering}
                  dragging={tile.id === draggingId}
                  width={tileWidth}
                  height={cardHeight}
                  badge={badges[tile.id] ?? null}
                  format={output.format}
                  size={output.size}
                  busy={busy}
                  onActivate={() => onActivate(tile.id)}
                  onRemove={() => onRemove(tile.id)}
                  onExpose={() => {
                    if (!tile.doc.source) return;
                    onActivate(tile.id);
                    setExposedId(tile.id);
                  }}
                  onReorderStart={(event) => startReorder(event, tile.id)}
                  onReorderMove={moveReorder}
                  onReorderEnd={endReorder}
                  onReorderStep={(delta) => {
                    const order = workspace.tiles.map((entry) => entry.id);
                    const from = order.indexOf(tile.id);
                    const to = from + delta;
                    if (from < 0 || to < 0 || to >= order.length) return;
                    onMove(tile.id, delta > 0 ? (order[to + 1] ?? null) : order[to]);
                  }}
                >
                  {renderCard(tile, tileWidth, cardHeight, !spotlightTile && !reordering)}
                </TileView>
              );
            })}
          </div>
        )}
      </div>

      {workspace.tiles.length > 1 && (
        <div className="board-dock">
          <button
            type="button"
            className={`chip chip-button${reordering ? ' on' : ''}`}
            onClick={() => setReordering((current) => !current)}
            aria-pressed={reordering}
            title={
              reordering
                ? 'Concluir a ordem dos Tiles'
                : 'Arrastar os Tiles para mudar a ordem do Post e do Export'
            }
          >
            {reordering ? 'Pronto' : 'Reordenar'}
          </button>
        </div>
      )}

      {spotlightTile && (
        <div
          className={`board-spotlight${adjusting ? ' adjusting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={`${spotlightTile.doc.source?.name ?? 'Tile'} em exposição`}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeSpotlight();
          }}
        >
          <div className="spotlight-card" style={{ width: spotlightBox.width }}>
            <div className="spotlight-head">
              <span className="tile-name" title={spotlightTile.doc.source?.name}>
                {spotlightTile.doc.source?.name}
              </span>
              <span className="spotlight-hint">
                {adjusting ? 'Esc ou C conclui o ajuste' : 'Esc ou clique fora para voltar'}
              </span>
            </div>
            <div
              className={`spotlight-frame${adjusting ? ' adjusting' : ''}`}
              style={{ width: spotlightBox.width, height: spotlightBox.height }}
              onDoubleClick={closeSpotlight}
            >
              {renderCard(
                spotlightTile,
                spotlightBox.width,
                spotlightBox.height,
                true,
                // Picking a colour needs the real Frame canvas, so the cutout
                // steps aside and the card fills the spotlight.
                mode.kind !== 'pick-pad',
              )}
            </div>
            <div className="tile-foot">
              <span>{spotlightOutput?.format}</span>
              <span>
                {spotlightOutput?.size
                  ? `${spotlightOutput.size.width}×${spotlightOutput.size.height}`
                  : ''}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
