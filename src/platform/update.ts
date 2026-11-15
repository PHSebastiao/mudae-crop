import { invoke, isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';

/**
 * The manifest carries one entry per build flavour: the installed copy takes
 * the NSIS setup, the unpacked copies take the standalone executable. Both are
 * signed with the same key, so the plugin verifies either one.
 */
export const PORTABLE_TARGET = 'windows-x86_64-portable';

export interface CheckedUpdate {
  readonly version: string;
  readonly update: Update;
}

export interface DownloadProgress {
  readonly received: number;
  readonly total: number | null;
}

/** The version this build reports: the native one, or the bundle's in a browser. */
export async function appVersion(): Promise<string> {
  if (!isTauri()) return __APP_VERSION__;
  try {
    return await getVersion();
  } catch {
    return __APP_VERSION__;
  }
}

/**
 * An NSIS install directory always carries `uninstall.exe` beside the app; the
 * portable ZIP and the standalone executable do not. That is the only reliable
 * difference, so the native side answers it once per launch.
 */
export async function isPortable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return !(await invoke<boolean>('installer_detected'));
  } catch {
    return true;
  }
}

/** Ask the manifest for a newer build, or null when this one is current. */
export async function checkForUpdate(portable: boolean): Promise<CheckedUpdate | null> {
  if (!isTauri()) return null;
  const update = await check(portable ? { target: PORTABLE_TARGET } : undefined);
  if (!update) return null;
  return { version: update.version, update };
}

/**
 * Download the update into the backend. The bytes stay native, so a cancelled
 * download is simply dropped instead of installing behind the user's back.
 */
export async function downloadUpdate(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
  isCancelled: () => boolean,
): Promise<boolean> {
  let received = 0;
  let total: number | null = null;
  await update.download((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? null;
      onProgress({ received: 0, total });
      return;
    }
    if (event.event === 'Progress') {
      received += event.data.chunkLength;
      onProgress({ received, total });
    }
  });
  return !isCancelled();
}

/**
 * Run the signed NSIS setup. Windows exits this process and the installer
 * relaunches the app on the new version.
 */
export async function installUpdate(update: Update): Promise<void> {
  await saveWindowGeometry();
  await update.install({ restartAfterInstall: true });
}

/**
 * Replace the running executable with the downloaded one. The native side
 * checks the portable manifest entry, verifies the signature, swaps the file
 * and starts it; this call only returns when the swap failed. The version the
 * dialog named is passed along, so a release published in the meantime is
 * refused instead of installing something the user did not approve.
 */
export async function installPortable(version: string): Promise<void> {
  await invoke('install_portable_update', { expected_version: version });
}

/**
 * The updater exits the process without a close event, so the window geometry
 * is written explicitly before the install starts.
 */
async function saveWindowGeometry(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('save_window_geometry');
  } catch {
    // A lost window position is not worth failing an update over.
  }
}

/** A failure the notice bar can show without leaking a raw error object. */
export function updateFailure(reason: unknown): string {
  if (typeof reason === 'string' && reason) return reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return 'falha de rede';
}
