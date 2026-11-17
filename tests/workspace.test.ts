import { describe, expect, it } from 'vitest';
import { text } from '../src/core/i18n/text';
import { withBorder } from '../src/core/document';
import {
  EMPTY_DOCUMENT,
  EMPTY_WORKSPACE,
  activateTile,
  activeDocument,
  activeTile,
  addFailedTile,
  addTile,
  moveTile,
  readyTiles,
  removeTile,
  tileOf,
  updateActive,
  updateTile,
} from '../src/core/workspace';
import { makeSource } from './helpers';

function workspaceWith(count: number) {
  let workspace = EMPTY_WORKSPACE;
  for (let index = 0; index < count; index += 1) {
    workspace = addTile(workspace, makeSource(400, 600));
  }
  return workspace;
}

describe('Workspace', () => {
  it('starts empty with no Active Tile', () => {
    expect(EMPTY_WORKSPACE.tiles).toEqual([]);
    expect(EMPTY_WORKSPACE.activeId).toBeNull();
    expect(activeTile(EMPTY_WORKSPACE)).toBeNull();
    expect(activeDocument(EMPTY_WORKSPACE).source).toBeNull();
  });

  it('appends a Tile, makes it active and frames it', () => {
    const source = makeSource(400, 600);
    const workspace = addTile(EMPTY_WORKSPACE, source);

    expect(workspace.tiles).toHaveLength(1);
    expect(workspace.activeId).toBe(workspace.tiles[0].id);
    expect(workspace.tiles[0].doc.source).toBe(source);
    expect(workspace.tiles[0].doc.crop.rect.width).toBeGreaterThan(0);
    expect(activeDocument(workspace).source).toBe(source);
  });

  it('seeds a new Tile from the document it is given, then lets it diverge', () => {
    const first = addTile(EMPTY_WORKSPACE, makeSource(400, 600));
    const shaped = updateActive(first, (doc) => withBorder(doc, { width: 7 }));
    const second = addTile(shaped, makeSource(300, 300), activeDocument(shaped));

    expect(second.tiles[1].doc.border.width).toBe(7);

    const edited = updateTile(second, second.tiles[0].id, (doc) => withBorder(doc, { width: 2 }));
    expect(edited.tiles[0].doc.border.width).toBe(2);
    expect(edited.tiles[1].doc.border.width).toBe(7);
  });

  it('keeps the Active Tile when a failed import is appended', () => {
    const workspace = workspaceWith(2);
    const active = workspace.activeId;
    const failed = addFailedTile(workspace, text('import.corrupt', { name: 'a.png' }));

    expect(failed.tiles).toHaveLength(3);
    expect(failed.activeId).toBe(active);
    expect(failed.tiles[2].error).toEqual(text('import.corrupt', { name: 'a.png' }));
    expect(failed.tiles[2].doc.source).toBeNull();
  });

  it('leaves a failed import inactive on an empty Board', () => {
    const failed = addFailedTile(EMPTY_WORKSPACE, text('import.failed'));
    expect(failed.activeId).toBeNull();
  });

  it('hands the Active Tile to the right neighbour, then the left, then nothing', () => {
    const workspace = workspaceWith(3);
    const [first, second, third] = workspace.tiles;

    const withoutSecond = removeTile({ ...workspace, activeId: second.id }, second.id);
    expect(withoutSecond.activeId).toBe(third.id);

    const withoutThird = removeTile({ ...workspace, activeId: third.id }, third.id);
    expect(withoutThird.activeId).toBe(second.id);

    const empty = removeTile({ ...workspace, activeId: first.id, tiles: [first] }, first.id);
    expect(empty.tiles).toEqual([]);
    expect(empty.activeId).toBeNull();
  });

  it('keeps the Active Tile when another one is removed', () => {
    const workspace = workspaceWith(2);
    const [first, second] = workspace.tiles;
    const next = removeTile({ ...workspace, activeId: second.id }, first.id);
    expect(next.activeId).toBe(second.id);
  });

  it('writes only the Active Tile through updateActive', () => {
    const workspace = workspaceWith(2);
    const next = updateActive(workspace, (doc) => withBorder(doc, { width: 9 }));
    const [first, second] = next.tiles;
    expect(first.doc.border.width).toBe(1);
    expect(second.doc.border.width).toBe(9);
  });

  it('leaves an empty Board untouched through updateActive', () => {
    expect(updateActive(EMPTY_WORKSPACE, (doc) => doc)).toBe(EMPTY_WORKSPACE);
  });

  it('ignores an unknown id when activating', () => {
    const workspace = workspaceWith(1);
    expect(activateTile(workspace, 'nope')).toBe(workspace);
  });

  it('moves a Tile before another one, or to the end', () => {
    const workspace = workspaceWith(3);
    const [first, second, third] = workspace.tiles;

    const moved = moveTile(workspace, third.id, first.id);
    expect(moved.tiles.map((tile) => tile.id)).toEqual([third.id, first.id, second.id]);

    const toEnd = moveTile(workspace, first.id, null);
    expect(toEnd.tiles.map((tile) => tile.id)).toEqual([second.id, third.id, first.id]);
  });

  it('lists only the Tiles a batch can act on', () => {
    const workspace = addFailedTile(workspaceWith(2), text('import.failed'));
    expect(readyTiles(workspace)).toHaveLength(2);
  });

  it('finds a Tile by id', () => {
    const workspace = workspaceWith(2);
    expect(tileOf(workspace, workspace.tiles[1].id)?.id).toBe(workspace.tiles[1].id);
    expect(tileOf(workspace, null)).toBeNull();
  });
});

describe('batch activation', () => {
  it('keeps the Active Tile when a later file of a batch lands', () => {
    const first = addTile(EMPTY_WORKSPACE, makeSource(400, 600));
    const active = first.activeId;
    const second = addTile(first, makeSource(300, 300), EMPTY_DOCUMENT, false);

    expect(second.tiles).toHaveLength(2);
    expect(second.activeId).toBe(active);
  });

  it('still gives the controls to the first Tile of a batch on an empty Board', () => {
    const only = addTile(EMPTY_WORKSPACE, makeSource(400, 600), EMPTY_DOCUMENT, false);
    expect(only.activeId).toBe(only.tiles[0].id);
  });
});

describe('removal with a failed neighbour', () => {
  it('skips a placeholder and hands the controls to a ready Tile', () => {
    const withFailure = addFailedTile(workspaceWith(2), text('import.failed'));
    const [first, second] = withFailure.tiles;
    const next = removeTile({ ...withFailure, activeId: second.id }, second.id);
    expect(next.activeId).toBe(first.id);
  });
});
