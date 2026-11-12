// Generate the platform icon set from assets/icon.svg.
//
// `tauri icon` rasterizes the SVG at each target size on its own. The artwork's
// 6 px border is 0.3 px at 30 px, and a direct rasterization breaks it into
// dots at the small Windows Store sizes. Rendering a 1024 px master once and
// letting `tauri icon` downscale it keeps every size uniform, matching a
// vector editor's export.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const master = mkdtempSync(join(tmpdir(), 'mudae-crop-icon-'));
const quote = (value) => `"${value}"`;

try {
  execSync(`tauri icon ${quote(join(root, 'assets', 'icon.svg'))} --png 1024 -o ${quote(master)}`, {
    cwd: root,
    stdio: 'inherit',
  });
  execSync(
    `tauri icon ${quote(join(master, '1024x1024.png'))} -o ${quote(join(root, 'src-tauri', 'icons'))} --ios-color "#110f17"`,
    { cwd: root, stdio: 'inherit' },
  );
} finally {
  rmSync(master, { recursive: true, force: true });
}

// Cargo keeps the old Windows resource when only the bundle icons change.
const buildScript = join(root, 'src-tauri', 'build.rs');
const now = new Date();
utimesSync(buildScript, now, now);
