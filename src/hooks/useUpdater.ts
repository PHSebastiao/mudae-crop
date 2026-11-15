import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  IDLE_UPDATE,
  describeProgress,
  progressPercent,
  shouldOffer,
  type UpdateStatus,
} from '../core/update';
import {
  appVersion,
  checkForUpdate,
  downloadUpdate,
  installPortable,
  installUpdate,
  isPortable,
  updateFailure,
  type CheckedUpdate,
  type DownloadProgress,
} from '../platform/update';

/** The check waits for the first paint, the waifu2x probe and any dropped Source. */
const LAUNCH_DELAY_MS = 3000;

export const RELEASES_URL = 'https://github.com/PHSebastiao/mudae-crop/releases/latest';
export const REPO_URL = 'https://github.com/PHSebastiao/mudae-crop';

export interface UpdaterOptions {
  /** False in the browser build, where no updater exists. */
  readonly desktop: boolean;
  /** True once the saved settings are loaded, so a skipped version is known. */
  readonly ready: boolean;
  /** The version the user asked not to be offered again. */
  readonly skipped: string;
  readonly onSkip: (version: string) => void;
}

export interface Updater {
  readonly status: UpdateStatus;
  /** This build's version, or null until it is read. */
  readonly version: string | null;
  /** True for the portable ZIP and the standalone executable. */
  readonly portable: boolean;
  /** Whether the update modal should be shown. */
  readonly prompt: boolean;
  readonly progress: DownloadProgress | null;
  readonly progressLabel: string;
  readonly percent: number | null;
  /** Run the check now; a manual check ignores a skipped version. */
  readonly check: () => void;
  readonly install: () => void;
  readonly cancel: () => void;
  readonly later: () => void;
  readonly skip: () => void;
  readonly closeFailure: () => void;
}

interface ProgressPayload {
  readonly received: number;
  readonly total: number | null;
}

export function useUpdater({ desktop, ready, skipped, onSkip }: UpdaterOptions): Updater {
  const [status, setStatus] = useState<UpdateStatus>(IDLE_UPDATE);
  const [version, setVersion] = useState<string | null>(null);
  const [portable, setPortable] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [offered, setOffered] = useState<CheckedUpdate | null>(null);

  const skippedRef = useRef(skipped);
  skippedRef.current = skipped;
  const portableRef = useRef<boolean | null>(null);
  const offeredRef = useRef(offered);
  offeredRef.current = offered;
  const checkingRef = useRef(false);
  const cancelledRef = useRef(false);
  const installingRef = useRef(false);
  const runRef = useRef(0);

  // The flavour decides which manifest entry the check asks for, so it is
  // resolved once and awaited rather than defaulted: the installed build must
  // never be handed the portable executable, or the reverse.
  const flavourRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    let alive = true;
    const flavour = Promise.all([appVersion(), isPortable()]).then(([current, unpacked]) => {
      if (alive) {
        setVersion(current);
        setPortable(unpacked);
        portableRef.current = unpacked;
        if (!desktop) setStatus({ phase: 'unsupported', version: null, detail: null });
      }
      return unpacked;
    });
    flavourRef.current = flavour;
    return () => {
      alive = false;
    };
  }, [desktop]);

  // The portable swap downloads on the native side, so its progress arrives as
  // an event instead of the plugin's callback.
  useEffect(() => {
    if (!desktop) return undefined;
    let stop: (() => void) | null = null;
    let alive = true;
    void listen<ProgressPayload>('update-progress', (event) => {
      if (!cancelledRef.current) {
        setProgress({ received: event.payload.received, total: event.payload.total });
      }
    }).then((unlisten) => {
      if (alive) stop = unlisten;
      else unlisten();
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [desktop]);

  const check = useCallback(
    async (manual: boolean) => {
      if (!desktop || checkingRef.current) return;
      const unpacked = portableRef.current ?? (await flavourRef.current) ?? false;
      if (portableRef.current === null) portableRef.current = unpacked;
      checkingRef.current = true;
      setStatus({ phase: 'checking', version: null, detail: null });
      try {
        const found = await checkForUpdate(unpacked);
        if (!found) {
          setOffered(null);
          setStatus({ phase: 'current', version: null, detail: null });
          return;
        }
        setOffered(found);
        setStatus({ phase: 'available', version: found.version, detail: null });
        // A skipped version stays quiet until something newer appears; the
        // manual button is the way back to it.
        if (manual || shouldOffer(found.version, skippedRef.current)) setPrompt(true);
      } catch (reason) {
        setOffered(null);
        setStatus({ phase: 'failed', version: null, detail: updateFailure(reason) });
      } finally {
        checkingRef.current = false;
      }
    },
    [desktop],
  );

  // The launch check waits for the settings, so a skipped version is not
  // offered again just because the file was still loading. A dev build skips
  // it: it reports a version behind every release and would replace its own
  // debug executable. The manual check in Sobre still works there.
  useEffect(() => {
    if (!desktop || !ready || portable === null || import.meta.env.DEV) return undefined;
    const timer = setTimeout(() => void check(false), LAUNCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [check, desktop, portable, ready]);

  const install = useCallback(async () => {
    const found = offeredRef.current;
    if (!found || installingRef.current) return;
    // Each run owns its status writes: a cancelled download keeps running in
    // the backend, and its late result must not touch the next run's state.
    const run = runRef.current + 1;
    runRef.current = run;
    installingRef.current = true;
    cancelledRef.current = false;
    setProgress({ received: 0, total: null });
    setStatus({ phase: 'downloading', version: found.version, detail: null });
    const current = () => runRef.current === run;
    const report = (next: DownloadProgress) => {
      if (current() && !cancelledRef.current) setProgress(next);
    };
    try {
      if (portableRef.current) {
        await installPortable(found.version);
        return;
      }
      const downloaded = await downloadUpdate(found.update, report, () => cancelledRef.current);
      if (!current()) return;
      if (!downloaded) {
        // The download cannot be aborted mid-flight, so a cancelled one is
        // dropped instead of installing behind the user's back.
        setProgress(null);
        setStatus({ phase: 'available', version: found.version, detail: null });
        return;
      }
      setStatus({ phase: 'installing', version: found.version, detail: null });
      await installUpdate(found.update);
    } catch (reason) {
      if (!current()) return;
      setProgress(null);
      setStatus({ phase: 'failed', version: found.version, detail: updateFailure(reason) });
    } finally {
      if (current()) installingRef.current = false;
    }
  }, []);

  // The download itself cannot be aborted, so cancelling returns to the offer
  // at once, frees the button for a retry and drops the bytes when they arrive.
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    runRef.current += 1;
    installingRef.current = false;
    setProgress(null);
    setStatus((current) =>
      current.phase === 'downloading' ? { ...current, phase: 'available' } : current,
    );
  }, []);

  const later = useCallback(() => setPrompt(false), []);

  const skip = useCallback(() => {
    const found = offeredRef.current;
    setPrompt(false);
    if (found) onSkip(found.version);
  }, [onSkip]);

  const closeFailure = useCallback(() => {
    setPrompt(false);
    setStatus((current) =>
      current.phase === 'failed' ? { ...current, phase: 'available' } : current,
    );
  }, []);

  return {
    status,
    version,
    portable: portable === true,
    prompt,
    progress,
    progressLabel: progress ? describeProgress(progress.received, progress.total) : '',
    percent: progress ? progressPercent(progress.received, progress.total) : null,
    check: () => void check(true),
    install: () => void install(),
    cancel,
    later,
    skip,
    closeFailure,
  };
}
