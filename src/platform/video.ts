import type { ImageFormat, VideoSource } from '../core/document';
import { clampSpeed, isVideoFormat } from '../core/document';
import { ImportError, mimeFor, type DecodedImage } from '../core/import';

const FALLBACK_VIDEO_FPS = 30;

/**
 * Estimate the video's own frame rate from the first presented frames. The
 * HTMLVideoElement does not expose fps, so the median mediaTime delta over a
 * short muted playback is the portable signal. A 60 fps clip keeps 60 fps;
 * a VFR clip gets its median cadence.
 */
function detectFrameRate(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback !== 'function') {
      resolve(FALLBACK_VIDEO_FPS);
      return;
    }

    const samples: number[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('ended', finish);
      video.pause();
      const deltas = samples
        .slice(1)
        .map((time, index) => time - samples[index])
        .filter((delta) => delta > 0.001);
      if (deltas.length < 2) {
        resolve(FALLBACK_VIDEO_FPS);
        return;
      }
      deltas.sort((a, b) => a - b);
      const median = deltas[Math.floor(deltas.length / 2)];
      resolve(Math.min(120, Math.max(1, 1 / median)));
    };
    const timer = window.setTimeout(finish, 1200);
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      samples.push(metadata.mediaTime);
      if (samples.length >= 24) finish();
      else video.requestVideoFrameCallback(onFrame);
    };

    video.addEventListener('ended', finish, { once: true });
    video.requestVideoFrameCallback(onFrame);
    video.playbackRate = 1;
    void video.play().catch(finish);
  });
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('codec não suportado'));
    };
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function unsupportedVideo(message: string): ImportError {
  return new ImportError('corrupt', message);
}

/**
 * Decode a video as a hybrid Source. The file stays as a hidden `<video>`;
 * Preview plays it natively, while scrub and Export seek frame by frame into
 * one canvas. Memory stays bounded regardless of the video length.
 */
export async function decodeVideoWithBrowser(
  bytes: Uint8Array,
  format: ImageFormat,
): Promise<DecodedImage> {
  if (!isVideoFormat(format)) {
    throw unsupportedVideo('Formato de vídeo não reconhecido.');
  }

  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeFor(format) }));
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);

  const teardown = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  };

  try {
    video.src = url;
    await waitForMetadata(video);
    if (!video.videoWidth || !video.videoHeight) {
      throw unsupportedVideo('O vídeo não tem dimensões válidas.');
    }
    const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
    if (durationMs <= 0) {
      throw unsupportedVideo('O vídeo não tem duração válida.');
    }
    const fps = await detectFrameRate(video);

    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw unsupportedVideo('Não foi possível criar o canvas do vídeo.');

    const draw = (): HTMLCanvasElement => {
      context.drawImage(video, 0, 0, width, height);
      return canvas;
    };

    let playing = false;
    let disposed = false;
    let loopToken = 0;
    const frameCount = Math.max(1, Math.ceil((durationMs / 1000) * fps));

    const seekToMsInternal = (ms: number): Promise<void> =>
      new Promise((resolve, reject) => {
        if (disposed) {
          reject(new Error('vídeo descartado'));
          return;
        }
        const target = Math.max(0, Math.min(durationMs - 1, ms)) / 1000;
        if (Math.abs(video.currentTime - target) < 0.001) {
          draw();
          resolve();
          return;
        }
        const cleanup = () => {
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
        };
        const onSeeked = () => {
          cleanup();
          draw();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('falha ao buscar o frame do vídeo'));
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onError, { once: true });
        video.currentTime = target;
      });

    const drawLoop = (token: number) => {
      if (disposed || !playing || token !== loopToken) return;
      draw();
      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(() => drawLoop(token));
      } else {
        requestAnimationFrame(() => drawLoop(token));
      }
    };

    const source: VideoSource = {
      frameCount,
      fps,
      durationMs,
      get image() {
        return canvas;
      },
      get currentTimeMs() {
        return video.currentTime * 1000;
      },
      seekToFrame: (index) => seekToMsInternal((index / fps) * 1000),
      seekToMs: async (ms) => {
        playing = false;
        video.pause();
        await seekToMsInternal(ms);
      },
      play: (rate) => {
        playing = true;
        loopToken += 1;
        video.playbackRate = clampSpeed(rate);
        void video.play();
        drawLoop(loopToken);
      },
      pause: () => {
        playing = false;
        loopToken += 1;
        video.pause();
        draw();
      },
      dispose: () => {
        disposed = true;
        playing = false;
        teardown();
      },
    };

    await source.seekToFrame(0);
    return {
      image: canvas,
      width,
      height,
      video: source,
    };
  } catch (reason) {
    teardown();
    if (reason instanceof ImportError) throw reason;
    throw unsupportedVideo(
      'Não foi possível ler este vídeo. O codec pode não ser suportado pelo app.',
    );
  }
}
