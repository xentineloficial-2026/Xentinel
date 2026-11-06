#!/usr/bin/env bash
# Instala dependencias sin sobrescribir la configuracion Android/iOS.
set -euo pipefail
command -v flutter >/dev/null || { echo "Instala Flutter y agregalo al PATH."; exit 1; }
flutter pub get
echo "Listo. Configura API_BASE_URL segun README.md antes de ejecutar flutter run."