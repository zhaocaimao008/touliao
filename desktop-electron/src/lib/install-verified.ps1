param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$ExpectedSha512,
  [Parameter(Mandatory=$true)][string]$PublisherPins
)
$ErrorActionPreference = 'Stop'
$stream = $null
$directoryLocks = New-Object 'System.Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]'
try {
  # Lock every ancestor as well: replacing a parent directory/junction must not redirect the launch path.
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class TouliaoUpdatePathLock {
  [StructLayout(LayoutKind.Sequential)] public struct AttributeTag { public uint Attributes; public uint ReparseTag; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int infoClass, out AttributeTag info, uint size);
  public static SafeFileHandle OpenDirectory(string path) {
    // FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT; FILE_SHARE_READ only.
    var handle = CreateFile(path, 0x80000000, 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    if (handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
    AttributeTag info;
    if (!GetFileInformationByHandleEx(handle, 9, out info, 8) || (info.Attributes & 0x400) != 0) {
      handle.Dispose(); throw new InvalidOperationException("Untrusted update directory");
    }
    return handle;
  }
}
'@
  $fullPath = [IO.Path]::GetFullPath($Installer)
  if ($fullPath -notmatch '^[A-Za-z]:\\') { throw 'Only local drive paths are supported' }
  $parents = New-Object 'System.Collections.Generic.List[string]'
  $parent = [IO.Directory]::GetParent($fullPath)
  while ($null -ne $parent) { $parents.Add($parent.FullName); $parent = $parent.Parent }
  $parents.Reverse()
  foreach ($directory in $parents) { $directoryLocks.Add([TouliaoUpdatePathLock]::OpenDirectory($directory)) }

  if ($ExpectedSha512 -notmatch '^[a-f0-9]{128}$') { throw 'Invalid digest' }
  $pins = $PublisherPins.Split(',')
  if ($pins.Count -eq 0) { throw 'Missing publisher' }
  foreach ($pin in $pins) { if ($pin -notmatch '^[A-F0-9]{40}$') { throw 'Invalid publisher' } }
  $item = Get-Item -LiteralPath $fullPath
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point blocked' }
  # FileShare.Read denies writes, rename and deletion until the installer process exits.
  $stream = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $hash = [Security.Cryptography.SHA512]::Create()
  try { $actual = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose() }
  if ($actual -cne $ExpectedSha512) { throw 'Installer digest mismatch' }
  $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $pins -cnotcontains $signature.SignerCertificate.Thumbprint) {
    throw 'Untrusted publisher or invalid Authenticode signature'
  }
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $item.FullName
  $start.Arguments = '--updated --force-run'
  $start.UseShellExecute = $false
  $process = [Diagnostics.Process]::Start($start)
  if ($null -eq $process) { throw 'Installer did not start' }
  [Console]::Out.WriteLine('STARTED')
  [Console]::Out.Flush()
  $process.WaitForExit()
  exit $process.ExitCode
} catch {
  [Console]::Error.WriteLine('Verified installation failed')
  exit 1
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
  foreach ($directoryLock in $directoryLocks) { $directoryLock.Dispose() }
}
