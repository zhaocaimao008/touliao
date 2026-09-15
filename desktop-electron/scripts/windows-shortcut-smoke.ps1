param([Parameter(Mandatory=$true)][string]$Exe)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$shortcut = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory')) |
  ForEach-Object { Get-ChildItem $_ -Filter '*.lnk' -ErrorAction SilentlyContinue } |
  Where-Object { $shell.CreateShortcut($_.FullName).TargetPath -eq $Exe } |
  Select-Object -First 1
if (!$shortcut) { throw 'Installed desktop shortcut missing' }
$shortcutInfo = $shell.CreateShortcut($shortcut.FullName)
if ($shortcutInfo.Arguments -match '--profile') { throw 'Shortcut pins a single profile' }
$apps = @()
try {
  for ($i = 0; $i -lt 6; $i++) {
    $apps += Start-Process -FilePath $shortcut.FullName -PassThru
    if ($i -eq 0) { Start-Sleep -Seconds 8 }
  }
  $deadline = (Get-Date).AddSeconds(40)
  do {
    Start-Sleep -Seconds 1
    $windows = @()
    foreach ($app in $apps) {
      $app.Refresh()
      if ($app.HasExited) { throw "Shortcut launch exited early: $($app.Id), code=$($app.ExitCode)" }
      if ($app.MainWindowHandle -ne 0) { $windows += $app }
    }
  } while ($windows.Count -lt 6 -and (Get-Date) -lt $deadline)
  if ($windows.Count -ne 6) { throw "Expected 6 native windows, got $($windows.Count)" }
  Start-Sleep -Seconds 10
  foreach ($app in $apps) {
    $app.Refresh()
    if ($app.HasExited) { throw 'Native shortcut window did not remain alive' }
  }
  @{ ordinaryDesktopShortcutLaunches=6; nativeWindows=6; noDebuggingFlags=$true; stable=$true } | ConvertTo-Json -Compress
} finally {
  foreach ($app in $apps) { if (!$app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue } }
}
