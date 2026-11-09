import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { toHexColor } from '../core/color';
import {
  animationFrameCount,
  effectiveSource,
  isAnimated,
  outputSize,
  type DocumentState,
} from '../core/document';
import { formatFps, formatPlaybackDuration } from '../core/animation';
import { formatBytes } from '../core/download';
import { centreSnapAxes, frameRect, rotatedBounds } from '../core/geometry';
import { stageLayout, type Handle } from '../core/rect';
import { ratioLabel } from '../core/ratios';
import { drawSource, paintsPadColor, renderFrame } from '../core/render';
import { stageModeOf } from '../core/stageMode';

/** Screen pixels of drag before a free resize starts snapping. */
const SNAP_START_PX = 6;

/** Screen pixels within which a pan holds the Frame at the Source centre. */
const CENTRE_SNAP_PX = 6;

/** How close the rect centre must be to count as snapped, in Source pixels. */
const CENTRE_SNAP_EPSILON = 0.01;

const NO_CENTRE_SNAP = { x: false, y: false } as const;

const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'canto superior esquerdo',
  n: 'borda superior',
  ne: 'canto superior direito',
  e: 'borda direita',
  se: 'canto inferior direito',
  s: 'borda inferior',
  sw: 'canto inferior esquerdo',
  w: 'borda esquerda',
};

const MAGNIFIER_SIZE = 184;
const MAGNIFIER_CANVAS = 180;
const MAGNIFIER_REGION = 9;
const MAGNIFIER_OFFSET = 22;
const MAGNIFIER_MARGIN = 12;

interface MagnifierState {
  readonly left: number;
  readonly top: number;
  readonly sx: number;
  readonly sy: number;
  readonly hex: string;
}

interface StageProps {
  readonly doc: DocumentState;
  /** Frame index in the document's animation view, after any frame edits. */
  readonly frameIndex: number;
  /** Bumped after an async video seek so the canvas is redrawn. */
  readonly frameVersion?: number;
  /**
   * Delta in rotated Source pixels plus the centre-snap state; the caller
   * applies it to its latest Crop.
   */
  readonly onPan: (dx: number, dy: number, snapCenter: boolean, threshold: number) => void;
  /** Zoom multiplier around a rotated Source point; the caller applies its latest Crop. */
  readonly onZoomAt: (point: { x: number; y: number }, factor: number) => void;
  /** Delta in rotated Source pixels and the ratio-lock state of a handle drag. */
  readonly onResize: (
    handle: Handle,
    dx: number,
    dy: number,
    locked: boolean,
    snap: boolean,
    /** The proportion the drag started on; excluded from snapping. */
    startRatio?: number,
  ) => void;
  /** Whether the Frame resize handles are shown. */
  readonly adjustFrame: boolean;
  /** Whether free resizes snap to a nearby ratio preset. */
  readonly snapRatios: boolean;
  readonly onOpen: () => void;
  readonly busy: boolean;
  /** True while the Pad eyedropper is armed. */
  readonly picking: boolean;
  readonly onPickColor: (hex: string) => void;
  readonly onPickMiss: (reason: 'outside' | 'transparent') => void;
}

