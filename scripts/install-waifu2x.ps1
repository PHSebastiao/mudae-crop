# Install the pinned waifu2x-ncnn-vulkan Windows build and its models.
#
#   npm run waifu2x:install
#   pwsh -File scripts/install-waifu2x.ps1 -Force
#
# The binary is a release asset, not part of this repository. The app looks for
# it under src-tauri/waifu2x/ in development and under the bundled resource
# directory in an installed build.

param(
  [string]$Version = '20250915',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repoRoot 'src-tauri\waifu2x'
$exe = Join-Path $target 'waifu2x-ncnn-vulkan.exe'
$models = Join-Path $target 'models-cunet'

if (-not $Force -and (Test-Path $exe) -and (Test-Path $models)) {
  Write-Host "waifu2x already present in $target"
  exit 0
}

$asset = "waifu2x-ncnn-vulkan-$Version-windows.zip"
$url = "https://github.com/nihui/waifu2x-ncnn-vulkan/releases/download/$Version/$asset"
$work = Join-Path ([System.IO.Path]::GetTempPath()) "mudae-crop-waifu2x-$Version"
$zip = Join-Path $work $asset

New-Item -ItemType Directory -Force -Path $work | Out-Null
New-Item -ItemType Directory -Force -Path $target | Out-Null

Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip

$expanded = Join-Path $work 'expanded'
if (Test-Path $expanded) { Remove-Item -Recurse -Force $expanded }
Expand-Archive -Path $zip -DestinationPath $expanded -Force

# The release nests everything in one folder; flatten it into src-tauri/waifu2x.
$root = Get-ChildItem -Path $expanded -Directory | Select-Object -First 1
$source = if ($root) { $root.FullName } else { $expanded }
Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force

if (-not (Test-Path $exe)) { throw "waifu2x-ncnn-vulkan.exe was not found after extracting $asset" }
if (-not (Test-Path $models)) { throw "models-cunet was not found after extracting $asset" }

Remove-Item -Recurse -Force $work
Write-Host "waifu2x $Version installed in $target"
