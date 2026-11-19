"""Firebase Cloud Messaging (HTTP v1): un solo envío al tema que comparten la app y la web."""

from .google import pedir_json, token_firebase


def enviar_alerta_sismo(config, alerta, sismo, distancia):
    cuenta = config.cuenta_firebase
    titulo = f"Sismo M{sismo.magnitud:.1f} · {sismo.lugar}"[:120]
    cuerpo = f"A {distancia:.0f} km de la sede. Agáchate, cúbrete y sujétate."
    datos = {
        "tipo": "SISMO",
        "id_alerta": str(alerta["id_alerta"]),
        "severidad": alerta["severidad"],
        "magnitud": f"{sismo.magnitud:.1f}",
        "lugar": sismo.lugar,
        "profundidad": ""
        if sismo.profundidad_km is None
        else f"{sismo.profundidad_km:.0f}",
        "lat": f"{sismo.latitud:.4f}",
        "lon": f"{sismo.longitud:.4f}",
        "distancia_km": f"{distancia:.0f}",
        "timestamp": sismo.ocurrido_en.isoformat(),
        "titulo": titulo,
        "mensaje": alerta["mensaje"],
    }
    mensaje = {
        "topic": config.FCM_TOPIC,
        "data": datos,
        # Solo datos en Android: la app publica la alerta en su canal crítico y a
        # pantalla completa; una notificación armada por el sistema no lo permite.
        "android": {"priority": "HIGH", "ttl": "600s"},
        "webpush": {
            "headers": {"Urgency": "high", "TTL": "600"},
            "notification": {
                "title": titulo,
                "body": cuerpo,
                "requireInteraction": True,
                "renotify": True,
                "tag": f"sismo-{alerta['id_alerta']}",
                "vibrate": [600, 200, 600, 200, 600],
                "icon": "/favicon-xentinel.png",
            },
            "fcm_options": {"link": f"{config.origenes[0]}/login"},
        },
    }
    pedir_json(
        f"{config.FCM_API_URL.rstrip('/')}/v1/projects/{cuenta['project_id']}/messages:send",
        cuerpo={"message": mensaje},
        token=token_firebase(cuenta),
    )


def suscribir_web(config, token_web):
    """Suscribe un token Web Push al tema (API de Instance ID, la que usa firebase-admin)."""
    respuesta = pedir_json(
        f"{config.FCM_IID_URL.rstrip('/')}/iid/v1:batchAdd",
        cuerpo={
            "to": f"/topics/{config.FCM_TOPIC}",
            "registration_tokens": [token_web],
        },
        token=token_firebase(config.cuenta_firebase),
        cabeceras={"access_token_auth": "true"},
    )
    resultado = (respuesta.get("results") or [{}])[0]
    if resultado.get("error"):
        raise ValueError(resultado["error"])
