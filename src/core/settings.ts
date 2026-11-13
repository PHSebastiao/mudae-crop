import { DEFAULT_BORDER, clampBorderWidth } from './document';
import { MUDAE_RATIO } from './ratios';
import { isPostId, type Privacy } from './imagechest';
import { normalizeHexColor } from './color';
import { asRecord, parseJson } from './json';
import { normalizeVersion } from './update';

/** The Export formats this slice can write. */
export type ExportFormat = 'png' | 'gif';

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
  /** The ratio a fresh document starts at. */
  readonly frameRatio: number;
  /** Whether a free Frame resize snaps to a nearby ratio preset. */
  readonly snapRatios: boolean;
  /** Whether an upload writes the Mudae Crop credit line into the image description. */
  readonly uploadCredit: boolean;
  /** The version the user asked not to be offered again; empty when none. */
  readonly skippedUpdateVersion: string;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  token: '',
  defaultPrivacy: 'hidden',
  appendPostId: '',
  saveFolder: null,
  borderColor: DEFAULT_BORDER.color,
  borderWidth: DEFAULT_BORDER.width,
  exportFormat: 'gif',
  frameRatio: MUDAE_RATIO,
  snapRatios: true,
  uploadCredit: false,
  skippedUpdateVersion: '',
});

const PRIVACY: ReadonlyArray<Privacy> = ['public', 'hidden', 'secret'];

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readPrivacy(value: unknown): Privacy {
  return typeof value === 'string' && PRIVACY.includes(value as Privacy)
    ? (value as Privacy)
    : DEFAULT_SETTINGS.defaultPrivacy;
}

function readFormat(value: unknown): ExportFormat {
  return value === 'gif' ? 'gif' : 'png';
}

function readFrameRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SETTINGS.frameRatio;
  }
  return value;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readBorderWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.borderWidth;
  }
  return clampBorderWidth(value);
}

function readFolder(value: unknown): string | null {
  const folder = readString(value)?.trim() ?? '';
  return folder || null;
}

function readVersion(value: unknown): string {
  const version = readString(value)?.trim() ?? '';
  return version ? normalizeVersion(version) : DEFAULT_SETTINGS.skippedUpdateVersion;
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
  const borderColor =
    normalizeHexColor(readString(data.borderColor) ?? '') ?? DEFAULT_SETTINGS.borderColor;
  return {
    token,
    defaultPrivacy: readPrivacy(data.defaultPrivacy),
    appendPostId: readPostId(data.appendPostId),
    saveFolder: readFolder(data.saveFolder),
    borderColor,
    borderWidth: readBorderWidth(data.borderWidth),
    exportFormat: readFormat(data.exportFormat),
    frameRatio: readFrameRatio(data.frameRatio),
    snapRatios: readBoolean(data.snapRatios, DEFAULT_SETTINGS.snapRatios),
    uploadCredit: readBoolean(data.uploadCredit, DEFAULT_SETTINGS.uploadCredit),
    skippedUpdateVersion: readVersion(data.skippedUpdateVersion),
  };
}

export function serializeSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
