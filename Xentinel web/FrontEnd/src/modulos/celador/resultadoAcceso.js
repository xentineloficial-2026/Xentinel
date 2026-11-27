/** Traduce la respuesta del registro de acceso al mensaje del punto de control. */
const formatoHora = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  hour: 'numeric',
  minute: '2-digit',
});

export function horaLegible(instante) {
  return instante ? formatoHora.format(new Date(instante)) : '';
}

/** Movimiento guardado: permitido (asistencia registrada) o denegado con su motivo. */
export function resultadoRegistro(datos) {
  const persona = datos.persona ?? {};
  const base = {
    persona,
    hora: horaLegible(datos.fechahora),
    tipo: datos.tipo,
  };
  if (datos.estado !== 'Permitido') {
    const inactivo = datos.motivo?.codigo !== 'APRENDIZ_RETIRADO';
    return {
      ...base,
      variante: 'rechazo',
      tono: 'error',
      titulo: inactivo ? 'Usuario inactivo' : 'Aprendiz retirado',
      detalle: inactivo
        ? 'La cuenta está desactivada. No ingresa a la sede; consulta con administración.'
        : 'Está retirado o desertado de la formación. No ingresa a la sede.',
    };
  }
  const salida = datos.tipo === 'SALIDA';
  const estado = datos.asistencia?.estado;
  return {
    ...base,
    variante: salida ? 'salida' : 'entrada',
    tono: salida ? 'salida' : 'entrada',
    titulo: salida
      ? 'Salida registrada con éxito'
      : 'Asistencia registrada con éxito',
    detalle: salida
      ? `Salida a las ${base.hora}. ¡Hasta pronto!`
      : `Entrada a las ${base.hora}${estado ? ` · ${estado}` : ''}. ¡Bienvenido!`,
  };
}

/** Rechazo del servidor o de la red, con la acción que corresponde. */
export function resultadoError(error, tipo) {
  const codigo = error?.code;
  const tabla = {
    NOT_FOUND: [
      'Usuario no encontrado',
      'El código o el documento no corresponde a ninguna persona registrada.',
      'error',
    ],
    INVALID_QR: [
      'Carnet no válido',
      'El código no es un carnet de Xentinel o fue revocado. Verifica el documento de identidad: quedó una alarma roja.',
      'error',
    ],
    QR_EXPIRED: [
      'Carnet vencido',
      'Pide a la persona que abra de nuevo su código QR y escanéalo otra vez.',
      'aviso',
    ],
    QR_UNSIGNED: [
      'Carnet sin firma',
      'Este punto exige el código QR que muestra la app o la web de Xentinel.',
      'aviso',
    ],
    ACCESS_SEQUENCE:
      tipo === 'SALIDA'
        ? [
            'No tiene una entrada registrada',
            'Cambia el movimiento a Entrada y escanea de nuevo.',
            'aviso',
          ]
        : [
            'Ya tiene una entrada registrada',
            'Cambia el movimiento a Salida y escanea de nuevo.',
            'aviso',
          ],
  };
  const [titulo, detalle, tono] = tabla[codigo] ?? [
    error?.status
      ? 'No se registró el movimiento'
      : 'Sin conexión con el servidor',
    error?.message ||
      'Revisa la conexión y vuelve a intentarlo: el mismo registro no se duplica.',
    'aviso',
  ];
  return {
    variante: tono === 'error' ? 'rechazo' : 'aviso',
    tono,
    titulo,
    detalle,
    tipo,
  };
}
