param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$actions = @()
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
            $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Button))
            foreach ($button in $buttons) {
                if ($button.Current.IsEnabled -and $button.Current.Name -match 'Next|Install|Finish|下一步|安装|完成') {
                    $actions += @{window=$window.Current.Name;button=$button.Current.Name;process=$process.ProcessName;time=(Get-Date).ToString('o')}
                    $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    $invoke.Invoke()
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
