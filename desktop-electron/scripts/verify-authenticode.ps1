param([Parameter(Mandatory = $true)][string[]]$Files)
$ErrorActionPreference = 'Stop'
foreach ($file in $Files) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing signed artifact: $file" }
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $signature.SignatureType -ne 'Authenticode') {
        throw "Untrusted Windows publisher signature: $file ($($signature.Status))"
    }
    if (!$signature.TimeStamperCertificate) { throw "Missing trusted signing timestamp: $file" }
    Write-Host "Verified Authenticode: $file; publisher=$($signature.SignerCertificate.Subject)"
}
