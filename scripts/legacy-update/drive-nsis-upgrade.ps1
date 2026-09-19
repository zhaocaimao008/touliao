param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NsISButtons {
    private delegate bool EnumChildProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    public static string Text(IntPtr hwnd) { var text = new StringBuilder(1024); GetWindowText(hwnd, text, text.Capacity); return text.ToString(); }
    public static IntPtr[] Find(IntPtr parent) {
        var buttons = new List<IntPtr>();
        EnumChildWindows(parent, (hwnd, data) => {
            var name = new StringBuilder(100); GetClassName(hwnd, name, name.Capacity);
            if (name.ToString() == "Button") buttons.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return buttons.ToArray();
    }
}
'@
$actions = @()
$seen = @{}
$deadline = (Get-Date).AddSeconds(170)
try {
    while ((Get-Date) -lt $deadline) {
        $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.Condition]::TrueCondition)
        $installerWindows = 0
        foreach ($window in $windows) {
            if ($window.Current.Name -notmatch '投聊') { continue }
            $process = Get-Process -Id $window.Current.ProcessId -ErrorAction SilentlyContinue
            if (!$process -or $process.ProcessName -eq 'touliao') { continue }
            $installerWindows++
            if (!$seen.ContainsKey($window.Current.Name)) {
                $seen[$window.Current.Name] = $true
                $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
                $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                try {
                    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
                    $bitmap.Save((Join-Path $Output 'nsis-native-wizard.png'))
                } finally { $graphics.Dispose(); $bitmap.Dispose() }
            }
            # NSIS displays standard Win32 buttons that this runner's UIA
            # provider does not expose as ControlType.Button. Address the real
            # controls by their window class/text; never launch another installer.
            $buttons = [NsISButtons]::Find([IntPtr]$window.Current.NativeWindowHandle)
            foreach ($button in $buttons) {
                $name = [NsISButtons]::Text($button)
                if ([NsISButtons]::IsWindowVisible($button) -and [NsISButtons]::IsWindowEnabled($button) -and $name -match 'Next|Install|Finish|下一步|安装|完成') {
                    $actions += @{window=$window.Current.Name;button=$name;process=$process.ProcessName;time=(Get-Date).ToString('o');driver='Win32 BM_CLICK'}
                    ConvertTo-Json -InputObject @($actions) -Depth 4 | Set-Content (Join-Path $Output 'nsis-ui-actions.json')
                    if (![NsISButtons]::PostMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Native button click failed' }
                    Start-Sleep -Seconds 1
                    break
                }
            }
        }
        $version = if (Test-Path $env:LEGACY_EXE) { (Get-Item $env:LEGACY_EXE).VersionInfo.ProductVersion } else { '' }
        if ($version -like '8.1.27*' -and $installerWindows -eq 0) { exit 0 }
        Start-Sleep -Seconds 1
    }
    throw 'Actual updater-launched NSIS wizard did not complete'
} finally {
    ConvertTo-Json -InputObject @($actions) -Depth 4 | Set-Content (Join-Path $Output 'nsis-ui-actions.json')
}
