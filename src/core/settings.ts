import { DEFAULT_BORDER, clampBorderWidth } from './document';
import { MUDAE_RATIO } from './ratios';
import type { Privacy } from './imagechest';
import { normalizeHexColor } from './color';
import { asRecord, parseJson } from './json';

/** The Export formats this slice can write. */
export type ExportFormat = 'png' | 'gif';

/** What an import does to a Board that already has Tiles. */
export type ImportMode = 'append' | 'replace';

/**
 * Everything Settings owns across launches. A working document is never
 * restored; only the preferences and the last-used choices live here.
 */
export interface Settings {
  readonly token: string;
  readonly defaultPrivacy: Privacy;
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
  /** Whether importing into a Board with Tiles appends or starts over. */
  readonly importMode: ImportMode;
  /**
   * The last known Image Chest account tier. `null` means never checked; an
   * unknown account is treated as standard until a check says otherwise.
   */
  readonly imageChestGold: boolean | null;
  /** Whether a batch upload puts every Tile in one Post. */
  readonly samePost: boolean;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  token: '',
  defaultPrivacy: 'hidden',
  saveFolder: null,
  borderColor: DEFAULT_BORDER.color,
  borderWidth: DEFAULT_BORDER.width,
  exportFormat: 'gif',
  frameRatio: MUDAE_RATIO,
  snapRatios: true,
  uploadCredit: false,
  importMode: 'append',
  imageChestGold: null,
  samePost: false,
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

/** null is a real value here: the account has never been checked. */
function readGold(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readImportMode(value: unknown): ImportMode {
  return value === 'replace' ? 'replace' : DEFAULT_SETTINGS.importMode;
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
    saveFolder: readFolder(data.saveFolder),
    borderColor,
    borderWidth: readBorderWidth(data.borderWidth),
    exportFormat: readFormat(data.exportFormat),
    frameRatio: readFrameRatio(data.frameRatio),
    snapRatios: readBoolean(data.snapRatios, DEFAULT_SETTINGS.snapRatios),
    uploadCredit: readBoolean(data.uploadCredit, DEFAULT_SETTINGS.uploadCredit),
    importMode: readImportMode(data.importMode),
    imageChestGold: readGold(data.imageChestGold),
    samePost: readBoolean(data.samePost, DEFAULT_SETTINGS.samePost),
  };
}

export function serializeSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
