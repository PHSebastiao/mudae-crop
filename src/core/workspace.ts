import type { TextRef } from './i18n/text';
/**
 * The Board: an ordered list of Tiles, each with its own DocumentState, and
 * the one Tile that owns the controls. The collection is a pure value so every
 * invariant (one active Tile, order, selection after removal) is testable
 * without React.
 */
import { emptyDocument, withSource, type DocumentState, type Source } from './document';

export interface Tile {
  readonly id: string;
  /** The Tile's own document. A failed import keeps the empty one. */
  readonly doc: DocumentState;
  /** Why the import failed; a failed Tile has no Source. */
  readonly error: TextRef | null;
}

export interface Workspace {
  readonly tiles: readonly Tile[];
  readonly activeId: string | null;
}

/** The document a Board with no Tiles reports: controls render disabled. */
export const EMPTY_DOCUMENT: DocumentState = emptyDocument();

export const EMPTY_WORKSPACE: Workspace = Object.freeze({ tiles: [], activeId: null });

let tileSequence = 0;

/** A stable id for a new Tile; the Board never reuses one. */
export function makeTileId(): string {
  tileSequence += 1;
  return `tile-${tileSequence}`;
}

export function tileOf(workspace: Workspace, id: string | null): Tile | null {
  if (!id) return null;
  return workspace.tiles.find((tile) => tile.id === id) ?? null;
}

export function activeTile(workspace: Workspace): Tile | null {
  return tileOf(workspace, workspace.activeId);
}

/** The Active Tile's document, or a fallback with no Source. */
export function activeDocument(
  workspace: Workspace,
  fallback: DocumentState = EMPTY_DOCUMENT,
): DocumentState {
  return activeTile(workspace)?.doc ?? fallback;
}

export function hasTiles(workspace: Workspace): boolean {
  return workspace.tiles.length > 0;
}

/**
 * Append a Tile for an imported Source. It is seeded from the document the
 * caller passes — normally the Active Tile's — so a batch starts from the card
 * the user already shaped; after this copy the two Tiles are independent.
 *
 * `activate` is false for the later files of a batch: a Tile landing mid-drag
 * must not steal the controls from the Tile being framed.
 */
export function addTile(
  workspace: Workspace,
  source: Source,
  seed: DocumentState = EMPTY_DOCUMENT,
  activate = true,
): Workspace {
  const tile: Tile = {
    id: makeTileId(),
    doc: withSource(seed, source),
    error: null,
  };
  return {
    tiles: [...workspace.tiles, tile],
    activeId: activate ? tile.id : (workspace.activeId ?? tile.id),
  };
}

/** A Tile that stands in for a file that could not be imported. */
export function addFailedTile(workspace: Workspace, error: TextRef): Workspace {
  const tile: Tile = {
    id: makeTileId(),
    doc: emptyDocument(),
    error,
  };
  const tiles = [...workspace.tiles, tile];
  // A failed file must not take the controls from a Tile that works.
  const activeId = workspace.activeId ?? tiles.find((entry) => entry.doc.source)?.id ?? null;
  return { tiles, activeId };
}

/**
 * Remove a Tile. The Active Tile falls to the nearest neighbour that can own
 * the controls, so a failed placeholder never takes them.
 */
export function removeTile(workspace: Workspace, id: string): Workspace {
  const index = workspace.tiles.findIndex((tile) => tile.id === id);
  if (index < 0) return workspace;
  const tiles = workspace.tiles.filter((tile) => tile.id !== id);
  if (workspace.activeId !== id) return { tiles, activeId: workspace.activeId };
  const right = tiles.slice(index).find((tile) => tile.doc.source !== null);
  const left = [...tiles.slice(0, index)].reverse().find((tile) => tile.doc.source !== null);
  return { tiles, activeId: (right ?? left)?.id ?? null };
}

export function activateTile(workspace: Workspace, id: string): Workspace {
  if (workspace.activeId === id) return workspace;
  if (!workspace.tiles.some((tile) => tile.id === id)) return workspace;
  return { ...workspace, activeId: id };
}

/** Write one Tile's document; the updater gets that Tile's current value. */
export function updateTile(
  workspace: Workspace,
  id: string,
  updater: (doc: DocumentState) => DocumentState,
): Workspace {
  let changed = false;
  const tiles = workspace.tiles.map((tile) => {
    if (tile.id !== id) return tile;
    const doc = updater(tile.doc);
    if (doc === tile.doc) return tile;
    changed = true;
    return { ...tile, doc };
  });
  return changed ? { ...workspace, tiles } : workspace;
}

/** Write the Active Tile's document; a Board with no Tiles is untouched. */
export function updateActive(
  workspace: Workspace,
  updater: (doc: DocumentState) => DocumentState,
): Workspace {
  if (!workspace.activeId) return workspace;
  return updateTile(workspace, workspace.activeId, updater);
}

/**
 * Move the Tile `id` to the slot held by `beforeId`, or to the end when
 * `beforeId` is null. Board order is Post order and Export order.
 */
export function moveTile(workspace: Workspace, id: string, beforeId: string | null): Workspace {
  const from = workspace.tiles.findIndex((tile) => tile.id === id);
  if (from < 0) return workspace;
  const moved = workspace.tiles[from];
  const rest = workspace.tiles.filter((tile) => tile.id !== id);
  if (!beforeId) return { ...workspace, tiles: [...rest, moved] };
  const to = rest.findIndex((tile) => tile.id === beforeId);
  if (to < 0) return workspace;
  const tiles = [...rest.slice(0, to), moved, ...rest.slice(to)];
  return { ...workspace, tiles };
}

/** The Tiles a batch command walks: Board order, ready ones only. */
export function readyTiles(workspace: Workspace): readonly Tile[] {
  return workspace.tiles.filter((tile) => tile.doc.source !== null);
}
