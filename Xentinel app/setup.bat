@echo off
REM Instala dependencias sin regenerar ni sobrescribir el codigo nativo.
where flutter >nul 2>&1
if errorlevel 1 (
  echo Instala Flutter y agregalo al PATH antes de continuar.
  exit /b 1
)
call flutter pub get
if errorlevel 1 exit /b 1
echo Listo. Configura API_BASE_URL segun README.md antes de ejecutar flutter run.