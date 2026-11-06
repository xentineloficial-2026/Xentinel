/** Consulta cancelable. Publica datos, estado y actualizar sin filtrar detalles del transporte al componente. */
import {
  useCallback as useRetorno,
  useEffect as useEfecto,
  useState as useEstado,
} from 'react';
import { solicitar } from '../servicios/cliente.js';
export function useRecurso(ruta) {
  /* revision, cambiarRevision: estado de la vista y función para actualizarlo. */
  const [revision, cambiarRevision] = useEstado({ numero: 0, silenciosa: false }); // Fuerza una consulta nueva cuando la persona actualiza.
  const [resultado, cambiarResultado] = useEstado(null); // Respuesta vinculada a una ruta y revisión concretas.
  const clave = `${ruta}:${revision.numero}`;
  const silenciosa = revision.silenciosa;
  useEfecto(() => {
    if (!ruta) return;
    /* controlador: instancia que se mantiene durante la operación y se libera cuando corresponde. */
    const controlador = new AbortController();
    solicitar(ruta, {
      signal: controlador.signal,
    })
      .then((respuesta) => {
        if (!controlador.signal.aborted)
          cambiarResultado({
            clave,
            ruta,
            estado: 'listo',
            datos: respuesta.data,
            metadatos: respuesta.meta,
          });
      })
      .catch((error) => {
        if (controlador.signal.aborted) return;
        // Un fallo en segundo plano conserva la tabla visible; el canal volverá a intentarlo.
        cambiarResultado((anterior) =>
          silenciosa && anterior?.ruta === ruta && anterior.estado === 'listo'
            ? anterior
            : {
                clave,
                ruta,
                estado: 'error',
                error,
              }
        );
      });
    return () => controlador.abort();
  }, [ruta, clave, silenciosa]);
  /* actualizar: valor de trabajo utilizado en esta operación. */
  const actualizar = useRetorno(
    () =>
      cambiarRevision(({ numero }) => ({
        numero: numero + 1,
        silenciosa: false,
      })),
    []
  );
  /* refrescar: consulta en segundo plano, sin reemplazar la tabla por «Cargando…». */
  const refrescar = useRetorno(
    () =>
      cambiarRevision(({ numero }) => ({
        numero: numero + 1,
        silenciosa: true,
      })),
    []
  );
  const vigente =
    resultado?.clave === clave ||
    (silenciosa && resultado?.ruta === ruta && resultado?.estado === 'listo');
  return {
    ...(vigente
      ? resultado
      : {
          estado: ruta ? 'cargando' : 'inactivo',
          datos: null,
        }),
    actualizar,
    refrescar,
  };
}
