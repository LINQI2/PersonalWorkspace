param([switch]$CheckOnly, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
try {
  Set-Location (Split-Path $PSScriptRoot -Parent)
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found. Install Node.js 24 LTS, then reopen this script.' }
  $nodeVersion = & node -p 'process.versions.node'
  if ([int]($nodeVersion.Split('.')[0]) -ne 24) { throw "Node.js 24 LTS is required. Current version: $nodeVersion" }
  if ($CheckOnly) {
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm was not found.' }
    if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
    & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed; personal data was preserved.' }
    exit 0
  }
  & node scripts/launcher.js
  if ($LASTEXITCODE -ne 0) { throw 'Launch failed. See the reason above; no existing process was forcibly stopped.' }
  $libraryPort = if ($env:PORT) { $env:PORT } else { '3000' }
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$libraryPort" }
} catch {
  Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
