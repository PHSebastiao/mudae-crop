import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DocumentState } from '../core/document';
import { drawSource, renderFrame } from '../core/render';

const PAD = 46;
const MIN_STAGE_SCALE = 0.35;
const MAX_STAGE_SCALE = 1.4;

interface StageProps {
  readonly doc: DocumentState;
  /** Delta in Frame pixels at 1×; the caller applies it to its latest Crop. */
  readonly onPan: (dx: number, dy: number) => void;
  /** Zoom multiplier around a Frame point; the caller applies it to its latest Crop. */
  readonly onZoomAt: (point: { x: number; y: number }, factor: number) => void;
  readonly onOpen: () => void;
  readonly busy: boolean;
}

export function Stage({ doc, onPan, onZoomAt, onOpen, busy }: StageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [host, setHost] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setHost({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale =
    host.width && host.height
      ? Math.max(
          MIN_STAGE_SCALE,
          Math.min(
            (host.width - PAD * 2) / doc.frame.width,
            (host.height - PAD * 2) / doc.frame.height,
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
    backdropContext.fillStyle = 'rgba(8, 7, 11, 0.7)';
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
  }, [doc.source, onZoomAt, scale]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!doc.source) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
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

  return (
    <div
      ref={hostRef}
      className={`stage${doc.source ? ' has-source' : ''}${dragging ? ' dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
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
              <p>PNG, JPG ou GIF entra no Frame Mudae 225×350.</p>
              <button type="button" className="primary" onClick={onOpen} disabled={busy}>
                Abrir arquivo…
              </button>
              <p className="hint">Arraste uma imagem para a janela</p>
              <p className="hint">ou Ctrl+V para colar da área de transferência</p>
            </div>
          </div>
        )}
      </div>
      {doc.source && (
        <div className="stage-hint">arraste para mover · roda do mouse para zoom</div>
      )}
    </div>
  );
}
