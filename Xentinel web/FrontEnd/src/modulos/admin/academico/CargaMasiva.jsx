/** Carga masiva de personas: plantilla, revisión de cada fila antes de guardar y resumen. */
import { useState } from 'react';
import {
  CircleCheck as Valida,
  CircleAlert as ConError,
  FileSpreadsheet as Hoja,
} from 'lucide-react';
import { Dialogo } from '../../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../../compartido/componentes/MensajeEstado.jsx';
import { solicitar } from '../../../compartido/servicios/cliente.js';
import {
  descargarErrores,
  descargarPlantilla,
  leerArchivo,
  MAXIMO_FILAS,
} from './cargaMasiva.js';
import './academico.css';
import { plural, textoResumen } from './utilidades.js';

function TablaRevision({ filas }) {
  return (
    <div
      className="xn-tabla-desplazable xn-revision-tabla"
      tabIndex={0}
      aria-label="Revisión de las filas del archivo"
    >
      <table className="xn-datos-tabla">
        <thead>
          <tr>
            <th scope="col">Fila</th>
            <th scope="col">Estado</th>
            <th scope="col">Nombre</th>
            <th scope="col">Documento</th>
            <th scope="col">Correo</th>
            <th scope="col">Rol</th>
            <th scope="col">Ficha</th>
            <th scope="col">Observaciones</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.fila} data-error={!fila.valida || undefined}>
              <td className="xn-dato-id">{fila.fila + 1}</td>
              <td>
                {fila.valida ? (
                  <span className="xn-estado es-exito">
                    <Valida size={14} aria-hidden="true" /> Lista
                  </span>
                ) : (
                  <span className="xn-estado es-peligro">
                    <ConError size={14} aria-hidden="true" /> Con error
                  </span>
                )}
              </td>
              <td>{fila.datos.nombres_completos || '—'}</td>
              <td className="xn-dato-id">
                {fila.datos.tipo_documento} {fila.datos.numero_documento || '—'}
              </td>
              <td>{fila.datos.correo || '—'}</td>
              <td>{fila.datos.rol || '—'}</td>
              <td className="xn-dato-id">{fila.datos.numero_ficha || '—'}</td>
              <td>
                <ul className="xn-revision-notas">
                  {fila.errores.map((nota) => (
                    <li key={nota} className="es-error">
                      {nota}
                    </li>
                  ))}
                  {fila.avisos.map((nota) => (
                    <li key={nota}>{nota}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CargaMasiva({ ficha, alCerrar, alImportar }) {
  const [archivo, cambiarArchivo] = useState(null);
  const [filas, cambiarFilas] = useState(null);
  const [revision, cambiarRevision] = useState(null);
  const [resultado, cambiarResultado] = useState(null);
  const [soloErrores, cambiarSoloErrores] = useState(false);
  const [estado, cambiarEstado] = useState({});
  const [ocupado, cambiarOcupado] = useState(null);

  async function revisar(elegido) {
    cambiarArchivo(elegido);
    cambiarFilas(null);
    cambiarRevision(null);
    cambiarResultado(null);
    cambiarEstado({});
    if (!elegido) return;
    cambiarOcupado('revisando');
    try {
      const leidas = await leerArchivo(elegido, {
        numeroFicha: ficha?.numero_ficha,
      });
      const { data } = await solicitar('/usuarios/importar', {
        method: 'POST',
        body: { filas: leidas, simular: true },
      });
      cambiarFilas(leidas);
      cambiarRevision(data);
      cambiarSoloErrores(data.resumen.errores > 0 && data.resumen.validas > 20);
    } catch (error) {
      cambiarEstado({ error });
    } finally {
      cambiarOcupado(null);
    }
  }

  async function importar() {
    if (!filas || ocupado) return;
    cambiarOcupado('importando');
    cambiarEstado({});
    try {
      const { data } = await solicitar('/usuarios/importar', {
        method: 'POST',
        body: { filas, simular: false },
      });
      cambiarResultado({
        ...data,
        soloAprendices: revision.filas
          .filter((fila) => fila.valida)
          .every((fila) => fila.datos.rol === 'Aprendiz'),
      });
      cambiarRevision(null);
      alImportar?.(data.resumen);
    } catch (error) {
      cambiarEstado({ error });
    } finally {
      cambiarOcupado(null);
    }
  }

  async function plantilla(formato) {
    try {
      await descargarPlantilla(formato, ficha?.numero_ficha);
    } catch (error) {
      cambiarEstado({ error });
    }
  }

  const visibles = revision
    ? revision.filas.filter((fila) => !soloErrores || !fila.valida)
    : [];
  const resumen = revision?.resumen;

  return (
    <Dialogo
      titulo={
        ficha
          ? `Importar aprendices a la ficha ${ficha.numero_ficha}`
          : 'Carga masiva de personas'
      }
      alCerrar={alCerrar}
      ocupado={!!ocupado}
    >
      <div className="xn-carga">
        {resultado ? (
          <section className="xn-carga-resultado" role="status">
            <Valida size={36} aria-hidden="true" />
            <div>
              <h3>
                {textoResumen(resultado.resumen, resultado.soloAprendices)}.
              </h3>
              {resultado.resumen.fichas_creadas > 0 && (
                <p>
                  {resultado.resumen.fichas_creadas === 1
                    ? 'Se creó'
                    : 'Se crearon'}{' '}
                  {plural(
                    resultado.resumen.fichas_creadas,
                    'ficha nueva',
                    'fichas nuevas'
                  )}
                  .
                </p>
              )}
              <p>
                Cada persona crea su contraseña en «¿Olvidaste tu contraseña?»
                con el código que llega a su correo. Mientras tanto, el celador
                puede registrarla con su documento.
              </p>
              {resultado.filas.length > 0 && (
                <button
                  type="button"
                  className="xn-boton xn-boton--secundario"
                  onClick={() => descargarErrores(resultado.filas)}
                >
                  Descargar filas omitidas
                </button>
              )}
            </div>
          </section>
        ) : (
          <ol className="xn-carga-pasos">
            <li>
              <h3>Descarga la plantilla</h3>
              <p>
                Llena una fila por persona. Obligatorias: nombre, número de
                documento y correo.{' '}
                {ficha
                  ? `Si dejas vacía la ficha, se usa la ${ficha.numero_ficha}.`
                  : 'Para vincular aprendices, escribe el número de su ficha.'}
              </p>
              <div className="xn-admin-acciones">
                <button
                  type="button"
                  className="xn-boton xn-boton--secundario"
                  onClick={() => plantilla('xlsx')}
                >
                  Plantilla Excel (.xlsx)
                </button>
                <button
                  type="button"
                  className="xn-boton xn-boton--secundario"
                  onClick={() => plantilla('csv')}
                >
                  Plantilla CSV
                </button>
              </div>
            </li>
            <li>
              <h3>Sube el archivo</h3>
              <label className="xn-carga-archivo" data-ocupado={!!ocupado}>
                <Hoja size={26} aria-hidden="true" />
                <span>
                  <strong>
                    {archivo ? archivo.name : 'Elige un archivo .xlsx o .csv'}
                  </strong>
                  {ocupado === 'revisando'
                    ? 'Revisando cada fila…'
                    : `Hasta ${MAXIMO_FILAS} filas. Nada se guarda hasta que confirmes.`}
                </span>
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={!!ocupado}
                  onChange={(evento) =>
                    revisar(evento.target.files?.[0] ?? null)
                  }
                />
              </label>
            </li>
            <li>
              <h3>Revisa y confirma</h3>
              {resumen ? (
                <>
                  <p className="xn-carga-cifras">
                    <span className="es-exito">
                      {plural(resumen.validas, 'fila lista', 'filas listas')}
                    </span>
                    <span className={resumen.errores ? 'es-peligro' : ''}>
                      {plural(
                        resumen.errores,
                        'fila con errores',
                        'filas con errores'
                      )}
                    </span>
                    <span>
                      {plural(resumen.fichas, 'ficha', 'fichas')}
                      {resumen.fichas_nuevas > 0 &&
                        ` (${plural(resumen.fichas_nuevas, 'nueva', 'nuevas')})`}
                    </span>
                  </p>
                  {resumen.errores > 0 && (
                    <label className="xn-confirmacion">
                      <input
                        type="checkbox"
                        checked={soloErrores}
                        onChange={(evento) =>
                          cambiarSoloErrores(evento.target.checked)
                        }
                      />
                      Mostrar solo las filas con errores
                    </label>
                  )}
                  <TablaRevision filas={visibles} />
                  {resumen.errores > 0 && (
                    <p className="xn-ayuda">
                      Las filas con errores se omiten. Corrígelas en el archivo
                      y vuelve a subirlo, o importa ahora las que están listas.
                    </p>
                  )}
                </>
              ) : (
                <p>Verás cada fila con sus errores antes de guardar.</p>
              )}
            </li>
          </ol>
        )}
      </div>
      <MensajeEstado {...estado} />
      <div className="xn-dialogo-acciones">
        <button
          type="button"
          className="xn-boton xn-boton--secundario"
          disabled={!!ocupado}
          onClick={alCerrar}
        >
          {resultado ? 'Cerrar' : 'Cancelar'}
        </button>
        {!resultado && (
          <button
            type="button"
            className="xn-boton"
            disabled={!!ocupado || !resumen?.validas}
            onClick={importar}
          >
            {ocupado === 'importando'
              ? 'Importando…'
              : resumen?.validas
                ? `Importar ${plural(resumen.validas, 'persona', 'personas')}`
                : 'Importar'}
          </button>
        )}
      </div>
    </Dialogo>
  );
}
