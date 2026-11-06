# Verificación del rediseño · 23 de octubre de 2026

Comprobaciones sobre el frontend local. La revisión de interfaz utilizó el servidor aislado `tests/vista-previa.mjs`; no modificó cuentas ni alertas de una base de datos real.

| Comprobación | Resultado |
| --- | --- |
| `npm run build` | Correcto; advertencias de tamaño en las bibliotecas diferidas Three.js/HLS |
| `npm run lint` | Correcto, sin errores |
| `npm test` | 20 pruebas aprobadas |
| `npm run auditar` | 51 archivos con comentarios e imports locales resueltos |
| Login por rol | Administración, instructor, celador y visitante llegan a su dashboard |
| Logout | Regresa al formulario de inicio de sesión |
| Estadísticas compartidas | Misma composición para administración e instructores |
| Calendario y fichas | Semana de clases, tarjetas y consulta mensual disponibles |
| Alertas | Publicación y cierre confirmados en QA; avisos activos se actualizan |
| Acceso manual | Registro confirmado después de verificar identidad en QA |
| Código QR | Generación visible; contratos de contenido y rechazo de códigos ajenos aprobados |
| Contactos | Exactamente cinco tarjetas; fotos activas 1.jpg, 5.jpg y 6.jpg |
| Servicios | Dos planes bloqueados; selección anual actualiza el estado accesible |
| Tema | Fondo negro confirmado en modo oscuro; preferencia compartida con descarga |
| Recuperación | Sin enlace: no muestra formulario. Con enlace válido de QA: muestra formulario y limpia URL |
| Enlace nuevo en la misma pestaña | Descarta la verificación anterior y vuelve a consultar al servidor |
| Three.js | Un lienzo WebGL, video original de 1280×720 en estado listo y reproducción manual confirmada |
| Movimiento reducido | Se respetó la preferencia del sistema; reproducción por acción explícita |
| Adaptación | Revisión de menú lateral móvil a 390 px y composición de escritorio a 1280 px |
| Descarga Android | Se conserva `available: false`; muestra disponibilidad pendiente sin inventar enlace |

El uso físico de cámara, la entrega de correo SMTP y los contratos del backend real requieren validación con el despliegue correspondiente. La API actual no ofrece emisión/verificación de QR firmados ni edición académica. El QR de esta versión es un identificador; la persona operadora comprueba la identidad y el servidor decide el registro de acceso.

La limpieza retiró utilidades de migración, plantillas y recursos sin referencias. Las fotos activas y el manifiesto de publicación se conservaron. Se verificaron hashes de los respaldos antes de retirar archivos:

- `C:/Users/kevin/.codex/visualizations/2026/10/21/01a15c26-cbc3-7053-9662-baa2abead1f8/xentinel-antes-redisenio.zip`
- `C:/Users/kevin/.codex/visualizations/2026/10/21/01a15c26-cbc3-7053-9662-baa2abead1f8/xentinel-archivos-sin-uso.zip`

La captura `dashboard-xentinel-final.png` en esa misma carpeta utiliza datos de demostración.
