[CmdletBinding()]
param(
  [string]$ConfigFile = (Join-Path $PSScriptRoot '../config/production.json'),
  [Parameter(Mandatory)][string]$WebPublic,
  [string]$Flutter = 'flutter',
  [string]$AndroidSdk = $env:ANDROID_HOME
)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configuration = (Resolve-Path -LiteralPath $ConfigFile).Path
$destination = (Resolve-Path -LiteralPath $WebPublic).Path
if ((Split-Path $destination -Leaf) -ne 'public') { throw 'WebPublic debe ser la carpeta public del FrontEnd.' }
$config = Get-Content -LiteralPath $configuration -Raw | ConvertFrom-Json
$api = [uri]$config.API_BASE_URL
if ($api.Scheme -ne 'https' -or $api.Host -match '(^|\.)(example\.(com|test)|localhost)$' -or $api.Host -match 'midominio' -or $api.UserInfo -or $api.Query -or $api.Fragment -or $config.ALLOW_INSECURE_HTTP -eq $true) {
  throw 'Configura una API HTTPS real de producción sin credenciales, consulta ni fragmento.'
}
if (!(Test-Path -LiteralPath (Join-Path $project 'android/key.properties'))) { throw 'Falta la firma de producción en android/key.properties.' }
if (!$AndroidSdk) { throw 'Indica AndroidSdk o configura ANDROID_HOME.' }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk 'build-tools') -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (!$buildTools) { throw 'No hay Android build-tools instalados.' }
Push-Location $project
try {
  # Ofuscado y sin símbolos de depuración en el APK; los símbolos quedan en build/symbols
  # (no se publican) para descifrar trazas de errores de esta versión.
  & $Flutter build apk --release --split-per-abi --target-platform android-arm64 -P force-version-code-ignoring-abi=true --obfuscate --split-debug-info=build/symbols "--dart-define-from-file=$configuration"
  if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación release.' }
  $apk = Join-Path $project 'build/app/outputs/flutter-apk/app-arm64-v8a-release.apk'
  # Gradle omite la firma v1 cuando minSdk >= 24: apksigner firma de nuevo con la misma
  # clave del proyecto y los esquemas v1, v2 y v3.
  $firma = @{}
  Get-Content -LiteralPath (Join-Path $project 'android/key.properties') | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') { $firma[$Matches[1]] = $Matches[2] }
  }
  $almacen = if ([IO.Path]::IsPathRooted($firma.storeFile)) { $firma.storeFile } else { Join-Path $project "android/$($firma.storeFile)" }
  $env:XN_CLAVE_ALMACEN = $firma.storePassword
  $env:XN_CLAVE_LLAVE = $firma.keyPassword
  try {
    & (Join-Path $buildTools.FullName 'apksigner.bat') sign --ks $almacen --ks-key-alias $firma.keyAlias --ks-pass env:XN_CLAVE_ALMACEN --key-pass env:XN_CLAVE_LLAVE --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true $apk
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo firmar el APK con la clave del proyecto.' }
  } finally {
    Remove-Item Env:XN_CLAVE_ALMACEN, Env:XN_CLAVE_LLAVE -ErrorAction SilentlyContinue
  }
  $badging = (& (Join-Path $buildTools.FullName 'aapt.exe') dump badging $apk) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $badging -match 'application-debuggable') { throw 'APK inválido o depurable.' }
  if ($badging -notmatch "package: name='co.edu.sena.xentinel' versionCode='(\d+)' versionName='(\d+\.\d+\.\d+)'") { throw 'El APK no coincide con Xentinel o su versión no es válida.' }
  $versionCode = [int]$Matches[1]
  $versionName = $Matches[2]
  # Siempre la clave del proyecto (CN=Xentinel): así Android instala cada versión como actualización.
  $certificate = (& (Join-Path $buildTools.FullName 'apksigner.bat') verify --verbose --print-certs --min-sdk-version 23 $apk) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $certificate -notmatch 'Signer #1 certificate SHA-256 digest: 9ec23372e0afd1e7ee6843db7713a1a2cc8d18a16d8806c2ff8f83f373b5ef06') { throw 'El APK no está firmado con la clave del proyecto (CN=Xentinel): revisa android/key.properties.' }
  foreach ($esquema in 'v1', 'v2', 'v3') { if ($certificate -notmatch "Verified using $esquema scheme[^:]*: true") { throw "Falta la firma $esquema." } }
  $downloads = Join-Path $destination 'downloads'
  New-Item -ItemType Directory -Path $downloads -Force | Out-Null
  $fileName = "xentinel-$versionName-$versionCode.apk"
  $publishedApk = Join-Path $downloads $fileName
  $hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
  if (Test-Path -LiteralPath $publishedApk) {
    if ((Get-FileHash -LiteralPath $publishedApk -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
      throw 'Ya existe un APK distinto con esa versión. Incrementa la versión antes de publicar.'
    }
  } else { Copy-Item -LiteralPath $apk -Destination $publishedApk }
  # The Dashboard can evolve its own layout while keeping the manifest contract.
  # Install the fallback page only for a new site, never replace an existing UI.
  if (!(Test-Path -LiteralPath (Join-Path $destination 'Descarga.html'))) {
    foreach ($asset in @('Descarga.html','app-download.mjs')) {
      Copy-Item -LiteralPath (Join-Path $project "web-download/$asset") -Destination (Join-Path $destination $asset)
    }
  }
  $manifest = [ordered]@{ available=$true; packageId='co.edu.sena.xentinel'; version=$versionName;
    versionCode=$versionCode; sizeBytes=(Get-Item -LiteralPath $publishedApk).Length; sha256=$hash;
    url="/downloads/$fileName"; releasedAt=[DateTime]::UtcNow.ToString('o') }
  # Publish metadata last, only after the exact installer exists and is verified.
  $manifestPath = Join-Path $destination 'app-release.json'
  $tempManifest = "$manifestPath.tmp"
  $manifest | ConvertTo-Json | Set-Content -LiteralPath $tempManifest -Encoding utf8
  Move-Item -LiteralPath $tempManifest -Destination $manifestPath -Force
  Write-Output "Instalador y manifiesto sincronizados: $publishedApk"
} finally { Pop-Location }
