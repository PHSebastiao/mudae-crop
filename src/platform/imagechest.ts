import { invoke, isTauri } from '@tauri-apps/api/core';
import type {
  ImageChestRequest,
  ImageChestResponse,
  ImageChestTransport,
} from '../core/imagechest';

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
      throw new Error('o upload só funciona no app desktop');
    }
    const reply = await invoke<NativeReply>('imagechest_request', {
      method: request.method,
      path: request.path,
      token: request.token,
      form: request.form ?? null,
      file_field: request.file?.field ?? null,
      file_name: request.file?.name ?? null,
      file_type: request.file?.contentType ?? null,
      file_bytes: request.file ? Array.from(request.file.bytes) : null,
    });
    return {
      status: reply.status,
      body: reply.body,
      retryAfterSeconds: reply.retryAfterSeconds ?? null,
    };
  },
};
