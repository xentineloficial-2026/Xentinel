# Xentinel · Aplicación web

Proyecto local en React (JSX), Vite y CSS documentado en español. La marca visible dice **Xentinel** y utiliza el escudo con candado y llave en vector. Fuentes Archivo e IBM Plex Mono alojadas localmente, temas oscuro y claro en tonos petróleo; el color saturado se reserva para emergencias. Los tokens se comparten con la app en `public/tema.css` y `lib/core/theme.dart`.

El servidor de desarrollo usa siempre el puerto 5173 porque es el origen autorizado en `WEB_ORIGINS` del backend. Si el puerto está ocupado, Vite se detiene con un aviso en lugar de cambiar de puerto, lo que haría fallar el login con un 403.

## Ejecutar y comprobar

Requiere Node 22.12+ o una versión LTS compatible con Vite 8.

```sh
npm ci
npm run dev
npm run lint
npm test
npm run build
```

Iniciar FastAPI por separado desde `BackEnd` con `python -m xentinel servir`. Consulte `BackEnd/README.md` para instalar las dependencias de Python y verificar las migraciones antes del primer arranque. El proxy de Vite conserva `/api/v1` en el puerto 8000. Abrir `http://localhost:5173` o el puerto que muestre Vite. El origen exacto debe estar permitido en `WEB_ORIGINS` del backend. `VITE_API_URL`, si se define en `.env`, es el origen de la API sin `/api/v1`. Mantenga los secretos en el entorno del backend.

En producción servir `dist/` con fallback a `index.html` para las rutas de React y un proxy independiente para `/api/v1`. `/Descarga.html` y sus recursos son estáticos. La fuente se sirve localmente. La descarga conserva la validación del manifiesto `public/app-release.json`; actualmente `available: false`, por lo que muestra el instalador pendiente y no fabrica un enlace. El video depende del proveedor original Mux.

## Estructura modular

- `src/modulos/admin`: entrada del administrador, gestión de personas y programas, y exportaciones.
- `src/modulos/celador`: entrada del celador, registro de accesos y lector QR.
- `src/modulos/instructor`: entrada del instructor, fichas, agenda semanal y calendario de asistencia.
- `src/modulos/visitante`: entrada de la comunidad/visitante y credencial QR. Los roles heredados Aprendiz y Usuario Nuevo usan esta composición, manteniendo su rol real en la API.
- `src/modulos/publico`: portada, contactos, plataforma y dos propuestas SaaS.
- `src/modulos/autenticacion`: login, registro y recuperación de contraseña.
- `src/estructura`: composición del panel y navegación entre módulos.
- `src/compartido`: estadísticas, perfil, alertas, controles, identidad, contexto, servicios y renderizado Three.js.
- `src/configuracion`: navegación y cinco contactos de ejemplo.
- `src/estilos` y `public/tema.css`: reset y variables de diseño en español.
- `tests`: contratos y entorno de interfaz aislado, sin datos reales.

Los nombres de componentes, variables, funciones, estados y archivos propios se expresan en español. Se preservan los nombres exigidos por ECMAScript, React, HTML, CSS, Fetch, Three.js y la API (`data`, `message`, `method`, `Authorization`, etc.), los identificadores del backend y los archivos de configuración reconocidos por las herramientas. Los ganchos conservan el prefijo `use` requerido por las convenciones de React. El proyecto conserva JSX; no se presenta como una migración a TypeScript.

Cada archivo incluye comentarios de responsabilidad; los estados, referencias, consultas y operaciones están documentados dentro de su contexto. La composición compartida evita duplicar estadísticas o reglas de autorización entre roles.

## Navegación y UX

