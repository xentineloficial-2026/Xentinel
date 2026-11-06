/** Tabla semántica con paginación del servidor. No inventa un total que la API no devuelve. */
function TablaDatos({
  columnas,
  filas = [],
  claveFila,
  vacio = 'No hay registros para mostrar.',
}) {
  return (
    <div
      className="xn-tabla-desplazable"
      tabIndex={0}
      aria-label="Tabla de resultados"
    >
      <table className="xn-datos-tabla">
        <thead>
          <tr>
            {columnas.map((columna) => (
              <th key={columna.clave} scope="col">
                {columna.etiqueta}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.length ? (
            filas.map((fila) => (
              <tr key={fila[claveFila]}>
                {columnas.map((columna) => (
                  <td key={columna.clave}>
                    {columna.representar
                      ? columna.representar(fila)
                      : (fila[columna.clave] ?? '—')}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="xn-tabla-vacio" colSpan={columnas.length}>
                {vacio}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export { TablaDatos };
function Paginacion({ paginacion, cantidad, total }) {
  return (
    <nav className="xn-paginacion" aria-label="Paginación">
      <span>
        Página {paginacion.pagina} · {cantidad} registros
      </span>
      <div>
        <button
          disabled={paginacion.pagina === 1}
          onClick={() => paginacion.cambiarPagina(paginacion.pagina - 1)}
        >
          Anterior
        </button>
        <button
          disabled={
            (total == null
              ? cantidad < paginacion.tamano
              : paginacion.pagina * paginacion.tamano >= total) ||
            paginacion.pagina >= 4001
          }
          onClick={() => paginacion.cambiarPagina(paginacion.pagina + 1)}
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}
export { Paginacion };
