import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toHexColor } from '../core/color';
import type { DocumentState } from '../core/document';
import { drawSource, renderFrame } from '../core/render';

const PAD = 84;
const MIN_STAGE_SCALE = 0.35;
const MAX_STAGE_SCALE = 1.4;
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
  /** Delta in Frame pixels at 1×; the caller applies it to its latest Crop. */
  readonly onPan: (dx: number, dy: number) => void;
  /** Zoom multiplier around a Frame point; the caller applies it to its latest Crop. */
  readonly onZoomAt: (point: { x: number; y: number }, factor: number) => void;
  readonly onOpen: () => void;
  readonly busy: boolean;
  /** True while the Pad eyedropper is armed. */
  readonly picking: boolean;
  readonly onPickColor: (hex: string) => void;
  readonly onPickMiss: (reason: 'outside' | 'transparent') => void;
}

export function Stage({
  doc,
  onPan,
  onZoomAt,
  onOpen,
  busy,
  picking,
  onPickColor,
  onPickMiss,
}: StageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const magnifierRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [magnifier, setMagnifier] = useState<MagnifierState | null>(null);

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

  const scale =
    stageSize.width && stageSize.height
      ? Math.max(
          MIN_STAGE_SCALE,
          Math.min(
            (stageSize.width - PAD * 2) / doc.frame.width,
            (stageSize.height - PAD * 2) / doc.frame.height,
            MAX_STAGE_SCALE,
          ),
        )
      : 1;

  const frameWidth = doc.frame.width * scale;
  const frameHeight = doc.frame.height * scale;
  const sceneWidth = frameWidth + PAD * 2;
  const sceneHeight = frameHeight + PAD * 2;

  useEffect(() => {
    const frameCanvas = frameRef.current;
    const backdrop = backdropRef.current;
    if (!frameCanvas || !backdrop) return;
    const dpr = window.devicePixelRatio || 1;

    frameCanvas.width = Math.round(frameWidth * dpr);
    frameCanvas.height = Math.round(frameHeight * dpr);
    frameCanvas.style.width = `${frameWidth}px`;
    frameCanvas.style.height = `${frameHeight}px`;
    const frameContext = frameCanvas.getContext('2d');
    if (!frameContext) return;
    renderFrame(frameContext, doc, { scale: scale * dpr });

    backdrop.width = Math.round(sceneWidth * dpr);
    backdrop.height = Math.round(sceneHeight * dpr);
    backdrop.style.width = `${sceneWidth}px`;
    backdrop.style.height = `${sceneHeight}px`;
    const backdropContext = backdrop.getContext('2d');
    if (!backdropContext) return;
    backdropContext.clearRect(0, 0, backdrop.width, backdrop.height);
    if (!doc.source) return;

    drawSource(backdropContext, doc, scale * dpr, PAD * dpr, PAD * dpr);

    // Dim everything the Crop leaves outside the Frame.
    const pad = PAD * dpr;
    const width = frameWidth * dpr;
    const height = frameHeight * dpr;
    const fullWidth = sceneWidth * dpr;
    const fullHeight = sceneHeight * dpr;
    backdropContext.fillStyle = 'rgba(8, 7, 11, 0.55)';
    backdropContext.fillRect(0, 0, fullWidth, pad);
    backdropContext.fillRect(0, pad + height, fullWidth, fullHeight - pad - height);
    backdropContext.fillRect(0, pad, pad, height);
    backdropContext.fillRect(pad + width, pad, fullWidth - pad - width, height);
  }, [doc, scale, frameWidth, frameHeight, sceneWidth, sceneHeight]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!doc.source) return;
      event.preventDefault();
      if (picking) return;
      const frameCanvas = frameRef.current;
      if (!frameCanvas) return;
      const rect = frameCanvas.getBoundingClientRect();
      const point = {
        x: (event.clientX - rect.left) / scale,
        y: (event.clientY - rect.top) / scale,
      };
      const factor = Math.exp(-event.deltaY * 0.0015);
      onZoomAt(point, factor);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [doc.source, onZoomAt, picking, scale]);

  function framePixelAt(
    clientX: number,
    clientY: number,
  ): { sx: number; sy: number } | null {
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

    if (picking) {
      const point = framePixelAt(event.clientX, event.clientY);
      const frameCanvas = frameRef.current;
      if (!point || !frameCanvas) {
        onPickMiss('outside');
        return;
      }
      const context = frameCanvas.getContext('2d');
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
  }

  function updateMagnifier(event: ReactPointerEvent<HTMLDivElement>) {
    const host = hostRef.current;
    const frameCanvas = frameRef.current;
    if (!host || !frameCanvas) return;
    const point = framePixelAt(event.clientX, event.clientY);
    if (!point) {
      setMagnifier(null);
      return;
    }
    const context = frameCanvas.getContext('2d');
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
    if (picking) {
      updateMagnifier(event);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = (event.clientX - drag.x) / scale;
    const dy = (event.clientY - drag.y) / scale;
    dragRef.current = { id: drag.id, x: event.clientX, y: event.clientY };
    onPan(dx, dy);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  }

  useEffect(() => {
    if (!picking) setMagnifier(null);
  }, [picking]);

  useEffect(() => {
    if (!picking || !magnifier) return;
    const canvas = magnifierRef.current;
    const source = frameRef.current;
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
  }, [doc, magnifier, picking]);

  return (
    <div
      ref={hostRef}
      className={`stage${doc.source ? ' has-source' : ''}${dragging ? ' dragging' : ''}${
        picking ? ' picking' : ''
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setMagnifier(null)}
      aria-label="Palco do Crop"
    >
      <div className="scene" style={{ width: sceneWidth, height: sceneHeight }}>
        <canvas ref={backdropRef} className="backdrop" />
        <canvas
          ref={frameRef}
          className="frame-canvas"
          style={{ left: PAD, top: PAD, width: frameWidth, height: frameHeight }}
        />
        {!doc.source && (
          <div
            className="empty-frame"
            style={{
              left: PAD,
              top: PAD,
              width: frameWidth,
              height: frameHeight,
            }}
          >
            <div className="empty-inner">
              <strong>Traga uma Source</strong>
              <p>PNG, JPG ou GIF entra no Frame {doc.frame.label}.</p>
              <button type="button" className="primary" onClick={onOpen} disabled={busy}>
                Abrir arquivo…
              </button>
              <p className="hint">Arraste uma imagem para a janela</p>
              <p className="hint">ou Ctrl+V para colar da área de transferência</p>
              <p className="hint">ou cole um link na barra acima</p>
            </div>
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
              {doc.source.format.toUpperCase()} · {doc.source.width}×{doc.source.height}
            </span>
          </div>
          <div className="stage-hint">
            {picking
              ? 'clique na imagem para pegar a cor · Esc cancela'
              : 'arraste para mover · roda do mouse para zoom'}
          </div>
        </>
      )}
      {picking && magnifier && (
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
