# The Frame is a crop window over the Source

The Frame started as a fixed pixel rectangle (225×350, 350×225 or 350×350) with
a Crop expressed as zoom and pan inside it. That made the Frame and the Export
resolution the same thing, which only works for one card. Once the app offers
arbitrary proportions and the Export owns the output resolution, a pixel-sized
Frame is a lie: the same composition should be exportable at 225×350 or at the
crop's native 1240×1920.

We store only the Frame's proportion. The Crop is the window itself: an
`{x, y, width, height}` rectangle in the rotated Source's pixel space, plus the
Scale mode and Rotation. `frame.ratio` always equals `width / height`; zoom and
offsets are derived readouts for the rail, never the source of truth. The Export
size is an explicit `resize`, or the native size of that rectangle (rounded and
capped at 4096 proportionally), so the output resolution lives only in Export.
The Border is drawn last in pixels of the final file, independent of the Frame.

## Consequences

- `outputSize(doc)` depends on the Crop; there is no `Frame × 1×/2×` anymore.
  The Mudae `Carta 1×/2×` presets are plain Export sizes offered only for 9:14 /
  14:9, not a property of the Frame.
- Every crop mutation must preserve `frame.ratio === rect.width / rect.height`
  and end in `clampCrop`. A free (Shift) resize changes both the rect and the
  ratio; a locked one keeps the ratio and anchors the opposite side/corner.
- Limits are derived from the mode: the rect grows at most to the Fit rect (Fit)
  or the Pad rect (other modes), and shrinks to the Fit rect / 8.
- A 90° rotation keeps the rect's size and moves its centre into the swapped
  bounds, so a window that was already at its size limit can be clamped smaller;
  four steps do not always restore the exact size. Keeping the proportion makes
  that unavoidable, and the alternative (swapping the sides) would flip the
  Frame.
- A preset is identified within 0.1% (labels, Carta, persistence); snapping a
  free drag uses a wider 2.5%. The two tolerances must not be conflated, or a
  ratio that merely looks like Mudae would promise an exact Carta it cannot
  produce.
- The crop tool edits the rectangle over a fixed Source; the stage shows the
  whole Source while the tool is on, so the image never moves under the drag.
  The Frame canvas is hidden, so the window is the backdrop's own Source and
  nothing is re-rendered inside it; the backdrop redraws the Source on every
  change and its feather mask excludes the window.
- `MAX_EXPORT_SIDE` is a memory bound of the canvas and GIF encoder. With the
  proportion lock on it shrinks both sides by the same factor, so the cap can
  never stretch the output; an unlocked resize clamps each side on its own.
- `settings.json` keeps the last preset ratio and the snapping preference. A
  free `Personalizado` ratio is not persisted, and the old `exportScale` key is
  ignored and dropped on the next save.
- The Preview Border is scaled by `previewWidth / exportWidth` with a one-pixel
  floor only so it stays visible; the exported file always gets exactly the
  stored width.
