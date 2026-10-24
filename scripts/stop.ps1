$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
try {
  Set-Location (Split-Path $PSScriptRoot -Parent)
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found. Keep the data lock and check the running service.' }
  & node scripts/launcher.js --stop
  exit $LASTEXITCODE
} catch { Write-Host "Stop failed: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
