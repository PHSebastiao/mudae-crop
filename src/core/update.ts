/**
 * The update check as a pure state machine. The Tauri plugin owns the network
 * and the version comparison; this module owns what the app shows and when a
 * found version is allowed to interrupt.
 */

/** Where the updater is in its cycle. */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'failed'
  | 'unsupported';

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  /** The version the last check offered, if any. */
  readonly version: string | null;
  /** Why the last check or install failed, in pt-BR. */
  readonly detail: string | null;
}

export const IDLE_UPDATE: UpdateStatus = Object.freeze({
  phase: 'idle',
  version: null,
  detail: null,
});

/** A leading `v` is legal in the manifest and never part of the real version. */
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

/**
 * The Sobre row's status text. It never claims an update is waiting while a
 * check is running, and it never hides a failure behind "Atualizado".
 */
export function describeUpdate(status: UpdateStatus): string {
  switch (status.phase) {
    case 'idle':
      return 'Ainda não verificado';
    case 'checking':
      return 'Verificando…';
    case 'current':
      return 'Atualizado';
    case 'available':
      return status.version ? `Nova versão ${status.version} disponível` : 'Nova versão disponível';
    case 'downloading':
      return status.version ? `Baixando a versão ${status.version}…` : 'Baixando…';
    case 'installing':
      return 'Instalando…';
    case 'failed':
      return status.version ? 'Falha ao atualizar' : 'Não foi possível verificar';
    case 'unsupported':
      return 'Verificação só no app desktop';
  }
}

/**
 * A skipped version stays quiet only while it is the one on offer; anything
 * newer prompts again. The comparison ignores a leading `v`, because the
 * manifest may carry one and the setting never does.
 */
export function shouldOffer(latest: string, skipped: string): boolean {
  const offered = normalizeVersion(latest);
  if (!offered) return false;
  return offered !== normalizeVersion(skipped);
}

/** The download bar's percentage, or null while the total is unknown. */
export function progressPercent(received: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
}

/** The progress line above the bar. */
export function describeProgress(received: number, total: number | null): string {
  const percent = progressPercent(received, total);
  return percent === null ? 'Baixando…' : `Baixando… ${percent}%`;
}
