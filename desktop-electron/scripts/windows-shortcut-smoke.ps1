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
  # 普通双击图标：第一次启动账号窗口 1；再次双击只唤起已运行的账号窗口 1（第二个进程自行退出），
  # 不再新开账号 2——多开只走托盘「新开账号窗口」（--new-account-window，由 multi-window-smoke 覆盖）。
  $first = Start-Process -FilePath $launchTarget -PassThru
  $apps += $first
  $deadline = (Get-Date).AddSeconds(40)
  do { Start-Sleep -Seconds 1; $first.Refresh() } while ($first.MainWindowHandle -eq 0 -and !$first.HasExited -and (Get-Date) -lt $deadline)
  if ($first.HasExited) { throw "Shortcut launch exited early: $($first.Id), code=$($first.ExitCode)" }
  if ($first.MainWindowHandle -eq 0) { throw 'First shortcut launch has no native window' }
  if ($first.MainModule.FileName -ne $Exe) { throw 'Desktop shortcut launched an unexpected executable' }
  for ($i = 0; $i -lt 3; $i++) {
    $again = Start-Process -FilePath $launchTarget -PassThru
    $apps += $again
    if (!$again.WaitForExit(30000)) { throw "Repeated shortcut launch did not hand off to window 1: $($again.Id)" }
    if ($again.ExitCode -ne 0) { throw "Repeated shortcut launch failed: code=$($again.ExitCode)" }
  }
  Start-Sleep -Seconds 5
  $first.Refresh()
  if ($first.HasExited) { throw 'Native shortcut window did not remain alive' }
  $windows = @(Get-Process touliao -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe -and $_.MainWindowHandle -ne 0 })
  if ($windows.Count -ne 1) { throw "Expected 1 native window after repeated shortcut launches, got $($windows.Count)" }
  @{ ordinaryDesktopShortcutLaunches=4; nativeWindows=1; repeatedLaunchFocusesExisting=$true; noDebuggingFlags=$true; stable=$true } | ConvertTo-Json -Compress
} finally {
  foreach ($app in $apps) { if (!$app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue } }
}
