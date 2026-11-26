#!/usr/bin/env bash
# Compila el APK de producción en Linux o macOS (equivalente a publish-android.ps1).
#
#   ./scripts/build-release.sh [config/production.json]
#
# Exige un servidor HTTPS real compilado en la app (sin IP locales ni puertos manuales),
# la firma de producción en android/key.properties y rechaza binarios depurables.
# Genera un único APK para arm64-v8a, la arquitectura de los teléfonos Android actuales.
set -euo pipefail
cd "$(dirname "$0")/.."
# Huella SHA-256 del certificado de la clave del proyecto (CN=Xentinel). Todas las
# versiones se firman con esa clave para que Android las instale como actualización.
FIRMA_XENTINEL=9ec23372e0afd1e7ee6843db7713a1a2cc8d18a16d8806c2ff8f83f373b5ef06
config="${1:-config/production.json}"
command -v flutter >/dev/null || { echo "Instala Flutter y agrégalo al PATH." >&2; exit 1; }
[ -f android/key.properties ] || { echo "Falta la firma de producción en android/key.properties." >&2; exit 1; }

python3 - "$config" <<'PY'
import json, sys
from urllib.parse import urlsplit
data = json.load(open(sys.argv[1]))
url = urlsplit(data.get("API_BASE_URL", ""))
host = url.hostname or ""
if (url.scheme != "https" or not host or host == "localhost"
        or host.endswith(("example.com", "example.test")) or "midominio" in host
        or host.replace(".", "").isdigit() or url.username or url.query or url.fragment
        or data.get("ALLOW_INSECURE_HTTP") is True or not url.path.rstrip("/").endswith("/api/v1")):
    sys.exit("Configura API_BASE_URL=https://<dominio-real>/api/v1 sin HTTP, IP, credenciales ni consulta.")
PY

[ -n "${ANDROID_HOME:-}" ] || { echo "Define ANDROID_HOME (Android SDK) para firmar y comprobar el APK." >&2; exit 1; }
tools=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)

# --split-per-abi deja fuera también las librerías de los plugins para otras arquitecturas;
# force-version-code-ignoring-abi conserva el versionCode de pubspec.yaml.
flutter build apk --release --split-per-abi --target-platform android-arm64 \
  -P force-version-code-ignoring-abi=true --obfuscate \
  --split-debug-info=build/symbols "--dart-define-from-file=$config"
apk=build/app/outputs/flutter-apk/app-arm64-v8a-release.apk

# Gradle omite la firma v1 cuando minSdk >= 24: apksigner firma de nuevo el mismo APK con
# la misma clave del proyecto y los esquemas v1, v2 y v3.
propiedad() { sed -n "s/^$1=//p" android/key.properties | head -1; }
almacen=$(propiedad storeFile)
case "$almacen" in /*) ;; *) almacen="android/$almacen" ;; esac
XN_CLAVE_ALMACEN=$(propiedad storePassword) XN_CLAVE_LLAVE=$(propiedad keyPassword) \
  "$tools/apksigner" sign --ks "$almacen" --ks-key-alias "$(propiedad keyAlias)" \
  --ks-pass env:XN_CLAVE_ALMACEN --key-pass env:XN_CLAVE_LLAVE \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true "$apk"

if "$tools/aapt" dump badging "$apk" | grep -q application-debuggable; then
  echo "El APK es depurable: no se publica." >&2; exit 1
fi
firma=$("$tools/apksigner" verify --print-certs "$apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
if [ "$firma" != "$FIRMA_XENTINEL" ]; then
  echo "El APK no está firmado con la clave del proyecto (CN=Xentinel): revisa android/key.properties." >&2
  exit 1
fi
verificacion=$("$tools/apksigner" verify --verbose --min-sdk-version 23 "$apk")
for esquema in v1 v2 v3; do
  grep -q "Verified using $esquema scheme.*: true" <<<"$verificacion" ||
    { echo "Falta la firma $esquema." >&2; exit 1; }
done
sha256sum "$apk" 2>/dev/null || shasum -a 256 "$apk"
echo "APK de producción listo: $apk (símbolos en build/symbols, no los publiques)."
