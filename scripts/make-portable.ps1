# Build the portable ZIP and the standalone executable from one release build.
#
#   npm run tauri build -- --bundles nsis
#   pwsh -NoProfile -File scripts/make-portable.ps1
#
# The release workflow calls this after `npm run tauri build`. The installer is
# copied and renamed next to the two portable assets so a release job can upload
# the whole dist-portable/ folder.
#
#   Mudae-Crop-<version>-win64-setup.exe      NSIS installer, bundled waifu2x
#   Mudae-Crop-<version>-portable-win64.zip   Mudae-Crop.exe + waifu2x/
#   Mudae-Crop-<version>-win64.exe            standalone app, no sidecar

param(
  [string]$Version
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$release = Join-Path $repoRoot 'src-tauri\target\release'
$output = Join-Path $repoRoot 'dist-portable'
$staging = Join-Path $output 'portable'

if (-not $Version) {
  $config = Get-Content (Join-Path $repoRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
  $Version = $config.version
}
if (-not $Version) {
  throw 'The release version is empty.'
}

$exe = Join-Path $release 'mudae-crop.exe'
if (-not (Test-Path $exe)) {
  throw "The release executable was not found at $exe. Run 'npm run tauri build' first."
}

# Tauri copies bundle resources next to the release executable; fall back to the
# installed source folder so a local build without the copy still packs.
$sidecar = Join-Path $release 'waifu2x'
if (-not (Test-Path $sidecar)) {
  $sidecar = Join-Path $repoRoot 'src-tauri\waifu2x'
}
$sidecarExe = Join-Path $sidecar 'waifu2x-ncnn-vulkan.exe'
$sidecarModels = Join-Path $sidecar 'models-cunet'
if (-not (Test-Path $sidecarExe) -or -not (Test-Path $sidecarModels)) {
  throw "The waifu2x sidecar is incomplete in $sidecar. Run 'npm run waifu2x:install' before building."
}

$nsisDir = Join-Path $release 'bundle\nsis'
$installer = if (Test-Path $nsisDir) {
  Get-ChildItem -Path $nsisDir -Filter "*$Version*-setup.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
} else {
  $null
}
if (-not $installer) {
  throw "The NSIS installer for $Version was not found under $nsisDir. Run 'npm run tauri build -- --bundles nsis'."
}

Remove-Item -Recurse -Force $output -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$portableExe = Join-Path $staging 'Mudae-Crop.exe'
Copy-Item $exe $portableExe

# The app only needs the pinned binary, its VC runtime and the cunet models;
# leave the extra model sets and notes out of the portable archive.
$portableSidecar = Join-Path $staging 'waifu2x'
New-Item -ItemType Directory -Force -Path $portableSidecar | Out-Null
Copy-Item $sidecarExe $portableSidecar
foreach ($name in @('vcomp140.dll', 'LICENSE', 'README.md')) {
  $file = Join-Path $sidecar $name
  if (Test-Path $file) { Copy-Item $file $portableSidecar }
}
Copy-Item $sidecarModels (Join-Path $portableSidecar 'models-cunet') -Recurse

$zip = Join-Path $output "Mudae-Crop-$Version-portable-win64.zip"
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -CompressionLevel Optimal

$standalone = Join-Path $output "Mudae-Crop-$Version-win64.exe"
Copy-Item $exe $standalone

$setup = Join-Path $output "Mudae-Crop-$Version-win64-setup.exe"
Copy-Item $installer.FullName $setup

Remove-Item -Recurse -Force $staging

Write-Host 'Built:'
Get-ChildItem $output -File |
  Sort-Object Name |
  ForEach-Object { Write-Host ("  {0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB)) }
