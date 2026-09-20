$ErrorActionPreference = "Stop"

$sourceRoot = $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA "Programs\AlbumDeck"
$startMenu = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"
$desktop = [Environment]::GetFolderPath("Desktop")

function Find-NodeExecutable {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )
  return ($candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)
}

$nodePath = Find-NodeExecutable
$nodeMajor = 0
if ($nodePath) {
  $nodeMajor = [int]((& $nodePath --version).TrimStart("v").Split(".")[0])
}

if (-not $nodePath -or $nodeMajor -lt 20) {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    if ($nodePath) {
      throw "현재 Node.js 버전이 $(& $nodePath --version)입니다. Node.js 20 이상 설치에 필요한 winget을 찾지 못했습니다. Windows App Installer를 설치한 뒤 다시 실행해 주세요."
    }
    throw "Node.js 20 이상이 필요합니다. 자동 설치에 필요한 winget을 찾지 못했습니다. Windows App Installer를 설치한 뒤 다시 실행해 주세요."
  }

  Write-Host "Node.js 20 이상이 없어 Node.js LTS를 설치합니다. Windows 권한 확인 창이 나타날 수 있습니다." -ForegroundColor Yellow
  & $winget.Source install --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    throw "Node.js LTS 자동 설치에 실패했습니다. winget 오류 코드: $LASTEXITCODE"
  }

  $env:Path = "$env:ProgramFiles\nodejs;$env:LOCALAPPDATA\Programs\nodejs;$env:Path"
  $nodePath = Find-NodeExecutable
  if (-not $nodePath) {
    throw "Node.js 설치는 완료되었지만 현재 PowerShell에서 node.exe를 찾지 못했습니다. 터미널을 새로 열고 다시 실행해 주세요."
  }
  $nodeMajor = [int]((& $nodePath --version).TrimStart("v").Split(".")[0])
}
if ($nodeMajor -lt 20) {
  throw "Node.js 20 이상이 필요합니다. 현재 버전: $(& $nodePath --version)"
}

$oldStop = Join-Path $installRoot "windows\stop.ps1"
if (Test-Path -LiteralPath $oldStop) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $oldStop
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "web") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "windows") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "assets") | Out-Null

Copy-Item -LiteralPath (Join-Path $sourceRoot "package.json") -Destination $installRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "package-lock.json") -Destination $installRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "server.mjs") -Destination $installRoot -Force
Copy-Item -Path (Join-Path $sourceRoot "web\*") -Destination (Join-Path $installRoot "web") -Recurse -Force
Copy-Item -Path (Join-Path $sourceRoot "windows\*") -Destination (Join-Path $installRoot "windows") -Recurse -Force
Copy-Item -Path (Join-Path $sourceRoot "assets\*") -Destination (Join-Path $installRoot "assets") -Recurse -Force

$shell = New-Object -ComObject WScript.Shell
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function New-AlbumDeckShortcut($path, $script, $description, $icon) {
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.Description = $description
  $shortcut.IconLocation = "$icon,0"
  $shortcut.Save()
}

$launcher = Join-Path $installRoot "windows\launch.ps1"
$stopper = Join-Path $installRoot "windows\stop.ps1"
$icon = Join-Path $installRoot "assets\album-deck.ico"
New-AlbumDeckShortcut (Join-Path $desktop "Album Deck.lnk") $launcher "Album Deck 실행" $icon
New-AlbumDeckShortcut (Join-Path $startMenu "Album Deck.lnk") $launcher "Album Deck 실행" $icon
New-AlbumDeckShortcut (Join-Path $startMenu "Album Deck Stop.lnk") $stopper "Album Deck 서버 종료" $icon

$iconRefresh = Join-Path $env:SystemRoot "System32\ie4uinit.exe"
if (Test-Path -LiteralPath $iconRefresh) {
  & $iconRefresh -show
}

[pscustomobject]@{
  InstallPath = $installRoot
  DesktopShortcut = (Join-Path $desktop "Album Deck.lnk")
  StartMenuShortcut = (Join-Path $startMenu "Album Deck.lnk")
} | ConvertTo-Json
