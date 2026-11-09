# Mudae Crop

A local desktop editor that turns a Source image or animation into a card: a Frame with a chosen Proportion, a Border, and an Export ready to upload to Image Chest.

## Language

**Source**:
The image, animation or video the user brings in, from a file, the clipboard, a drop, or a URL. Never modified by editing.

_Avoid_: input, asset, original, image (when you mean the Source)

**Animation frame**:
One fully composited still inside an animated Source, with its own delay. Not the output Frame.

_Avoid_: frame (when you mean an animation frame), image, layer

**Frame grid**:
The grid of animation-frame cells under the Preview where a bad frame is inspected, removed or retimed. Edits live in the document, not in the Source, and reset when a Source is loaded.

_Avoid_: filmstrip, timeline

**Trim**:
The inclusive range of animation frames a Preview and Export use, set by a start and an end frame. It applies only while the trim toggle is on.

_Avoid_: cut, crop (when you mean Trim), range

**Speed**:
A multiplier on every frame delay, from 0.25× to 4×. Preview and Export run at the same speed.

_Avoid_: FPS, rate, playback speed

**Frame**:
The Crop window over the Source and the Proportion it must keep. The Frame has no pixel size: the Export decides resolution, either the Source pixels the window covers (Nativo) or a Resize.

_Avoid_: canvas, output box, viewport, fixed size

**Proportion**:
The Frame's width / height. The presets are Mudae 9:14, 4:5, 3:4, 2:3, 1:1, 4:3, 3:2, 16:9 and 21:9 plus their flipped forms; a free Proportion is Personalizado.

_Avoid_: aspect, aspect ratio, dimensions of the Frame

**Orientation**:
Whether the Frame's Proportion is portrait, landscape or square. Mudae keeps its 9:14 portrait and its 14:9 landscape; 1:1 is its own Orientation.

_Avoid_: direction, rotation, side

**Crop**:
The rectangle over the rotated Source that lands in the Frame, plus the Scale mode and Rotation. Zoom and offset are readouts derived from that rectangle, not stored. A Crop never distorts.

_Avoid_: selection, marquee, cut

**Fit**:
The Scale mode where the Frame window is the largest rectangle of its Proportion that fits inside the Source. The Source covers the window and the excess is cropped.

_Avoid_: cover, fill, crop-to-fill

**Pad**:
The Scale mode where the Frame window is at least as large as the Source, so the whole Source is visible and the leftover area is filled with a solid color.

_Avoid_: contain, letterbox, background mode

**Scale mode**:
How the Crop's base rectangle is derived: Fit (largest inside the Source), Pad (smallest containing it), full width (the window matches the Source width) or full height (it matches the height). The mode sets the zoom reference; zoom shrinks the window from that base.

_Avoid_: size mode, anchor, aspect mode

**Ajustar Frame**:
The Crop phase toggled in the Crop rail (shortcut C): the whole Source stays fixed while eight handles resize the Frame window. A locked drag anchors the opposite side or corner and keeps the Proportion; Shift releases it into a free Personalizado Proportion; Alt bypasses Encaixe for that drag.

_Avoid_: resize mode, frame editor

**Encaixe**:
Snapping a free Proportion to a preset when it is within 2.5%, and the Frame window's centre to the Source's centre when moving it (within 6 screen pixels). A drag never snaps back to the Proportion it started from. `Encaixar proporções` keeps the ratio preference on or off; Alt bypasses both snaps for one drag.

_Avoid_: magnet, grid, auto-fit

**Guias**:
The rule-of-thirds lines drawn inside the Frame while `Ajustar Frame` is on or the window is being moved. They are reference only and never appear in the Export.

**Rotation**:
A 90° step applied to the Source inside the Crop: 0, 90, 180 or 270. The bitmap is turned at draw time, so steps never compound.

_Avoid_: angle, spin, tilt

**Pad color**:
The solid color painted wherever a Crop leaves the Frame window uncovered. It starts from the Border color the first time Pad is enabled, then changes independently of the Border.

_Avoid_: background, fill color

**Border**:
A solid stroke drawn on top of the Crop, inside the Frame edge, aligned to the Frame regardless of Source rotation. Width is in pixels of the final file and is drawn last, so it is constant at any Export size; Preview only scales it to stay at least one screen pixel.

_Avoid_: stroke, outline, frame line

**Palette**:
The colors judged relevant in the Crop, extracted across every frame of an image animation. A video Source samples the frame currently on screen.

_Avoid_: colors, swatches, dominant colors

**Sharpness**:
An unsharp mask from 0 (off) to 100 applied to the rendered Crop before the Border.

_Avoid_: sharpen, crispness, blur

**Eyedropper**:
The in-app tool that samples the rendered Crop under the pointer for the Pad color, with a pixel magnifier.

_Avoid_: color picker (when you mean the in-app sampler)

**Carta**:
The canonical Mudae Export sizes: 225×350 and 450×700 in portrait, 350×225 and 700×450 in landscape. Offered only when the Frame's Proportion is Mudae 9:14 or 14:9.

_Avoid_: card preset, size preset

**Nativo**:
The Source pixels the Frame window covers: the largest Export that does not upscale. The Export uses it when no Resize is set.

_Avoid_: native size, actual size, real size

**Export**:
The rendered file produced from the current Crop at the chosen size: Nativo or a Resize. PNG for a still or a selected frame, GIF for an animation.

_Avoid_: save, output, result

**Resize**:
An explicit Export width and height, with the Frame's Proportion locked by default. Unlocking it deliberately stretches only the output raster, never the Crop. The 4096 cap shrinks both sides proportionally.

_Avoid_: scale, dimensions of the Frame

**Optimize**:
Lossy GIF compression with optional colour reduction, plus lossless duplicate-frame merging, optionally aimed at a target file size. It never changes the Source or the Trim.

_Avoid_: compress (when you mean the target-size step), reduce quality

**Post**:
An Image Chest gallery created by an upload, holding one or more Exports and yielding direct `cdn.imgchest.com` links.

_Avoid_: album, gallery, upload (when you mean the Post)

**History**:
The last 50 events kept for recovery: uploads with their Post and direct link, and local Exports with their file path.

_Avoid_: log, feed, activity
