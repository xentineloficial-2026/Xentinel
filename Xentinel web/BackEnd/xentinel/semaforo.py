"""Semáforo de Xentinel: un solo vocabulario de riesgo para la API, la web y la app.

- Rojo: crítico o alto. Exige actuar ya.
- Amarillo: advertencia o medio. Exige revisar.
- Verde: normal. Se registra, pero nunca aparece como alarma.
"""

ALARMA = ("rojo", "amarillo")
POR_SEVERIDAD = {
    "critica": "rojo",
    "alta": "rojo",
    "moderada": "amarillo",
    "informativa": "verde",
}


def de_severidad(severidad):
    """Una severidad desconocida nunca se rebaja a normal."""
    return POR_SEVERIDAD.get(severidad, "rojo")


def sql(columna="severidad"):
    """Expresión SQL equivalente a ``de_severidad`` para una columna de severidad."""
    return (
        f"CASE {columna} WHEN 'moderada' THEN 'amarillo' "
        f"WHEN 'informativa' THEN 'verde' ELSE 'rojo' END"
    )


# Filtro de las vistas de alarma: el verde (informativa) queda fuera.
SIN_VERDE = "severidad <> 'informativa'"
