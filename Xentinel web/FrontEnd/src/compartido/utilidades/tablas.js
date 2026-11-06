/** Formato de fechas y paginación mediante parámetros de URL. */
import { useSearchParams as useParametrosBusqueda } from 'react-router-dom';
/* formatearFecha: operación local que atiende el evento o transforma la información. */
const formatearFecha = (valor) =>
  valor
    ? new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Bogota',
      }).format(new Date(valor))
    : '—';
export { formatearFecha };
function usePaginacion() {
  /* parametros, cambiarParametros: valor de trabajo utilizado en esta operación. */
  const [parametros, cambiarParametros] = useParametrosBusqueda();
  /* valorOriginal: valor de trabajo utilizado en esta operación. */
  const valorOriginal = Number(parametros.get('pagina') || 1);
  /* pagina: valor de trabajo utilizado en esta operación. */
  const pagina =
    Number.isInteger(valorOriginal) && valorOriginal > 0
      ? Math.min(valorOriginal, 4001)
      : 1;
  /* tamano: valor de trabajo utilizado en esta operación. */
  const tamano = 25;
  /* cambiarPagina: operación local que atiende el evento o transforma la información. */
  const cambiarPagina = (valor) =>
    cambiarParametros((actual) => {
      /* siguiente: instancia que se mantiene durante la operación y se libera cuando corresponde. */
      const siguiente = new URLSearchParams(actual);
      siguiente.set('pagina', String(valor));
      return siguiente;
    });
  return {
    pagina,
    tamano,
    consulta: `limit=${tamano}&offset=${(pagina - 1) * tamano}`,
    cambiarPagina,
  };
}
export { usePaginacion };
