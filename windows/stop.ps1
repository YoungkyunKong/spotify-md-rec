$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path (Join-Path $env:LOCALAPPDATA "AlbumDeck") "server.pid"
if (-not (Test-Path -LiteralPath $pidFile)) { exit 0 }

$serverPid = [int](Get-Content -LiteralPath $pidFile -Raw)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
if ($process -and $process.Name -eq "node.exe" -and $process.CommandLine -like "*$appRoot*server.mjs*") {
  Stop-Process -Id $serverPid -Force
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