export function Stage({
  doc,
  frameIndex,
  frameVersion = 0,
  onPan,
  onZoomAt,
  onResize,
  adjustFrame,
  snapRatios,
  onOpen,
  busy,
  picking,
  onPickColor,
  onPickMiss,
}: StageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const pickRef = useRef<HTMLCanvasElement | null>(null);
  const magnifierRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{
    id: number;
    handle: Handle;
    x: number;
    y: number;
    startX: number;
    startY: number;
    startRatio: number;
    scale: number;
  } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  /** A grab only shows the centre guides after it actually moved. */
  const [panned, setPanned] = useState(false);
  const [altDown, setAltDown] = useState(false);
  const [magnifier, setMagnifier] = useState<MagnifierState | null>(null);

  // `App` still passes the two flags, but the Stage collapses them into the one
  // explicit mode so every rendering decision reads a single mutually
  // exclusive value.
  const stageMode = useMemo(() => stageModeOf({ adjustFrame, picking }), [adjustFrame, picking]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setStageSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rect = frameRect(doc);
  const dpr = window.devicePixelRatio || 1;
  const layout = stageLayout(doc, stageSize, dpr, stageMode.kind === 'adjust');
  const {
    adjusting,
    scale,
    frameLeft,
    frameTop,
    frameWidth,
    frameHeight,
    sceneWidth,
    sceneHeight,
    framePixelWidth,
    framePixelHeight,
    scenePixelWidth,
    scenePixelHeight,
  } = layout;
  const sourceView = effectiveSource(doc);
  // The adjust mask needs the window rectangle to keep it opaque while the
  // feather fades only the dimmed surround.
  const sceneStyle = {
    width: sceneWidth,
    height: sceneHeight,
    '--frame-left': `${frameLeft}px`,
    '--frame-top': `${frameTop}px`,
    '--frame-width': `${frameWidth}px`,
    '--frame-height': `${frameHeight}px`,
  } as CSSProperties;
  // A pan that lands on the Source centre leaves the rect exactly centred, so
  // the guides read the settled document instead of guessing from the pointer.
  // An axis the window cannot pan on is always centred, and that is not a snap.
  const snapBounds = rotatedBounds(doc);
  const centred = centreSnapAxes(snapBounds, doc.crop.rect, 0, 0, CENTRE_SNAP_EPSILON);
  const centreSnap =
    doc.source && dragging && panned && !altDown
      ? {
          x: centred.x && snapBounds.width - doc.crop.rect.width > CENTRE_SNAP_EPSILON,
          y: centred.y && snapBounds.height - doc.crop.rect.height > CENTRE_SNAP_EPSILON,
        }
      : NO_CENTRE_SNAP;

  useEffect(() => {
    const frameCanvas = frameRef.current;
    const backdrop = backdropRef.current;
    if (!frameCanvas || !backdrop) return;
    // Before the stage has a measured size, scale is 0: never draw (or size a
    // canvas) at the Source's own resolution.
    if (!(frameWidth >= 1) || !(frameHeight >= 1)) return;

    if (adjusting) {
      // The Frame is a window cut out of the dim overlay: the Frame canvas is
      // hidden, so nothing is re-rendered or resampled inside it while the
      // window moves. The window shows the backdrop's own Source, exactly
      // continuous with the surround, and the Source never moves. The CSS mask
      // keeps the window itself opaque so the feather only fades the surround.
      frameCanvas.style.display = 'none';
    } else {
      frameCanvas.style.display = 'block';
      if (frameCanvas.width !== framePixelWidth || frameCanvas.height !== framePixelHeight) {
        frameCanvas.width = framePixelWidth;
        frameCanvas.height = framePixelHeight;
      }
      const frameContext = frameCanvas.getContext('2d');
      if (!frameContext) return;
      renderFrame(frameContext, doc, {
        outputWidth: frameCanvas.width,
        outputHeight: frameCanvas.height,
        // The empty Frame has no Export size yet; a constant 1px keeps it visible.
        border: doc.source
          ? { scale: frameCanvas.width / outputSize(doc).width, minPx: 1 }
          : undefined,
        frameIndex,
      });
    }

    if (backdrop.width !== scenePixelWidth || backdrop.height !== scenePixelHeight) {
      backdrop.width = scenePixelWidth;
      backdrop.height = scenePixelHeight;
      backdrop.style.width = `${scenePixelWidth / dpr}px`;
      backdrop.style.height = `${scenePixelHeight / dpr}px`;
    }
    const backdropContext = backdrop.getContext('2d');
    if (!backdropContext) return;
    backdropContext.clearRect(0, 0, backdrop.width, backdrop.height);
    if (!doc.source) return;

    const fullWidth = backdrop.width;
    const fullHeight = backdrop.height;
    const left = frameLeft * dpr;
    const top = frameTop * dpr;
    const width = frameWidth * dpr;
    const height = frameHeight * dpr;

    // A Pad window paints its uncovered area with the Pad color. In Fit the
    // Source always covers the window, so only the other modes need it.
    if (adjusting && paintsPadColor(doc)) {
      backdropContext.fillStyle = doc.padColor;
      backdropContext.fillRect(left, top, width, height);
    }

    // The backdrop draws the whole Source at the same scale as the Frame, so the
    // crop window and its surround stay exactly continuous.
    drawSource(
      backdropContext,
      doc,
      scale * dpr,
      scale * dpr,
      frameLeft * dpr,
      frameTop * dpr,
      frameIndex,
    );

    // Dim everything the Crop leaves outside the Frame.
    backdropContext.fillStyle = 'rgba(8, 7, 11, 0.55)';
    backdropContext.fillRect(0, 0, fullWidth, top);
    backdropContext.fillRect(0, top + height, fullWidth, fullHeight - top - height);
    backdropContext.fillRect(0, top, left, height);
    backdropContext.fillRect(left + width, top, fullWidth - left - width, height);
    // The applied Border stays out of the adjust phase: the dashed Frame
    // outline is what the user is positioning, and the Border would cover it.
  }, [
    doc,
    adjusting,
    scale,
    frameLeft,
    frameTop,
    frameWidth,
    frameHeight,
    sceneWidth,
    sceneHeight,
    framePixelWidth,
    framePixelHeight,
    scenePixelWidth,
    scenePixelHeight,
    frameIndex,
    frameVersion,
  ]);

  // The visible Frame includes the Border. The eyedropper should read the
  // image underneath it, matching the Palette's border:false sample.
  useEffect(() => {
    if (stageMode.kind !== 'pick-pad') {
      pickRef.current = null;
      return;
    }
    const frameCanvas = frameRef.current;
    if (!frameCanvas) return;
    const canvas = pickRef.current ?? document.createElement('canvas');
    canvas.width = frameCanvas.width;
    canvas.height = frameCanvas.height;
    const context = canvas.getContext('2d');
    if (!context) {
      pickRef.current = null;
      return;
    }
    renderFrame(context, doc, {
      outputWidth: canvas.width,
      outputHeight: canvas.height,
      border: false,
      frameIndex,
    });
    pickRef.current = canvas;
  }, [doc, stageMode, scale, frameIndex, frameVersion]);

  // A notice or window resize changes the stage scale; the cached magnifier
  // cell and hex would be from the old frame.
  useEffect(() => {
    setMagnifier(null);
  }, [doc, stageMode, scale, frameIndex, frameVersion]);

  // Alt releases the centre snap; track it while dragging so the guides react
  // even when the pointer stays still.
  useEffect(() => {
    if (!dragging) return;
    const update = (event: KeyboardEvent) => {
      if (event.key !== 'Alt') return;
      setAltDown(event.altKey);
    };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
    };
  }, [dragging]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!doc.source) return;
      event.preventDefault();
      if (stageMode.kind === 'pick-pad') return;
      const frameCanvas = frameRef.current;
      if (!frameCanvas) return;
      const bounds = frameCanvas.getBoundingClientRect();
      // The wheel works in displayed crop pixels; zoomAt needs Source pixels.
      const point = {
        x: rect.x + (event.clientX - bounds.left) / scale,
        y: rect.y + (event.clientY - bounds.top) / scale,
      };
      const factor = Math.exp(-event.deltaY * 0.0015);
      onZoomAt(point, factor);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [doc.source, onZoomAt, stageMode, scale, rect.x, rect.y]);

  function framePixelAt(clientX: number, clientY: number): { sx: number; sy: number } | null {
    const frameCanvas = frameRef.current;
    if (!frameCanvas) return null;
    const rect = frameCanvas.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX >= rect.right ||
      clientY < rect.top ||
      clientY >= rect.bottom
    ) {
      return null;
    }
    return {
      sx: Math.floor(((clientX - rect.left) / rect.width) * frameCanvas.width),
      sy: Math.floor(((clientY - rect.top) / rect.height) * frameCanvas.height),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!doc.source) return;
    if (event.button !== 0) return;

    if (stageMode.kind === 'pick-pad') {
      const point = framePixelAt(event.clientX, event.clientY);
      const pickCanvas = pickRef.current;
      if (!point) {
        onPickMiss('outside');
        return;
      }
      if (!pickCanvas) {
        onPickMiss('transparent');
        return;
      }
      const context = pickCanvas.getContext('2d');
      let pixel: Uint8ClampedArray | undefined;
      try {
        pixel = context?.getImageData(point.sx, point.sy, 1, 1).data;
      } catch {
        onPickMiss('transparent');
        return;
      }
      if (!pixel || pixel[3] === 0) {
        onPickMiss('transparent');
        return;
      }
      event.preventDefault();
      onPickColor(toHexColor({ r: pixel[0], g: pixel[1], b: pixel[2] }));
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setDragging(true);
    setPanned(false);
    setAltDown(event.altKey);
  }

  function updateMagnifier(event: ReactPointerEvent<HTMLDivElement>) {
    const host = hostRef.current;
    const pickCanvas = pickRef.current;
    if (!host || !pickCanvas) return;
    const point = framePixelAt(event.clientX, event.clientY);
    if (!point) {
      setMagnifier(null);
      return;
    }
    const context = pickCanvas.getContext('2d');
    let pixel: Uint8ClampedArray | undefined;
    try {
      pixel = context?.getImageData(point.sx, point.sy, 1, 1).data;
    } catch {
      setMagnifier(null);
      return;
    }
    if (!pixel || pixel[3] === 0) {
      setMagnifier(null);
      return;
    }

    const hostRect = host.getBoundingClientRect();
    const pointerX = event.clientX - hostRect.left;
    const pointerY = event.clientY - hostRect.top;
    let left = pointerX + MAGNIFIER_OFFSET;
    let top = pointerY + MAGNIFIER_OFFSET;
    if (left + MAGNIFIER_SIZE > hostRect.width - MAGNIFIER_MARGIN) {
      left = pointerX - MAGNIFIER_SIZE - MAGNIFIER_OFFSET;
    }
    if (top + MAGNIFIER_SIZE > hostRect.height - MAGNIFIER_MARGIN) {
      top = pointerY - MAGNIFIER_SIZE - MAGNIFIER_OFFSET;
    }

    setMagnifier({
      left: Math.max(MAGNIFIER_MARGIN, left),
      top: Math.max(MAGNIFIER_MARGIN, top),
      sx: point.sx,
      sy: point.sy,
      hex: toHexColor({ r: pixel[0], g: pixel[1], b: pixel[2] }),
    });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (stageMode.kind === 'pick-pad') {
      updateMagnifier(event);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = (event.clientX - drag.x) / scale;
    const dy = (event.clientY - drag.y) / scale;
    dragRef.current = { id: drag.id, x: event.clientX, y: event.clientY };
    setPanned((value) => value || dx !== 0 || dy !== 0);
    setAltDown(event.altKey);
    // Alt releases the centre snap, the same key that releases the ratio snap.
    const snapThreshold = scale > 0 ? CENTRE_SNAP_PX / scale : 0;
    onPan(dx, dy, !event.altKey && snapThreshold > 0, snapThreshold);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
      setPanned(false);
      setAltDown(false);
    }
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>, handle: Handle) {
    if (event.button !== 0) return;
    // Keep the stage's pan-drag out of a handle grab. Do not preventDefault:
    // the button must still take focus so the arrow keys can nudge it.
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      id: event.pointerId,
      handle,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      startRatio: doc.frame.ratio,
      scale,
    };
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.id !== event.pointerId) return;
    // The delta belongs to the display scale of the previous event, so a
    // growing Frame that makes the scene zoom out never amplifies the drag.
    const dx = (event.clientX - resize.x) / resize.scale;
    const dy = (event.clientY - resize.y) / resize.scale;
    // Do not snap on the first pixels of a grab: the frame would jump to a
    // neighbouring preset before the user has actually dragged.
    const moved =
      Math.hypot(event.clientX - resize.startX, event.clientY - resize.startY) > SNAP_START_PX;
    resizeRef.current = {
      ...resize,
      x: event.clientX,
      y: event.clientY,
      scale,
    };
    onResize(
      resize.handle,
      dx,
      dy,
      !event.shiftKey,
      snapRatios && !event.altKey && moved,
      resize.startRatio,
    );
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resizeRef.current?.id !== event.pointerId) return;
    resizeRef.current = null;
  }

  useEffect(() => {
    if (stageMode.kind !== 'pick-pad' || !magnifier) return;
    const canvas = magnifierRef.current;
    const source = pickRef.current;
    if (!canvas || !source) return;
    const context = canvas.getContext('2d');
    const sourceContext = source.getContext('2d');
    if (!context || !sourceContext) return;

    const half = Math.floor(MAGNIFIER_REGION / 2);
    const cell = canvas.width / MAGNIFIER_REGION;
    let image: ImageData;
    try {
      image = sourceContext.getImageData(
        magnifier.sx - half,
        magnifier.sy - half,
        MAGNIFIER_REGION,
        MAGNIFIER_REGION,
      );
    } catch {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111116';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < MAGNIFIER_REGION; y += 1) {
      for (let x = 0; x < MAGNIFIER_REGION; x += 1) {
        const index = (y * MAGNIFIER_REGION + x) * 4;
        const alpha = image.data[index + 3];
        if (alpha === 0) continue;
        context.fillStyle = `rgba(${image.data[index]}, ${image.data[index + 1]}, ${
          image.data[index + 2]
        }, ${alpha / 255})`;
        context.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    context.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    context.lineWidth = 1;
    for (let step = 1; step < MAGNIFIER_REGION; step += 1) {
      const position = step * cell + 0.5;
      context.beginPath();
      context.moveTo(position, 0);
      context.lineTo(position, canvas.height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, position);
      context.lineTo(canvas.width, position);
      context.stroke();
    }

    context.fillStyle = 'rgba(190, 190, 200, 0.42)';
    context.fillRect(half * cell, 0, cell, canvas.height);
    context.fillRect(0, half * cell, canvas.width, cell);

    context.strokeStyle = '#FFFFFF';
    context.lineWidth = 2;
    context.strokeRect(half * cell + 1, half * cell + 1, cell - 2, cell - 2);
  }, [doc, magnifier, stageMode]);

  return (
    <div
      ref={hostRef}
      className={`stage${doc.source ? ' has-source' : ''}${adjusting ? ' adjusting' : ''}${
        dragging ? ' dragging' : ''
      }${stageMode.kind === 'pick-pad' ? ' picking' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setMagnifier(null)}
      aria-label="Palco do Crop"
      role="group"
    >
      <div className="scene" style={sceneStyle}>
        <canvas ref={backdropRef} className="backdrop" />
        <canvas
          ref={frameRef}
          className="frame-canvas"
          style={{ left: frameLeft, top: frameTop, width: frameWidth, height: frameHeight }}
        />
        {doc.source && (
          <div
            className={`frame-guides${adjusting || dragging ? ' visible' : ''}`}
            style={{ left: frameLeft, top: frameTop, width: frameWidth, height: frameHeight }}
            aria-hidden="true"
          >
            <span className="guide vertical" style={{ left: '33.3333%' }} />
            <span className="guide vertical" style={{ left: '66.6667%' }} />
            <span className="guide horizontal" style={{ top: '33.3333%' }} />
            <span className="guide horizontal" style={{ top: '66.6667%' }} />
          </div>
        )}
        {doc.source && (
          <div
            className="centre-guides"
            style={
              {
                '--centre-x': `${frameLeft + frameWidth / 2}px`,
                '--centre-y': `${frameTop + frameHeight / 2}px`,
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <span className={`centre-line vertical${centreSnap.x ? ' on' : ''}`} />
            <span className={`centre-line horizontal${centreSnap.y ? ' on' : ''}`} />
            <span className={`centre-hint${centreSnap.x || centreSnap.y ? ' on' : ''}`}>
              Grudado no centro · Alt solta
            </span>
          </div>
        )}
        {stageMode.kind === 'adjust' && doc.source && (
          <div
            className="frame-handles"
            style={{ left: frameLeft, top: frameTop, width: frameWidth, height: frameHeight }}
          >
            <div className="frame-outline" />
            {HANDLES.map((handle) => (
              <button
                key={handle}
                type="button"
                className={`frame-handle ${handle}`}
                aria-label={`Ajustar Frame: ${HANDLE_LABELS[handle]}`}
                title={`${HANDLE_LABELS[handle]} · setas ajustam 1 px na tela · Shift solta a proporção`}
                onPointerDown={(event) => startResize(event, handle)}
                onPointerMove={moveResize}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onKeyDown={(event) => {
                  if (!(scale > 0)) return;
                  const step = 1 / Math.max(scale, 0.001);
                  const horizontal =
                    event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
                  const vertical =
                    event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
                  if (horizontal === 0 && vertical === 0) return;
                  event.preventDefault();
                  onResize(
                    handle,
                    horizontal,
                    vertical,
                    !event.shiftKey,
                    // A keyboard nudge has no drag session to exclude its own
                    // proportion, so it does not snap at all.
                    false,
                  );
                }}
              />
            ))}
          </div>
        )}
        {!doc.source && (
          <div
            className="empty-frame"
            style={{
              left: frameLeft,
              top: frameTop,
              width: frameWidth,
              height: frameHeight,
            }}
          >
            <div className="empty-inner">
              <strong>Traga uma Source</strong>
              <p>
                PNG, JPG, GIF, WebP, APNG, MP4, MOV ou WebM entra no Frame{' '}
                {ratioLabel(doc.frame.ratio)}.
              </p>
              <button type="button" className="primary" onClick={onOpen} disabled={busy}>
                Abrir arquivo…
              </button>
              <p className="hint">Arraste uma imagem para a janela</p>
              <p className="hint">ou Ctrl+V para colar da área de transferência</p>
              <p className="hint">ou cole um link ou caminho na barra acima</p>
            </div>
          </div>
        )}
        {stageMode.kind === 'adjust' && doc.source && (
          <div
            className="snap-badge"
            style={{ left: frameLeft + frameWidth / 2, top: frameTop - 10 }}
            role="status"
            aria-live="polite"
          >
            {`${ratioLabel(doc.frame.ratio)}`}
          </div>
        )}
      </div>
      {doc.source && (
        <>
          <div className="stage-meta">
            <span className="source-name" title={doc.source.path ?? doc.source.name}>
              {doc.source.name}
            </span>
            <span>
              {doc.source.format.toUpperCase()} · {doc.source.width}×{doc.source.height} ·{' '}
              {formatBytes(doc.source.bytes)} ·{' '}
              {doc.source.video
                ? `vídeo ${formatFps(doc.source.video.fps)} fps · ${formatPlaybackDuration(doc.source.video.durationMs)}`
                : isAnimated(sourceView)
                  ? `animado ${animationFrameCount(sourceView)}f`
                  : 'estático'}
            </span>
          </div>
          <div className="stage-hint">
            {stageMode.kind === 'pick-pad'
              ? 'clique na imagem para pegar a cor · Esc cancela'
              : stageMode.kind === 'adjust'
                ? `arraste as bordas para ajustar o Frame · Shift proporção livre · ${
                    snapRatios ? 'Alt sem encaixe' : 'encaixe desligado'
                  } · roda para zoom`
                : 'arraste para mover · roda do mouse para zoom'}
          </div>
        </>
      )}
      {stageMode.kind === 'pick-pad' && magnifier && (
        <div
          className="magnifier"
          style={{ left: magnifier.left, top: magnifier.top }}
          aria-hidden="true"
        >
          <canvas ref={magnifierRef} width={MAGNIFIER_CANVAS} height={MAGNIFIER_CANVAS} />
          <span className="magnifier-hex">{magnifier.hex}</span>
        </div>
      )}
    </div>
  );
}
