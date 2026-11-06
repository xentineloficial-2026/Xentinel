/** Fechas locales para calendarios: no convierte fechas académicas a UTC ni desplaza el día. */
export /* DIAS_SEMANA: valor de trabajo utilizado en esta operación. */
const DIAS_SEMANA = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];
export function normalizarDia(valor) {
  /* texto: valor de trabajo utilizado en esta operación. */
  const texto = String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return DIAS_SEMANA.findIndex(
    (dia) =>
      dia
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase() === texto
  );
}
export function claveFechaLocal(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}
export function construirMes(fecha) {
  /* primero: instancia que se mantiene durante la operación y se libera cuando corresponde. */
  const primero = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  /* desplazamiento: valor de trabajo utilizado en esta operación. */
  const desplazamiento = (primero.getDay() + 6) % 7;
  /* inicio: instancia que se mantiene durante la operación y se libera cuando corresponde. */
  const inicio = new Date(primero);
  inicio.setDate(1 - desplazamiento);
  return Array.from(
    {
      length: 42,
    },
    (_, indice) =>
      new Date(
        inicio.getFullYear(),
        inicio.getMonth(),
        inicio.getDate() + indice
      )
  );
}
export function progresoFicha(inicio, fin, ahora = Date.now()) {
  /* desde: valor de trabajo utilizado en esta operación. */
  const desde = Date.parse(inicio);
  /* hasta: valor de trabajo utilizado en esta operación. */
  const hasta = Date.parse(fin);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde)
    return null;
  return Math.max(
    0,
    Math.min(100, Math.round(((ahora - desde) / (hasta - desde)) * 100))
  );
}
