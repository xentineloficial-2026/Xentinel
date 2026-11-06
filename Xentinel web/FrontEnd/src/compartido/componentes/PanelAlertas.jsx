/** Emergencias conectadas al API: publicación/cierre por administración, pase de lista y SOS voluntario. */
import { useRef as useReferencia, useState as useEstado } from 'react';
import { useAutenticacion } from '../contextos/autenticacion.js';
import { rolParaUsuario } from '../../configuracion/navegacion.js';
import { useRecurso } from '../ganchos/useRecurso.js';
import { solicitar } from '../servicios/cliente.js';
import { Dialogo } from './Dialogo.jsx';
import { MensajeEstado, EstadoConsulta } from './MensajeEstado.jsx';
import { TablaDatos, Paginacion } from './TablaDatos.jsx';
import { formatearFecha, usePaginacion } from '../utilidades/tablas.js';
function EditorAlerta({ alCerrar, alGuardar }) {
  /* formulario, cambiarFormulario: estado de la vista y función para actualizarlo. */
  const [formulario, cambiarFormulario] = useEstado({
    tipo_alerta: 'Simulacro',
    mensaje: '',
    severidad: 'informativa',
  });
  /* error, cambiarError: estado de la vista y función para actualizarlo. */
  const [error, cambiarError] = useEstado(null);
  /* guardando, cambiarGuardando: estado de la vista y función para actualizarlo. */
  const [guardando, cambiarGuardando] = useEstado(false);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    if (formulario.mensaje.trim().length < 5) {
      cambiarError('Escribe un mensaje claro de al menos 5 caracteres.');
      document.getElementById('alert-message').focus();
      return;
    }
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarError(null);
    try {
      await solicitar('/alertas', {
        method: 'POST',
        body: formulario,
      });
      alGuardar();
    } catch (motivo) {
      cambiarError(motivo);
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  return (
    <Dialogo
      titulo="Publicar alerta institucional"
      alCerrar={alCerrar}
      ocupado={guardando}
    >
      <p>
        Esta alerta será visible para toda la comunidad. Revisa el mensaje antes
        de publicarla.
      </p>
      <form noValidate onSubmit={enviar}>
        <div className="xn-formulario-cuadricula">
          <div className="xn-campo">
            <label htmlFor="alert-type">Tipo de alerta</label>
            <select
              id="alert-type"
              value={formulario.tipo_alerta}
              onChange={(evento) =>
                cambiarFormulario({
                  ...formulario,
                  tipo_alerta: evento.target.value,
                })
              }
            >
              {[
                'Sismo',
                'Meteorológica',
                'Evacuación',
                'Incendio',
                'Simulacro',
                'Otra',
              ].map((tipo) => (
                <option key={tipo}>{tipo}</option>
              ))}
            </select>
          </div>
          <div className="xn-campo">
            <label htmlFor="alert-severity">Severidad</label>
            <select
              id="alert-severity"
              value={formulario.severidad}
              onChange={(evento) =>
                cambiarFormulario({
                  ...formulario,
                  severidad: evento.target.value,
                })
              }
            >
              {['informativa', 'moderada', 'alta', 'critica'].map((tipo) => (
                <option key={tipo}>{tipo}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="xn-campo">
          <label htmlFor="alert-message">Instrucciones para la comunidad</label>
          <textarea
            id="alert-message"
            rows={5}
            maxLength={5000}
            value={formulario.mensaje}
            onChange={(evento) =>
              cambiarFormulario({
                ...formulario,
                mensaje: evento.target.value,
              })
            }
          />
        </div>
        <MensajeEstado error={error} />
        <div className="xn-dialogo-acciones">
          <button
            type="button"
            data-initial-focus
            className="xn-boton xn-boton--secundario"
            onClick={alCerrar}
            disabled={guardando}
          >
            Cancelar
          </button>
          <button className="xn-boton xn-boton--peligro" disabled={guardando}>
            {guardando ? 'Publicando…' : 'Publicar alerta'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
function ReporteAsistencia({ alerta, alCerrar, alGuardar }) {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useAutenticacion();
  /* fichas: consulta cancelable al servidor, con datos, estado y reintento. */
  const fichas = useRecurso(`/usuarios/${usuario.id_usuarios}/fichas`);
  /* ficha, cambiarFicha: estado de la vista y función para actualizarlo. */
  const [ficha, cambiarFicha] = useEstado('');
  /* estudiantes, cambiarEstudiantes: estado de la vista y función para actualizarlo. */
  const [estudiantes, cambiarEstudiantes] = useEstado([
    {
      clave: 0,
      id: '',
      presente: true,
    },
  ]);
  /* siguienteClave: referencia estable entre renderizados, sin disparar una actualización visual. */
  const siguienteClave = useReferencia(1);
  /* observaciones, cambiarObservaciones: estado de la vista y función para actualizarlo. */
  const [observaciones, cambiarObservaciones] = useEstado('');
  /* error, cambiarError: estado de la vista y función para actualizarlo. */
  const [error, cambiarError] = useEstado(null);
  /* guardando, cambiarGuardando: estado de la vista y función para actualizarlo. */
  const [guardando, cambiarGuardando] = useEstado(false);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    /* identificadores: valor de trabajo utilizado en esta operación. */
    const identificadores = estudiantes.map((estudiante) =>
      Number(estudiante.id)
    );
    if (
      !ficha ||
      identificadores.some(
        (identificador) => !Number.isInteger(identificador) || identificador < 1
      ) ||
      new Set(identificadores).size !== identificadores.length
    ) {
      cambiarError(
        'Selecciona tu ficha e ingresa IDs válidos, sin repetir aprendices.'
      );
      return;
    }
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarError(null);
    try {
      await solicitar('/alertas/reportes', {
        method: 'POST',
        body: {
          id_alerta: alerta.id_alerta,
          id_ficha: Number(ficha),
          observaciones,
          estudiantes: estudiantes.map((estudiante) => ({
            id_usuarios: Number(estudiante.id),
            presente: estudiante.presente,
          })),
        },
      });
      alGuardar();
    } catch (motivo) {
      cambiarError(motivo);
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  return (
    <Dialogo
      titulo="Enviar pase de lista"
      alCerrar={alCerrar}
      ocupado={guardando}
    >
      <p>
        Indica los aprendices que verificaste. El servidor comprueba que
        pertenezcan a tu ficha.
      </p>
      <form noValidate onSubmit={enviar}>
        <div className="xn-campo">
          <label htmlFor="report-group">Mi ficha</label>
          <select
            id="report-group"
            value={ficha}
            onChange={(evento) => cambiarFicha(evento.target.value)}
          >
            <option value="">Seleccionar ficha</option>
            {fichas.datos?.map((elemento) => (
              <option value={elemento.id_ficha} key={elemento.id_ficha}>
                {elemento.numero_ficha} · {elemento.nombre_programa}
              </option>
            ))}
          </select>
        </div>
        {fichas.estado === 'error' && <MensajeEstado error={fichas.error} />}
        <div className="xn-lista">
          {estudiantes.map((estudiante, indice) => (
            <div className="xn-lista-fila" key={estudiante.clave}>
              <div className="xn-campo">
                <label htmlFor={`student-${estudiante.clave}`}>
                  ID del aprendiz {indice + 1}
                </label>
                <input
                  id={`student-${estudiante.clave}`}
                  inputMode="numeric"
                  value={estudiante.id}
                  onChange={(evento) =>
                    cambiarEstudiantes((filas) =>
                      filas.map((elemento) =>
                        elemento.clave === estudiante.clave
                          ? {
                              ...elemento,
                              id: evento.target.value,
                            }
                          : elemento
                      )
                    )
                  }
                />
              </div>
              <label className="xn-confirmacion">
                <input
                  type="checkbox"
                  checked={estudiante.presente}
                  onChange={(evento) =>
                    cambiarEstudiantes((filas) =>
                      filas.map((elemento) =>
                        elemento.clave === estudiante.clave
                          ? {
                              ...elemento,
                              presente: evento.target.checked,
                            }
                          : elemento
                      )
                    )
                  }
                />
                Presente
              </label>
              <button
                type="button"
                className="xn-enlace-boton"
                aria-label={`Quitar aprendiz ${indice + 1}`}
                disabled={estudiantes.length === 1}
                onClick={() =>
                  cambiarEstudiantes((filas) =>
                    filas.filter(
                      (elemento) => elemento.clave !== estudiante.clave
                    )
                  )
                }
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="xn-texto-enlace xn-enlace-boton"
          disabled={estudiantes.length >= 500}
          onClick={() =>
            cambiarEstudiantes((filas) => [
              ...filas,
              {
                clave: siguienteClave.current++,
                id: '',
                presente: true,
              },
            ])
          }
        >
          Agregar aprendiz
        </button>
        <div className="xn-campo">
          <label htmlFor="report-notes">Observaciones</label>
          <textarea
            id="report-notes"
            rows={3}
            maxLength={5000}
            value={observaciones}
            onChange={(evento) => cambiarObservaciones(evento.target.value)}
          />
        </div>
        <MensajeEstado error={error} />
        <div className="xn-dialogo-acciones">
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            onClick={alCerrar}
            disabled={guardando}
          >
            Cancelar
          </button>
          <button
            className="xn-boton"
            disabled={guardando || fichas.estado !== 'listo'}
          >
            {guardando ? 'Enviando…' : 'Enviar pase de lista'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
function RegistrosAlerta({ alerta, tipo, alCerrar }) {
  /* pagina, cambiarPagina: estado de la vista y función para actualizarlo. */
  const [pagina, cambiarPagina] = useEstado(1);
  /* recurso: consulta cancelable al servidor, con datos, estado y reintento. */
  const recurso = useRecurso(
    `/alertas/${alerta.id_alerta}/${tipo}?limit=25&offset=${(pagina - 1) * 25}`
  );
  /* columnas: valor de trabajo utilizado en esta operación. */
  const columnas =
    tipo === 'sos'
      ? [
          {
            clave: 'id_aprendiz',
            etiqueta: 'Usuario',
          },
          {
            clave: 'latitud',
            etiqueta: 'Latitud',
          },
          {
            clave: 'longitud',
            etiqueta: 'Longitud',
          },
        ]
      : [
          {
            clave: 'id_instructor',
            etiqueta: 'Instructor',
          },
          {
            clave: 'id_ficha',
            etiqueta: 'Ficha',
          },
          {
            clave: 'fecha_envio',
            etiqueta: 'Envío',
            representar: (fila) => formatearFecha(fila.fecha_envio),
          },
          {
            clave: 'estudiantes',
            etiqueta: 'Pase de lista',
            representar: (fila) => (
              <details>
                <summary>{fila.estudiantes.length} aprendices</summary>
                <ul>
                  {fila.estudiantes.map((estudiante) => (
                    <li key={estudiante.id_usuarios}>
                      ID {estudiante.id_usuarios}:{' '}
                      {estudiante.presente ? 'Presente' : 'Ausente'}
                    </li>
                  ))}
                </ul>
              </details>
            ),
          },
          {
            clave: 'observaciones',
            etiqueta: 'Observaciones',
          },
        ];
  return (
    <Dialogo
      titulo={tipo === 'sos' ? 'Solicitudes SOS' : 'Reportes de evacuación'}
      alCerrar={alCerrar}
    >
      <EstadoConsulta recurso={recurso}>
        <TablaDatos
          claveFila={tipo === 'sos' ? 'id_sos' : 'id_reporte'}
          columnas={columnas}
          filas={recurso.datos || []}
        />
        <Paginacion
          paginacion={{
            pagina,
            tamano: 25,
            cambiarPagina,
          }}
          cantidad={recurso.datos?.length || 0}
        />
      </EstadoConsulta>
    </Dialogo>
  );
}
function PanelAlertas() {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useAutenticacion();
  /* rol: valor de trabajo utilizado en esta operación. */
  const rol = rolParaUsuario(usuario);
  /* esAdministrador: valor de trabajo utilizado en esta operación. */
  const esAdministrador = rol === 'admin';
  /* paginacion: valor de trabajo utilizado en esta operación. */
  const paginacion = usePaginacion();
  /* recurso: consulta cancelable al servidor, con datos, estado y reintento. */
  const recurso = useRecurso(`/alertas?${paginacion.consulta}`);
  /* accion, cambiarAccion: estado de la vista y función para actualizarlo. */
  const [accion, cambiarAccion] = useEstado(null);
  /* retroalimentacion, cambiarRetroalimentacion: estado de la vista y función para actualizarlo. */
  const [retroalimentacion, cambiarRetroalimentacion] = useEstado({});
  /* guardando, cambiarGuardando: estado de la vista y función para actualizarlo. */
  const [guardando, cambiarGuardando] = useEstado(false);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* guardado: operación local que atiende el evento o transforma la información. */
  const guardado = () => {
    cambiarAccion(null);
    cambiarRetroalimentacion({
      mensaje: 'Listo. La información se guardó correctamente.',
    });
    recurso.actualizar();
    window.dispatchEvent(new Event('xentinel:alerts-changed'));
  };
  /* cerrarAlerta: operación local que atiende el evento o transforma la información. */
  const cerrarAlerta = async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarRetroalimentacion({});
    try {
      await solicitar(`/alertas/${accion.alerta.id_alerta}/cerrar`, {
        method: 'PATCH',
      });
      guardado();
    } catch (error) {
      cambiarRetroalimentacion({
        error,
      });
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  /* enviarSos: operación local que atiende el evento o transforma la información. */
  const enviarSos = () => {
    if (ocupado.current) return;
    if (!navigator.geolocation) {
      cambiarRetroalimentacion({
        error: 'Tu navegador no permite obtener la ubicación.',
      });
      return;
    }
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarRetroalimentacion({});
    navigator.geolocation.getCurrentPosition(
      async (posicion) => {
        try {
          await solicitar('/alertas/sos', {
            method: 'POST',
            body: {
              id_alerta: accion.alerta.id_alerta,
              latitud: posicion.coords.latitude,
              longitud: posicion.coords.longitude,
            },
          });
          cambiarAccion(null);
          cambiarRetroalimentacion({
            mensaje: 'Tu ubicación fue enviada al personal de control.',
          });
        } catch (error) {
          cambiarRetroalimentacion({
            error,
          });
        } finally {
          ocupado.current = false;
          cambiarGuardando(false);
        }
      },
      () => {
        cambiarRetroalimentacion({
          error:
            'No pudimos obtener tu ubicación. Revisa los permisos y vuelve a intentarlo.',
        });
        ocupado.current = false;
        cambiarGuardando(false);
      },
      {
        timeout: 10000,
        maximumAge: 0,
        enableHighAccuracy: true,
      }
    );
  };
  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Alertas y emergencias</h1>
          <p>Sigue las instrucciones de tu institución y mantén la calma.</p>
        </div>
        {esAdministrador && (
          <button
            className="xn-boton"
            onClick={() =>
              cambiarAccion({
                tipo: 'crear',
              })
            }
          >
            Nueva alerta
          </button>
        )}
      </div>
      <MensajeEstado {...retroalimentacion} />
      <EstadoConsulta recurso={recurso}>
        <div className="xn-alert-list">
          {recurso.datos?.map((alerta) => (
            <article className="xn-trabajo-tarjeta" key={alerta.id_alerta}>
              <div className="xn-tarjeta-titulo">
                <h2>{alerta.tipo_alerta}</h2>
                <span
                  className={`xn-estado ${alerta.activa ? 'es-peligro' : 'es-neutro'}`}
                >
                  {alerta.activa ? 'Activa' : 'Cerrada'} · {alerta.severidad}
                </span>
              </div>
              <p>{alerta.mensaje}</p>
              <div className="xn-alert-acciones">
                {alerta.activa && esAdministrador && (
                  <button
                    className="xn-boton xn-boton--secundario"
                    onClick={() => {
                      cambiarRetroalimentacion({});
                      cambiarAccion({
                        tipo: 'cerrar',
                        alerta,
                      });
                    }}
                  >
                    Cerrar alerta
                  </button>
                )}
                {alerta.activa && rol === 'instructor' && (
                  <button
                    className="xn-boton"
                    onClick={() =>
                      cambiarAccion({
                        tipo: 'reportar',
                        alerta,
                      })
                    }
                  >
                    Enviar pase de lista
                  </button>
                )}
                {alerta.activa && !esAdministrador && (
                  <button
                    className="xn-boton xn-boton--peligro"
                    onClick={() => {
                      cambiarRetroalimentacion({});
                      cambiarAccion({
                        tipo: 'sos',
                        alerta,
                      });
                    }}
                  >
                    Solicitar ayuda (SOS)
                  </button>
                )}
                {['admin', 'instructor'].includes(rol) && (
                  <button
                    className="xn-texto-enlace xn-enlace-boton"
                    onClick={() =>
                      cambiarAccion({
                        tipo: 'reportes',
                        alerta,
                      })
                    }
                  >
                    Ver reportes
                  </button>
                )}
                {esAdministrador && (
                  <button
                    className="xn-texto-enlace xn-enlace-boton"
                    onClick={() =>
                      cambiarAccion({
                        tipo: 'lista-sos',
                        alerta,
                      })
                    }
                  >
                    Ver solicitudes SOS
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {!recurso.datos?.length && (
          <div className="xn-trabajo-tarjeta">
            <h2>Todo tranquilo por aquí.</h2>
            <p>No hay alertas registradas en esta página.</p>
          </div>
        )}
        <Paginacion
          paginacion={paginacion}
          cantidad={recurso.datos?.length || 0}
        />
      </EstadoConsulta>
      {accion?.tipo === 'crear' && (
        <EditorAlerta
          alCerrar={() => cambiarAccion(null)}
          alGuardar={guardado}
        />
      )}
      {accion?.tipo === 'reportar' && (
        <ReporteAsistencia
          alerta={accion.alerta}
          alCerrar={() => cambiarAccion(null)}
          alGuardar={guardado}
        />
      )}
      {['reportes', 'lista-sos'].includes(accion?.tipo) && (
        <RegistrosAlerta
          alerta={accion.alerta}
          tipo={accion.tipo === 'reportes' ? 'reportes' : 'sos'}
          alCerrar={() => cambiarAccion(null)}
        />
      )}
      {['cerrar', 'sos'].includes(accion?.tipo) && (
        <Dialogo
          titulo={
            accion.tipo === 'cerrar'
              ? 'Cerrar alerta'
              : 'Compartir mi ubicación para recibir ayuda'
          }
          alCerrar={() => cambiarAccion(null)}
          ocupado={guardando}
        >
          <p>
            {accion.tipo === 'cerrar'
              ? `¿Cerrar la alerta de ${accion.alerta.tipo_alerta}? Dejará de aparecer como activa para la comunidad.`
              : 'Al continuar, el navegador solicitará tu ubicación precisa y la enviará al personal de control de tu institución para esta emergencia.'}
          </p>
          <MensajeEstado error={retroalimentacion.error} />
          <div className="xn-dialogo-acciones">
            <button
              data-initial-focus
              className="xn-boton xn-boton--secundario"
              disabled={guardando}
              onClick={() => cambiarAccion(null)}
            >
              Cancelar
            </button>
            <button
              className="xn-boton xn-boton--peligro"
              disabled={guardando}
              onClick={accion.tipo === 'cerrar' ? cerrarAlerta : enviarSos}
            >
              {guardando
                ? 'Procesando…'
                : accion.tipo === 'cerrar'
                  ? 'Cerrar alerta'
                  : 'Compartir ubicación y enviar SOS'}
            </button>
          </div>
        </Dialogo>
      )}
    </>
  );
}
export { PanelAlertas };
