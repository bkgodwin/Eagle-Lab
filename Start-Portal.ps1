Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 24 or newer is required. Install Node.js, then run this script again.'
}
Write-Host 'Open http://localhost:3000 (or your configured HTTPS URL). Press Ctrl+C to stop.'
& node (Join-Path $PSScriptRoot 'server.mjs')
