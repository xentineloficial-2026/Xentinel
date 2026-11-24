# Gestión de riesgos y alarmas

Cómo decide Xentinel qué es una alarma, cómo llega a la web y a la app, y cómo probarlo de punta a punta sin esperar un sismo real.

## 1. Qué es una alarma

Las alarmas reaccionan a **dos casos y a nada más**, y solo muestran dos colores del semáforo:

| Color | Significado | Riesgos críticos | Escaneo de carnets |
| --- | --- | --- | --- |
| Rojo | Crítico o alto: actúa ahora | Severidad `critica` o `alta` | `QR_INVALIDO`: el código no es verídico (firma falsa, carnet revocado, captura de otro teléfono o un QR que no es de Xentinel) |
| Amarillo | Advertencia o medio: revisa pronto | Severidad `moderada` | `QR_VENCIDO`: carnet auténtico, pero vencido al escanearlo |
| Verde | Normal | Severidad `informativa`: se registra, **nunca** se muestra como alarma | — |

La traducción severidad → color vive en un solo lugar (`xentinel/semaforo.py`) y la web (`PanelAlertas.jsx`) y la app (`lib/models/scan_alarm.dart`) usan el mismo vocabulario.

## 2. Flujo interno

```text
 EMSC (WebSocket, segundos) ─┐
 USGS (consulta cada 30 s) ──┼─▶ sismos.registrar()
 POST /riesgos/simular ──────┘      │
                                    ├─ fuera del radio o bajo la magnitud mínima → se descarta
                                    ├─ evaluar(): distancia (Haversine) + magnitud → severidad → semáforo
                                    ├─ verde → se guarda en sismos_detectados SIN alerta ni push
                                    └─ rojo/amarillo → alertas_emergencia (+ FCM si hay Firebase)
                                                         │
 Administración: POST /alertas (moderada/alta/critica) ──┤
                                                         ▼
                                   api_events (disparador) ─▶ WebSocket / SSE
                                                         │
 POST /ingresos con QR vencido o falso ─▶ alarmas_qr ────┤   (transacción aparte: la alarma queda
 POST /alarmas/qr (QR ajeno leído en la app) ─▶ alarmas_qr    aunque el movimiento se rechace)
                                                         ▼
                              GET /alarmas: rojo primero, luego amarillo, sin verdes
                                                         │
             ┌───────────────────────────────────────────┴──────────────────────────────┐
             ▼                                                                          ▼
 Web: semáforo + tarjetas, franja «carnets QR por revisar»       App: semáforo en Inicio y Alarmas,
 e interrupción a pantalla completa (rojo/amarillo de riesgo)    interrupción a pantalla completa
```

**Reglas del semáforo sísmico** (centro en la sede, `SEISMIC_LAT`/`SEISMIC_LON`):

| Severidad | Color | Condición |
| --- | --- | --- |
| `critica` | Rojo | M ≥ 6 a 200 km o menos, o M ≥ 7 a 500 km o menos |
| `alta` | Rojo | M ≥ 5 a 200 km o menos, o M ≥ 6 a 500 km o menos |
| `moderada` | Amarillo | M ≥ 4 a 100 km o menos, o M ≥ 5 a 500 km o menos |
| `informativa` | Verde | Cualquier otro sismo dentro del radio |

Antes de evaluar se descartan los sismos fuera de `SEISMIC_RADIUS_KM` (500 km), bajo `SEISMIC_MIN_MAGNITUDE` (4.0) o más antiguos que `SEISMIC_MAX_AGE_MINUTES` (30). Si EMSC y USGS informan el mismo sismo (menos de 2 minutos y 50 km de diferencia) sale una sola alerta. Las alertas automáticas se cierran solas a los `SEISMIC_ALERT_MINUTES` (30) mientras el monitor esté activo.

**Escaneo de carnets.** `POST /ingresos` verifica la firma del carnet XN2 y su vigencia (±45 s). Si falla, la transacción del movimiento se revierte y la alarma se guarda en otra transacción, con:

- `semaforo` y `motivo` (`QR_INVALIDO` rojo, `QR_VENCIDO` amarillo);
- `id_usuarios` solo si la firma es auténtica (vencido); en uno falso, `id_reclamado` es lo que el código dice ser, sin verificar;
- `huella` SHA-256 del contenido leído: el código nunca se guarda y las lecturas repetidas en 2 minutos son una sola alarma;
- quién escaneó y si era entrada o salida.

La app reporta además con `POST /alarmas/qr` los códigos que rechaza sin ir al registro (un QR que no es de Xentinel o un carnet heredado vencido). El celador o administración la marcan como revisada con `PATCH /alarmas/qr/{id}/atender`.

**Quién ve qué.** Todas las personas ven los riesgos. Solo Celador y Administrador ven las alarmas de escaneo (`meta.incluye_qr`), también por el canal en tiempo real (recurso `alarmas_qr`).

## 3. Probarlo

### 3.1 Preparación

Local: `python -m xentinel servir` y abre `http://127.0.0.1:8000/docs`. En la nube: `https://xentinel-api.onrender.com/docs` (la primera petición despierta el plan gratis en cerca de un minuto). Todas las rutas de `/riesgos` piden una sesión de **Administrador**.

En Swagger: `POST /api/v1/auth/login` con `{"documento":"…","contrasena":"…"}`, copia `data.access_token`, pulsa **Authorize** y pégalo.

En Postman: importa [`xentinel-riesgos.postman_collection.json`](xentinel-riesgos.postman_collection.json), define las variables `base`, `documento` y `contrasena`, y ejecuta **1. Iniciar sesión**: guarda el token solo en la variable `token`.

Con curl (Git Bash o PowerShell con `curl.exe`):

```bash
B=http://127.0.0.1:8000/api/v1
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"documento":"TU_DOCUMENTO","contrasena":"TU_CONTRASEÑA"}' \
  | python -c "import json,sys;print(json.load(sys.stdin)['data']['access_token'])")
```

### 3.2 Ver las reglas vigentes

`GET /riesgos/configuracion` devuelve la sede, el radio, la magnitud mínima, si el monitor está activo y la tabla del semáforo.

### 3.3 Evaluar sin efectos

`POST /riesgos/evaluar` no guarda ni notifica nada. Casos de referencia con la sede en Bogotá (respuestas reales de esta versión):

| Cuerpo | Resultado |
| --- | --- |
| `{"magnitud":6.2,"latitud":4.5,"longitud":-74.2}` | 17,9 km, `critica`, **rojo**, `genera_alarma: true` |
| `{"magnitud":5.4,"latitud":4.5,"longitud":-74.2}` | `alta`, **rojo** |
| `{"magnitud":4.3,"latitud":4.9,"longitud":-74.3}` | `moderada`, **amarillo** |
| `{"magnitud":4.2,"latitud":6.5,"longitud":-75.5}` | 262,3 km, `informativa`, **verde**, `genera_alarma: false`, motivo «Riesgo normal (verde)…» |
| `{"magnitud":7,"latitud":-33.4,"longitud":-70.6}` | 4 242 km, fuera del radio, no genera alarma |

```bash
curl -s -X POST $B/riesgos/evaluar -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"magnitud":6.2,"latitud":4.5,"longitud":-74.2}'
```

```json
{"data":{"distancia_km":17.9,"severidad":"critica","semaforo":"rojo","dentro_del_radio":true,"genera_alarma":true,"motivo":null}}
```

### 3.4 Simulacro de punta a punta

**Avisa antes a la comunidad:** un simulacro rojo o amarillo interrumpe la web y la app de todas las personas con sesión abierta, a pantalla completa y con sirena, marcado como «Simulacro».

```bash
curl -s -X POST $B/riesgos/simular -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"magnitud":5.4,"latitud":4.5,"longitud":-74.2,"lugar":"Simulacro de evacuación"}'
```

Respuesta (resumida): `evaluacion.semaforo: "rojo"` y una `alerta` con `tipo_alerta: "Sismo"`, `fuente: "PRUEBA"`, `semaforo: "rojo"` y un mensaje que empieza por «SIMULACRO.». Con `"notificar": true` y Firebase configurado también sale la notificación push a teléfonos y navegadores cerrados.

Qué se ve:

1. **Web** (cualquier rol con sesión): la pantalla cambia a rojo con «Alerta roja (alta)», el aviso «Simulacro. No es una emergencia real.», la sirena y los botones «Entendido» y «Necesito ayuda». Al atenderla queda la franja roja arriba y, en **Alarmas**, el semáforo con la luz roja encendida y la tarjeta «Sismo» con «Simulacro de la API de gestión de riesgos».
2. **App**: la misma interrupción a pantalla completa; en **Inicio**, la tarjeta de alarmas muestra la luz roja y «1 alarma activa».
3. `GET /alarmas` la lista primero, con `meta.conteo.rojo = 1`; `GET /riesgos/sismos` muestra el sismo con `fuente: "PRUEBA"`.

Para terminar: `PATCH /alertas/{id_alerta}/cerrar` (o «Cerrar alerta» en la web de administración). Repite con `{"magnitud":4.2,"latitud":6.5,"longitud":-75.5}`: la respuesta trae `alerta: null`, nadie recibe nada y el sismo verde queda en `GET /riesgos/sismos` sin alerta.

### 3.5 Alarmas por escaneo de carnets

Con la app en un teléfono de Celador (escáner) y otra persona con su carnet:

1. **Vencido (amarillo):** toma una captura del carnet, espera 1 minuto y escanéala. El escáner muestra «QR vencido…». En la web, el celador y administración ven la franja «1 carnet QR por revisar» y, en **Alarmas**, la tarjeta amarilla «Carnet QR vencido» con el titular.
2. **No verídico (rojo):** cierra sesión en el teléfono del titular y escanea una captura anterior (el carnet queda revocado), o escanea cualquier QR ajeno a Xentinel. Aparece la tarjeta roja «Carnet QR no verídico» con «El código dice ser ID …».
3. Pulsa **Marcar como revisada** (web o app): sale de pendientes al instante en ambas.

Sin teléfonos, con curl (como Celador o Administrador):

```bash
curl -s -X POST $B/alarmas/qr -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"motivo":"QR_INVALIDO","contenido":"https://example.org/promo","tipo":"ENTRADA"}'
curl -s "$B/alarmas?semaforo=rojo" -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH $B/alarmas/qr/1/atender -H "Authorization: Bearer $TOKEN"
```

La primera responde 201; repetirla antes de 2 minutos responde 200 con la misma alarma. Un aprendiz recibe 403.

### 3.6 Verde fuera de las alarmas

Una alerta `informativa` creada a mano no aparece en `GET /alertas/activas`, `GET /alertas` ni `GET /alarmas`, y no interrumpe a nadie. El formulario «Nueva alerta» de la web ya solo ofrece «Amarillo: advertencia», «Rojo: riesgo alto» y «Rojo: crítico».

### 3.7 Pruebas automáticas

`npm test` en `Xentinel web/BackEnd` (con `TEST_DATABASE_URL`) incluye:

- «alarmas: QR vencido en amarillo, QR no verídico en rojo, riesgos sin verde y atención»;
- «gestión de riesgos: evaluación sin efectos, simulacro hasta la alerta y permisos»;
- «monitor sísmico: EMSC y USGS crean una sola alerta…», con servidores EMSC, USGS y FCM simulados.

En la app, `flutter test` cubre el semáforo, la revisión de alarmas QR y el reporte de QR ajenos.

## 4. Si algo no aparece

| Síntoma | Causa probable |
| --- | --- |
| `GET /riesgos/configuracion` dice `monitor_activo: false` | `SEISMIC_ENABLED` no es `true`. El simulacro funciona igual. |
| El simulacro responde `alerta: null` | El evento es verde, está fuera del radio o bajo la magnitud mínima: lee `evaluacion.motivo`. |
| La web no muestra la interrupción | La persona ya la atendió en esta pestaña (se recuerda por sesión del navegador) o la alerta es verde. |
| El celador no ve alarmas QR | Su rol no es Celador/Administrador, o la alarma ya fue revisada. |
| No llega el push | Falta `FIREBASE_SERVICE_ACCOUNT` en la API o `google-services.json` en la app; el canal en vivo funciona sin Firebase. |