| Ruta                                              | Resultado                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/`                                               | Portada inspirada en la distribución Samsung, marca Xentinel y video original          |
| `/login`                                          | Login real; al entrar siempre abre el dashboard del rol                                |
| `/admin`, `/celador`, `/instructor`, `/visitante` | Dashboard con saludo y estadísticas; navegación lateral con logout al extremo inferior |
| `?modulo=qr`                                      | Identificador QR propio y descarga SVG                                                 |
| `?modulo=ingresos`                                | Historial y registro manual. Lector QR para celador y PDF diario para administrador    |
| `?modulo=fichas`                                  | Tarjetas con jornada, fechas, detalles y avance temporal                               |
| `?modulo=horarios`                                | Agenda semanal con clases y buscador. Exportación PDF y Excel para administrador       |
| `?modulo=asistencias`                             | Mes navegable y detalle del día seleccionado                                           |
| `?modulo=alertas`                                 | Alertas institucionales, reportes y ayuda voluntaria                                   |
| `?modulo=usuarios`                                | Administración: directorio, crear, editar, desactivar y filtrar por estado con totales |
| `?modulo=programas`                               | Administración: programas activos e inactivos con fichas, horarios y entornos          |
| `?modulo=perfil`                                  | Consulta/edición personal; cambio de contraseña por acción explícita                   |
| `/contacto`                                       | Exactamente cinco tarjetas con foto, teléfono y correo de demostración                 |
| `/servicios`                                      | Corporativo e Institucional, selector mensual/anual y “Aún no disponible”              |
| `/recuperar-contrasena`                           | Solicitud de enlace por correo                                                         |
| `/restablecer-contrasena`                         | Formulario solo después de validar token y correo con el servidor                      |

No hay redirección automática a cambio de contraseña ni al perfil al iniciar sesión. Las rutas `/aprendiz`, `/usuarionuevo`, `/usernuevo` conservan un alias a `/visitante`; `horario`, `asistencia` y `dashboard` mantienen alias de módulo. Las rutas desconocidas presentan una recuperación de navegación.

## Video y Three.js

Se conserva exactamente el HLS original. Un `VideoTexture` lo renderiza en una escena Three.js con cámara adaptable, marco de luz blanca constante y eslogan en textura. El movimiento del puntero es sutil y respeta movimiento reducido. Se detiene el video fuera de pantalla o al ocultar la pestaña. Al desmontar se liberan texturas, geometrías, materiales, observadores y contexto WebGL.

Si WebGL no puede inicializarse, el mismo video sigue disponible mediante HTML. La carga fallida tiene un reintento explícito. Three.js, HLS y el lector de cámara se importan bajo demanda. Las bibliotecas Three.js/HLS generan una advertencia de tamaño de chunk; la compilación sigue siendo válida. Referencia técnica: [documentación de Three.js](https://threejs.org/docs/).

## QR y alertas

El QR contiene únicamente `sistema`, `version` e `id_usuarios`; no incluye contraseña, documento, correo ni token de sesión. El lector acepta exclusivamente ese formato. La cámara se inicia por acción explícita y se detiene al leer o salir. La persona operadora confirma que verificó la identidad antes de registrar. La API comprueba rol, estado y secuencia entrada/salida. Los reintentos de red conservan un UUID para evitar duplicados.

El QR identifica al usuario: el contrato actual no emite ni verifica credenciales firmadas. No debe considerarse una prueba criptográfica de identidad. El frontend no puede reemplazar ese servicio.

Administración publica y cierra alertas; los instructores envían pases de lista y consultan reportes. SOS solicita ubicación solamente después de que la persona confirma compartirla. Las alertas activas se revisan cada 30 segundos y al volver a la pestaña. Los fallos de consulta muestran un estado de error y reintento.

## Recuperación por correo

Configurar en el backend `RESET_PASSWORD_URL=https://<frontend>/restablecer-contrasena`, además de SMTP y su worker. La página acepta `token` y `correo` en consulta o fragmento, limpia la URL y espera una validación positiva del servidor antes de mostrar el formulario. Al guardar, el backend vuelve a verificar el token de un solo uso. La interfaz distingue enlace inválido, carga, error y éxito. Sin backend, SMTP y base de datos activos no puede certificarse el envío real de correo.

## Auditoría y límites

No se encontró la especificación formal de requisitos funcionales; la cobertura se contrastó con las rutas actuales del backend. No se afirma el cumplimiento de una especificación ausente.

- Administración puede editar programas y los horarios de sus fichas. Las asignaciones de personas siguen siendo de consulta.
- Los calendarios y estadísticas representan los registros consultados, con paginación y límite explícito; no inventan totales históricos.
- El avance de fichas representa tiempo transcurrido, no una evaluación de competencias.
- Los precios SaaS están por definir y ambos planes permanecen bloqueados.
- Los contactos son datos de demostración. Se conservaron las fotos y valores que ya estaban configurados en esta copia.
- La revisión visual usa fixtures aislados; no certifica permisos de cámara en todos los dispositivos ni entrega de correos reales.

## Verificación aislada

`npm test` cubre roles, aterrizaje en dashboard, sesión, transporte, recuperación, QR, calendario, progreso académico y generación de reportes PDF y Excel.

`npm run qa:preview` inicia `http://127.0.0.1:5176` con datos en memoria. Documentos de prueba: `admin-demo`, `instructor-demo`, `celador-demo`, `visitante-demo`. Clave exclusiva de QA: `demo-password-12`. Este servidor no reenvía solicitudes al backend real ni envía correos. Los fixtures y credenciales no se incluyen en `dist/`.

Para verificar el formulario de recuperación en QA: `/restablecer-contrasena#correo=demo%40example.com&token=` seguido de 64 letras `a`. El endpoint de cambio está deshabilitado en QA; el contrato de envío se prueba unitariamente.
