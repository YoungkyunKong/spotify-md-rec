$ErrorActionPreference = "Stop"

$sourceRoot = $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA "Programs\AlbumDeck"
$startMenu = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"
$desktop = [Environment]::GetFolderPath("Desktop")

$oldStop = Join-Path $installRoot "windows\stop.ps1"
if (Test-Path -LiteralPath $oldStop) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $oldStop
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "web") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "windows") | Out-Null

Copy-Item -LiteralPath (Join-Path $sourceRoot "package.json") -Destination $installRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "package-lock.json") -Destination $installRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "server.mjs") -Destination $installRoot -Force
Copy-Item -Path (Join-Path $sourceRoot "web\*") -Destination (Join-Path $installRoot "web") -Recurse -Force
Copy-Item -Path (Join-Path $sourceRoot "windows\*") -Destination (Join-Path $installRoot "windows") -Recurse -Force

$shell = New-Object -ComObject WScript.Shell
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function New-AlbumDeckShortcut($path, $script, $description) {
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.Description = $description
  $shortcut.Save()
}

$launcher = Join-Path $installRoot "windows\launch.ps1"
$stopper = Join-Path $installRoot "windows\stop.ps1"
New-AlbumDeckShortcut (Join-Path $desktop "Album Deck.lnk") $launcher "Album Deck 실행"
New-AlbumDeckShortcut (Join-Path $startMenu "Album Deck.lnk") $launcher "Album Deck 실행"
New-AlbumDeckShortcut (Join-Path $startMenu "Album Deck Stop.lnk") $stopper "Stop Album Deck server"

[pscustomobject]@{
  InstallPath = $installRoot
  DesktopShortcut = (Join-Path $desktop "Album Deck.lnk")
  StartMenuShortcut = (Join-Path $startMenu "Album Deck.lnk")
} | ConvertTo-Json
