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

# --split-per-abi deja fuera también las librerías de los plugins para otras arquitecturas;
# force-version-code-ignoring-abi conserva el versionCode de pubspec.yaml.
flutter build apk --release --split-per-abi --target-platform android-arm64 \
  -P force-version-code-ignoring-abi=true --obfuscate \
  --split-debug-info=build/symbols "--dart-define-from-file=$config"
apk=build/app/outputs/flutter-apk/app-arm64-v8a-release.apk

if [ -n "${ANDROID_HOME:-}" ]; then
  tools=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
  if "$tools/aapt" dump badging "$apk" | grep -q application-debuggable; then
    echo "El APK es depurable: no se publica." >&2; exit 1
  fi
  if "$tools/apksigner" verify --print-certs "$apk" | grep -q "CN=Android Debug"; then
    echo "El APK está firmado con la clave de depuración." >&2; exit 1
  fi
fi
sha256sum "$apk" 2>/dev/null || shasum -a 256 "$apk"
echo "APK de producción listo: $apk (símbolos en build/symbols, no los publiques)."
