# Mudae Crop

A local desktop editor that turns a Source image or animation into a Mudae card: a fixed-size Frame with a Border, exported and uploaded to Image Chest.

## Language

**Source**:
The image or animation the user brings in, from a file, the clipboard, a drop, or a URL. Never modified by editing.

_Avoid_: input, asset, original, image (when you mean the Source)

**Frame**:
The fixed output rectangle the Crop lands in: 225×350 (Mudae), 350×225 (Mudae landscape), or 350×350 (Square), multiplied by the Export scale.

_Avoid_: canvas, output box, viewport

**Orientation**:
Whether a Mudae Frame is portrait (225×350) or landscape (350×225). Square has no Orientation.

_Avoid_: direction, ratio, rotation

**Crop**:
The region of the Source that lands inside the Frame, set by zoom, pan and rotation. A Crop never distorts.

_Avoid_: selection, marquee, cut

**Fit**:
A Crop scale where the Source covers the Frame completely; overflow is cropped.

_Avoid_: cover, fill, crop-to-fill

**Pad**:
A Crop scale where the Source is contained inside the Frame and the leftover area is filled with a solid color.

_Avoid_: contain, letterbox, background mode

**Scale mode**:
How the Crop meets the Frame: Fit, Pad, full width (the Source matches the Frame's width) or full height (it matches the height). Zoom multiplies the mode's scale.

_Avoid_: size mode, anchor, aspect mode

**Rotation**:
A 90° step applied to the Source inside the Crop: 0, 90, 180 or 270. The bitmap is turned at draw time, so steps never compound.

_Avoid_: angle, spin, tilt

**Pad color**:
The solid color painted wherever a Crop leaves the Frame uncovered. Separate from the Border color.

_Avoid_: background, fill color

**Border**:
A solid stroke drawn on top of the Crop, inside the Frame edge, aligned to the Frame regardless of Source rotation. Width is in Frame pixels at 1× and scales with the Export scale.

_Avoid_: stroke, outline, frame line

**Palette**:
The colors judged relevant in the Crop, extracted across every frame of an animation, offered as swatches that set the Border color.

_Avoid_: colors, swatches, dominant colors

**Preset**:
A named Frame size with its default Export settings: Mudae (225×350) and Square (350×350).

_Avoid_: ratio, template, format

**Export**:
The rendered file produced from the current Crop: PNG or JPG for a still, GIF for an animation.

_Avoid_: save, output, result

**Post**:
An Image Chest gallery created by an upload, holding one or more Exports and yielding direct `cdn.imgchest.com` links.

_Avoid_: album, gallery, upload (when you mean the Post)

**History**:
The last 50 events kept for recovery: uploads with their Post and direct link, and local Exports with their file path.

_Avoid_: log, feed, activity
