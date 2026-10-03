param([Parameter(Mandatory=$true)][string]$Exe)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$links = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory')) |
  ForEach-Object { Get-ChildItem $_ -Filter '*.lnk' -ErrorAction SilentlyContinue } |
  ForEach-Object { @{path=$_.FullName; target=$shell.CreateShortcut($_.FullName).TargetPath} }
$links | ConvertTo-Json -Compress | Write-Host
$name = (Get-Content (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json).build.nsis.shortcutName + '.lnk'
# WScript can return an empty target for shell links on the runner's D: volume.
# Verify the actual process launched by the installed shortcut instead.
$shortcut = $links | Where-Object { (Split-Path $_.path -Leaf) -eq $name } |
  Select-Object -First 1
if (!$shortcut) { throw 'Installed desktop shortcut missing' }
$shortcutInfo = $shell.CreateShortcut($shortcut.path)
if ($shortcutInfo.Arguments -match '--profile') { throw 'Shortcut pins a single profile' }
$launchTarget = $shortcut.path
$apps = @()
try {
  # 从已安装的桌面快捷方式连续启动四次，每次都应保留一个独立的原生账号窗口。
  for ($i = 1; $i -le 4; $i++) {
    $app = Start-Process -FilePath $launchTarget -PassThru
    $apps += $app
    $deadline = (Get-Date).AddSeconds(40)
    do { Start-Sleep -Seconds 1; $app.Refresh() } while ($app.MainWindowHandle -eq 0 -and !$app.HasExited -and (Get-Date) -lt $deadline)
    if ($app.HasExited) { throw "Shortcut launch $i exited early: $($app.Id), code=$($app.ExitCode)" }
    if ($app.MainWindowHandle -eq 0) { throw "Shortcut launch $i has no native window" }
    if ($app.MainModule.FileName -ne $Exe) { throw "Desktop shortcut launched an unexpected executable: $($app.MainModule.FileName)" }
  }
  Start-Sleep -Seconds 5
  foreach ($app in $apps) { $app.Refresh(); if ($app.HasExited) { throw "Native shortcut window exited: $($app.Id)" } }
  $windows = @(Get-Process touliao -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe -and $_.MainWindowHandle -ne 0 })
  if ($windows.Count -ne 4) { throw "Expected 4 native windows after repeated shortcut launches, got $($windows.Count)" }
  @{ ordinaryDesktopShortcutLaunches=4; nativeWindows=4; separateProcesses=$true; noDebuggingFlags=$true; stable=$true } | ConvertTo-Json -Compress
} finally {
  foreach ($app in $apps) { if (!$app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue } }
}
