param([Parameter(Mandatory = $true)][string[]]$Files)
$ErrorActionPreference = 'Stop'
$policy = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../src/update-policy.json') | ConvertFrom-Json
$pins = @($policy.publisherThumbprints)
if ($pins.Count -eq 0) { throw 'Configure built-in publisherThumbprints before release' }
foreach ($pin in $pins) { if ($pin -cnotmatch '^[A-F0-9]{40}$') { throw 'Invalid built-in publisher pin' } }
foreach ($file in $Files) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing signed artifact: $file" }
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $signature.SignatureType -ne 'Authenticode') {
        throw "Untrusted Windows publisher signature: $file ($($signature.Status))"
    }
    if (!$signature.SignerCertificate -or $pins -cnotcontains $signature.SignerCertificate.Thumbprint) {
        throw "Artifact publisher does not match built-in update policy: $file"
    }
    if (!$signature.TimeStamperCertificate) { throw "Missing trusted signing timestamp: $file" }
    Write-Host "Verified Authenticode: $file; publisher=$($signature.SignerCertificate.Subject)"
}
