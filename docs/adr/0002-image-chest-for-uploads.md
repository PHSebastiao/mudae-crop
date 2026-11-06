# Upload to Image Chest, not Imgur

The user already uploads Mudae card links to an image host, but Imgur renders animated GIFs poorly in Discord embeds. Image Chest returns direct `cdn.imgchest.com/files/...` links, accepts 30 MB per file, and authenticates with a personal access token — no OAuth dance, no client secret, no refresh-token rotation. We target Image Chest only; Imgur is removed from scope.

## Consequences

A Post is the gallery unit (up to 20 files), so each upload creates a hidden Post by default, with an optional append to an existing Post id. Whether an uploaded GIF stays animated and hotlinkable must be validated with a real token before the upload UI is built.
