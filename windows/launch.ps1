$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$stateRoot = Join-Path $env:LOCALAPPDATA "AlbumDeck"
$pidFile = Join-Path $stateRoot "server.pid"
$stdoutLog = Join-Path $stateRoot "server.log"
$stderrLog = Join-Path $stateRoot "server-error.log"
$appUrl = "http://127.0.0.1:8888/"
$healthUrl = "http://127.0.0.1:8888/healthz"

New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

function Test-AlbumDeck {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content.Trim() -eq "ok"
  } catch {
    return $false
  }
}

if (-not (Test-AlbumDeck)) {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $server = Join-Path $appRoot "server.mjs"
  $process = Start-Process -FilePath $node -ArgumentList $server -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
  Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-AlbumDeck) { $ready = $true; break }
  }
  if (-not $ready) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Album Deck server did not start. See $stderrLog"
  }
}

$browserCandidates = @(
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)
$browser = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if ($browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$appUrl"
} else {
  Start-Process $appUrl
}
