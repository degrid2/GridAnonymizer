<#
.SYNOPSIS
  Build one or both GridAnonymizer editions from source.

.DESCRIPTION
  -Target web     TypeScript edition: npm ci (when needed), then the hosted page,
                  the offline page (dist/gridanon-web.html) and the Node CLI.
  -Target dotnet  .NET edition: gridanon in dotnet/out.
  -Target both    (default) web first, then refresh the page embedded in
                  `gridanon ui` from it, then .NET, so both run the same UI.

  Works in Windows PowerShell 5.1 and PowerShell 7 on Windows, Linux and macOS.
  On Linux and macOS without PowerShell, use ./build.sh (same options).

.EXAMPLE
  .\build.ps1                         # both editions
  .\build.ps1 dotnet -Native          # .NET only, as a native single-file executable
  .\build.ps1 web -Test               # TypeScript edition, then its tests
  .\build.ps1 -Run                    # build both, then start gridanon ui
#>
[CmdletBinding()]
param(
  [ValidateSet('both', 'dotnet', 'web')]
  [string]$Target = 'both',

  # .NET: native AOT executable (needs the C++ toolchain, see dotnet/docs/build.md) instead of a portable build.
  [switch]$Native,

  # Run each built edition's tests afterwards.
  [switch]$Test,

  # Start the UI afterwards: gridanon ui (.NET), or the local page server (web only).
  [switch]$Run
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$web = Join-Path $root 'web'
$dotnet = Join-Path $root 'dotnet'
$doWeb = $Target -ne 'dotnet'
$doDotnet = $Target -ne 'web'
$started = Get-Date

function Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail([string]$text) { Write-Host "error: $text" -ForegroundColor Red; exit 1 }

# Run a native command in a folder; stop on a non-zero exit code.
function Invoke-In([string]$dir, [string]$exe, [string[]]$arguments) {
  Push-Location $dir
  try {
    Write-Host "   $exe $($arguments -join ' ')" -ForegroundColor DarkGray
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { Fail "$exe $($arguments -join ' ') failed (exit code $LASTEXITCODE)" }
  } finally { Pop-Location }
}

function Need([string]$exe, [string]$hint) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { Fail "$exe not found. $hint" }
}

$onWindows = ($PSVersionTable.PSEdition -eq 'Desktop') -or $IsWindows

# ── prerequisites ────────────────────────────────────────────────────────────
if ($doWeb) {
  Need 'node' 'Install Node.js 22 or later: https://nodejs.org'
  Need 'npm' 'npm comes with Node.js.'
  $nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
  if ($nodeMajor -lt 22) { Fail "Node.js 22 or later is needed (found $(& node --version))." }
}
if ($doDotnet) {
  Need 'dotnet' 'Install the .NET 10 SDK (10.0.403 or later): winget install Microsoft.DotNet.SDK.10'
  # global.json in dotnet/ makes this fail with a clear message when the SDK is too old.
  Push-Location $dotnet
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'   # Windows PowerShell turns stderr into errors
  try { $sdk = (& dotnet --version 2>&1) -join ' ' } finally { $ErrorActionPreference = $eap; Pop-Location }
  if ($LASTEXITCODE -ne 0) { Fail ".NET SDK 10.0.403 or later is needed (dotnet/global.json). $sdk" }
}

# ── TypeScript edition ───────────────────────────────────────────────────────
if ($doWeb) {
  Step 'TypeScript edition'
  $modules = Join-Path $web 'node_modules'
  $lock = Join-Path $web 'package-lock.json'
  $stale = -not (Test-Path $modules) -or ((Get-Item $lock).LastWriteTime -gt (Get-Item $modules).LastWriteTime)
  if ($stale) { Invoke-In $web 'npm' @('ci', '--no-audit', '--no-fund') }
  Invoke-In $web 'npm' @('run', 'build')

  if ($doDotnet) {
    Step 'Page for gridanon ui (web -> dotnet/src/GridAnonymizer.Cli/wwwroot)'
    Invoke-In $web 'npm' @('run', 'build:dotnet-ui')
  }
}

# ── .NET edition ─────────────────────────────────────────────────────────────
$exeName = if ($onWindows) { 'gridanon.exe' } else { 'gridanon' }
$exe = Join-Path (Join-Path $dotnet 'out') $exeName
if ($doDotnet) {
  Step ".NET edition ($(if ($Native) { 'native executable' } else { 'portable' }))"
  $publish = @('publish', 'src/GridAnonymizer.Cli', '-c', 'Release', '-o', 'out', '--nologo')
  if ($Native) {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    $os = if ($onWindows) { 'win' } elseif ($IsMacOS) { 'osx' } else { 'linux' }
    $publish += @('-r', "$os-$arch")
  }
  Invoke-In $dotnet 'dotnet' $publish
}

# ── tests ────────────────────────────────────────────────────────────────────
if ($Test) {
  if ($doDotnet) {
    Step '.NET tests'
    Invoke-In $dotnet 'dotnet' @('test', '--nologo')
  }
  if ($doWeb) {
    Step 'TypeScript tests'
    # With a fresh .NET binary, the cross-edition parity tests run too (otherwise they are skipped).
    $old = $env:GRIDANON_DOTNET
    if ($doDotnet -and (Test-Path $exe)) { $env:GRIDANON_DOTNET = $exe }
    try {
      Invoke-In $web 'npm' @('run', 'typecheck')
      Invoke-In $web 'npm' @('test')
    } finally { $env:GRIDANON_DOTNET = $old }
  }
}

# ── summary ──────────────────────────────────────────────────────────────────
Step ("Done in {0:n0} s" -f ((Get-Date) - $started).TotalSeconds)
if ($doWeb) {
  Write-Host "   Offline page   $(Join-Path $web 'dist/gridanon-web.html')"
  Write-Host "   Node CLI       $(Join-Path $web 'dist-cli/gridanon.mjs')"
}
if ($doDotnet) {
  Write-Host "   .NET CLI / UI  $exe"
  if (-not $Native) { Write-Host '                  (portable: needs the .NET 10 runtime; add -Native for a standalone executable)' -ForegroundColor DarkGray }
}

if ($Run) {
  if ($doDotnet) {
    Step 'Starting gridanon ui (Ctrl+C to stop)'
    & $exe ui
  } else {
    Step 'Starting the page on http://localhost:8080 (Ctrl+C to stop)'
    Invoke-In $web 'npm' @('start')
  }
}
