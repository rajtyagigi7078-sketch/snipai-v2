$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $PSScriptRoot '../.build/windows-runtime'
$prerequisites = Join-Path $runtimeRoot 'prerequisites'
New-Item -ItemType Directory -Path $prerequisites -Force | Out-Null
$redist = Join-Path $prerequisites 'VC_redist.x64.exe'
if (-not (Test-Path -LiteralPath $redist)) {
  Invoke-WebRequest -Uri 'https://aka.ms/vc14/vc_redist.x64.exe' -OutFile $redist
}
function Assert-MicrosoftSignature($file) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw "Microsoft signature verification failed: $file"
  }
}
Assert-MicrosoftSignature $redist
$names = @('msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','msvcp140_atomic_wait.dll','msvcp140_codecvt_ids.dll','vcruntime140.dll','vcruntime140_1.dll','concrt140.dll','vcomp140.dll')
$files = @()
foreach ($name in $names) {
  # Use Microsoft's signed redistributable runtime, never debug DLLs or web DLL mirrors.
  $source = Join-Path $env:SystemRoot "System32/$name"
  Assert-MicrosoftSignature $source
  foreach ($folder in @('python','node')) {
    $destination = Join-Path $runtimeRoot "$folder/$name"
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $files += @{path="$folder/$name";sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLower();version=(Get-Item -LiteralPath $source).VersionInfo.FileVersion}
  }
}
$files += @{path='prerequisites/VC_redist.x64.exe';sha256=(Get-FileHash -LiteralPath $redist -Algorithm SHA256).Hash.ToLower();source='https://aka.ms/vc14/vc_redist.x64.exe'}
@{version=1;files=$files} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runtimeRoot 'native-runtime-manifest.json') -Encoding utf8
Write-Output "Prepared signed app-local runtime files and official repair installer."
