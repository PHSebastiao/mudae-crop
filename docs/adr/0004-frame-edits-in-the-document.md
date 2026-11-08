# Frame edits live in the document, not in the Source

The frame grid deletes and retimes animation frames. We keep the imported Source immutable and store an editable animation view on the document; Preview, Trim, Palette and Export read that view through `effectiveSource(doc)`. Deleting a frame therefore changes frame indices, duration, Trim bounds and the GIF in one place, and loading another Source rebuilds the view. A video Source has no editable animation and passes through untouched.

## Consequences

Every core path that reads animation frames by index must go through `effectiveSource`; reading `doc.source.animation` directly would silently ignore the edits. The last remaining frame cannot be deleted, and a single-frame view is treated as a still, so it exports as PNG and loses the Trim.
