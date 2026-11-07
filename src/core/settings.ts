import type { ExportScale } from './document';
import { isPostId, type Privacy } from './imagechest';
import { asRecord, parseJson } from './json';

/** Stills are PNG today; JPG is stored ahead of the Export format control. */
export type ExportFormat = 'png' | 'jpg';

/**
 * Everything Settings owns across launches. A working document is never
 * restored; only the preferences and the last-used choices live here.
 */
export interface Settings {
  readonly token: string;
  readonly defaultPrivacy: Privacy;
  readonly appendPostId: string;
  readonly saveFolder: string | null;
  readonly borderColor: string;
  readonly borderWidth: number;
  readonly exportFormat: ExportFormat;
  readonly exportScale: ExportScale;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  token: '',
  defaultPrivacy: 'hidden',
  appendPostId: '',
  saveFolder: null,
  borderColor: '#FFFFFF',
  borderWidth: 1,
  exportFormat: 'png',
  exportScale: 1,
});

const PRIVACY: ReadonlyArray<Privacy> = ['public', 'hidden', 'secret'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_BORDER_WIDTH = 20;

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readPrivacy(value: unknown): Privacy {
  return typeof value === 'string' && PRIVACY.includes(value as Privacy)
    ? (value as Privacy)
    : DEFAULT_SETTINGS.defaultPrivacy;
}

function readScale(value: unknown): ExportScale {
  return value === 2 ? 2 : 1;
}

function readFormat(value: unknown): ExportFormat {
  return value === 'jpg' ? 'jpg' : 'png';
}

function readBorderWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.borderWidth;
  }
  return Math.min(MAX_BORDER_WIDTH, Math.max(0, Math.round(value)));
}

function readFolder(value: unknown): string | null {
  const folder = readString(value)?.trim() ?? '';
  return folder || null;
}

function readPostId(value: unknown): string {
  const postId = readString(value)?.trim() ?? '';
  return isPostId(postId) ? postId : '';
}

/**
 * Read whatever is on disk. A corrupt or partial file never throws and never
 * clears a field it does understand; each invalid field falls back alone.
 */
export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  const data = asRecord(parseJson(raw));
  if (!data) return { ...DEFAULT_SETTINGS };

  const token = readString(data.token)?.trim() ?? DEFAULT_SETTINGS.token;
  const borderColor = readString(data.borderColor)?.trim() ?? '';
  return {
    token,
    defaultPrivacy: readPrivacy(data.defaultPrivacy),
    appendPostId: readPostId(data.appendPostId),
    saveFolder: readFolder(data.saveFolder),
    borderColor: HEX_COLOR.test(borderColor)
      ? borderColor.toUpperCase()
      : DEFAULT_SETTINGS.borderColor,
    borderWidth: readBorderWidth(data.borderWidth),
    exportFormat: readFormat(data.exportFormat),
    exportScale: readScale(data.exportScale),
  };
}

export function serializeSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
