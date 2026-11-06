/** Mensajes persistentes y accesibles; los errores del servidor se muestran sin trazas técnicas. */
function MensajeEstado({ error, mensaje }) {
  if (!error && !mensaje) return null;
  return (
    <div
      className={
        error ? 'xn-mensaje xn-mensaje--error' : 'xn-mensaje xn-mensaje--exito'
      }
      role={error ? 'alert' : 'status'}
    >
      {error?.message || error || mensaje}
      {error?.fields?.length > 0 && (
        <ul>
          {error.fields.map((campo) => (
            <li key={campo.path}>
              {campo.path}: {campo.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export { MensajeEstado };
function EstadoConsulta({ recurso, children: contenido }) {
  if (recurso.estado === 'cargando')
    return (
      <div className="xn-consulta-estado" role="status">
        Cargando información…
      </div>
    );
  if (recurso.estado === 'error')
    return (
      <div className="xn-consulta-estado">
        <MensajeEstado error={recurso.error} />
        <button
          className="xn-boton xn-boton--secundario"
          onClick={recurso.actualizar}
        >
          Reintentar
        </button>
      </div>
    );
  return contenido;
}
export { EstadoConsulta };
