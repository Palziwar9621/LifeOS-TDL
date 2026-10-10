param(
    [string]$JavaHome = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot',
    [string]$BuildTools = "$env:USERPROFILE\.bubblewrap\android-sdk\build-tools\35.0.0"
)

# Run interactively: apksigner reads the password from the console. Never pass
# a password as an argument, write it to a file, or start a transcript here.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$inputApk = Join-Path $root 'release\LifeOS-1.3.1-aligned-unsigned.apk'
$outputApk = Join-Path $root 'release\LifeOS-1.3.1.apk'
$key = Join-Path $root 'android.keystore'
$signer = Join-Path $BuildTools 'apksigner.bat'
$aligner = Join-Path $BuildTools 'zipalign.exe'
$expectedCertificate = '42553b2775c3ded1aedd5d66e42e00c5bedd04749b93c8aae2bf81da5991d6fd'

try {
    foreach ($required in @($inputApk, $key, $signer, $aligner, (Join-Path $JavaHome 'bin\java.exe'))) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Missing required local file: $required" }
    }
    if (Test-Path -LiteralPath $outputApk) { throw 'Signed output already exists. Verify it before signing again.' }
    $env:JAVA_HOME = $JavaHome
    & $aligner -c -P 16 4 $inputApk
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment verification failed.' }
    Write-Host 'Sign LifeOS Android 1.3.0 using the existing release key.'
    Write-Host 'Enter the password only at the apksigner prompt below. Input is not recorded.'
    & $signer sign --ks $key --ks-key-alias lifeos --out $outputApk $inputApk
    if ($LASTEXITCODE -ne 0) { throw 'Signing failed. No APK will be published.' }
    $verification = @(& $signer verify --print-certs $outputApk)
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed. Do not publish this file.' }
    $certificate = $verification | Where-Object { $_ -match '^Signer #1 certificate SHA-256 digest:' }
    if ($certificate.Count -ne 1 -or $certificate -notmatch [regex]::Escape($expectedCertificate)) {
        throw 'Signing certificate does not match the existing public APK. Do not publish this file.'
    }
    Write-Host 'SUCCESS: release signed and upgrade certificate matched.' -ForegroundColor Green
    Write-Host $outputApk
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
