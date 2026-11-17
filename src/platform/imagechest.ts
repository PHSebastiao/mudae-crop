import { invoke, isTauri } from '@tauri-apps/api/core';
import type {
  ImageChestRequest,
  ImageChestResponse,
  ImageChestTransport,
} from '../core/imagechest';
import { text } from '../core/i18n/text';
import { KeyedError } from '../core/errors';

interface NativeReply {
  readonly status: number;
  readonly body: string;
  readonly retryAfterSeconds: number | null;
}

/**
 * The upload request crosses to Rust because Image Chest does not answer CORS
 * from the webview. The client still builds every request and reads the reply.
 */
export const tauriImageChestTransport: ImageChestTransport = {
  async send(request: ImageChestRequest): Promise<ImageChestResponse> {
    if (!isTauri()) {
      throw new KeyedError(text('imagechest.desktopOnly'));
    }
    const reply = await invoke<NativeReply>('imagechest_request', {
      method: request.method,
      path: request.path,
      token: request.token,
      form: request.form ?? null,
      files: (request.files ?? []).map((file) => ({
        field: file.field,
        name: file.name,
        content_type: file.contentType,
        bytes: Array.from(file.bytes),
      })),
    });
    return {
      status: reply.status,
      body: reply.body,
      retryAfterSeconds: reply.retryAfterSeconds ?? null,
    };
  },
};
