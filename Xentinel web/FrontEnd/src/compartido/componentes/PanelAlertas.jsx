/** Alarmas con semáforo (rojo y amarillo): riesgos críticos y carnets QR vencidos o falsos.
 * Administración publica y cierra alertas; instructores envían pase de lista; todos piden SOS. */
import { useRef as useReferencia, useState as useEstado } from 'react';
import { QrCode as Codigo, TriangleAlert as Triangulo } from 'lucide-react';
import { useAutenticacion } from '../contextos/autenticacion.js';
import { rolParaUsuario } from '../../configuracion/navegacion.js';
import { useRecurso } from '../ganchos/useRecurso.js';
import { useEventos } from '../ganchos/useEventos.js';
import { solicitar } from '../servicios/cliente.js';
import { AlertasNavegador } from './AlertasNavegador.jsx';
import { Dialogo } from './Dialogo.jsx';
import { MensajeEstado, EstadoConsulta } from './MensajeEstado.jsx';
import { TablaDatos, Paginacion } from './TablaDatos.jsx';
import { formatearFecha, usePaginacion } from '../utilidades/tablas.js';
/* Solo niveles de alarma: el verde (informativo) no se publica como alerta. */
const NIVELES = [
  ['moderada', 'Amarillo: advertencia'],
  ['alta', 'Rojo: riesgo alto'],
  ['critica', 'Rojo: crítico'],
];
const SEMAFORO = {
  rojo: { nombre: 'Rojo', plural: 'Críticas', guia: 'Actúa ahora' },
  amarillo: {
    nombre: 'Amarillo',
    plural: 'Advertencias',
    guia: 'Revisa pronto',
  },
};
const horaCorta = (fecha) =>
  new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(fecha));

function EditorAlerta({ alCerrar, alGuardar }) {
  /* formulario, cambiarFormulario: estado de la vista y función para actualizarlo. */
  const [formulario, cambiarFormulario] = useEstado({
    tipo_alerta: 'Simulacro',
    mensaje: '',
    severidad: 'moderada',
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
            <label htmlFor="alert-severity">Nivel del semáforo</label>
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
              {NIVELES.map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
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
/** El semáforo: dos luces que cuentan y filtran. Es el único elemento llamativo del panel. */
function Semaforo({ conteo, filtro, alFiltrar }) {
  return (
    <section className="xn-semaforo" aria-label="Semáforo de alarmas">
      <div className="xn-semaforo-caja" aria-hidden="true">
        {['rojo', 'amarillo'].map((color) => (
          <span
            key={color}
            className={`xn-semaforo-luz es-${color}${conteo[color] ? ' esta-encendida' : ''}`}
          />
        ))}
      </div>
      <div className="xn-semaforo-filtros" role="group" aria-label="Filtrar alarmas">
        {['rojo', 'amarillo'].map((color) => (
          <button
            key={color}
            type="button"
            className={`xn-semaforo-fila es-${color}`}
            aria-pressed={filtro === color}
            onClick={() => alFiltrar(filtro === color ? null : color)}
          >
            <strong>{conteo[color] ?? 0}</strong>
            <span>
              {SEMAFORO[color].plural}
              <small>{SEMAFORO[color].guia}</small>
            </span>
          </button>
        ))}
        <button
          type="button"
          className="xn-enlace-boton xn-texto-enlace"
          aria-pressed={!filtro}
          onClick={() => alFiltrar(null)}
        >
          Ver todas
        </button>
      </div>
    </section>
  );
}

/** Una alarma: barra del color del semáforo, origen, detalle y lo que se puede hacer. */
function TarjetaAlarma({ alarma, children: acciones }) {
  const Icono = alarma.origen === 'qr' ? Codigo : Triangulo;
  return (
    <article className={`xn-alarma es-${alarma.semaforo}`}>
      <div className="xn-alarma-cabecera">
        <Icono size={20} strokeWidth={2.2} aria-hidden="true" />
        <h2>{alarma.titulo}</h2>
        <span className="xn-alarma-nivel">
          {SEMAFORO[alarma.semaforo].nombre}
        </span>
        <time dateTime={alarma.fecha}>{horaCorta(alarma.fecha)}</time>
      </div>
      <p>{alarma.detalle}</p>
      {alarma.origen === 'qr' && (
        <dl className="xn-alarma-datos">
          <div>
            <dt>Movimiento</dt>
            <dd>{alarma.tipo_movimiento === 'SALIDA' ? 'Salida' : 'Entrada'}</dd>
          </div>
          {(alarma.titular || alarma.id_reclamado) && (
            <div>
              <dt>{alarma.titular ? 'Titular' : 'El código dice ser'}</dt>
              <dd>{alarma.titular || `ID ${alarma.id_reclamado}`}</dd>
            </div>
          )}
          {alarma.registrado_por && (
            <div>
              <dt>Escaneó</dt>
              <dd>{alarma.registrado_por}</dd>
            </div>
          )}
        </dl>
      )}
      {alarma.origen === 'riesgo' && alarma.fuente && (
        <p className="xn-alarma-fuente">
          {alarma.fuente === 'PRUEBA'
            ? 'Simulacro de la API de gestión de riesgos'
            : `Fuente: ${alarma.fuente}`}
        </p>
      )}
      {acciones && <div className="xn-alert-acciones">{acciones}</div>}
    </article>
  );
}

function PanelAlertas() {
  const { usuario } = useAutenticacion();
  const rol = rolParaUsuario(usuario);
  const esAdministrador = rol === 'admin';
  const [filtro, cambiarFiltro] = useEstado(null);
  const alarmas = useRecurso(`/alarmas${filtro ? `?semaforo=${filtro}` : ''}`);
  const paginacion = usePaginacion();
  /* Historial: alertas cerradas y activas, para revisar reportes y SOS. */
  const historial = useRecurso(`/alertas?${paginacion.consulta}`);
  const canal = useEventos(
    ['alertas_emergencia', 'alarmas_qr'],
    alarmas.refrescar
  );
  const [accion, cambiarAccion] = useEstado(null);
  const [retroalimentacion, cambiarRetroalimentacion] = useEstado({});
  const [guardando, cambiarGuardando] = useEstado(false);
  const ocupado = useReferencia(false);
  const guardado = () => {
    cambiarAccion(null);
    cambiarRetroalimentacion({
      mensaje: 'Listo. La información se guardó correctamente.',
    });
    alarmas.actualizar();
    historial.actualizar();
    window.dispatchEvent(new Event('xentinel:alerts-changed'));
  };
  const ejecutar = async (tarea) => {
    if (ocupado.current) return;
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarRetroalimentacion({});
    try {
      await tarea();
    } catch (error) {
      cambiarRetroalimentacion({ error });
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  const cerrarAlerta = () =>
    ejecutar(async () => {
      await solicitar(`/alertas/${accion.alerta.id_alerta}/cerrar`, {
        method: 'PATCH',
      });
      guardado();
    });
  const atenderQr = (alarma) =>
    ejecutar(async () => {
      await solicitar(`/alarmas/qr/${alarma.id_alarma}/atender`, {
        method: 'PATCH',
      });
      alarmas.refrescar();
      cambiarRetroalimentacion({
        mensaje: `«${alarma.titulo}» quedó marcada como revisada.`,
      });
      window.dispatchEvent(new Event('xentinel:alerts-changed'));
    });
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
          cambiarRetroalimentacion({ error });
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
      { timeout: 10000, maximumAge: 0, enableHighAccuracy: true }
    );
  };
  const conteo = alarmas.metadatos?.conteo || { rojo: 0, amarillo: 0 };
  const incluyeQr = alarmas.metadatos?.incluye_qr;
  /* Una alarma de riesgo trae lo necesario para cerrar, reportar o pedir SOS. */
  const comoAlerta = (alarma) => ({
    id_alerta: alarma.id_alerta,
    tipo_alerta: alarma.titulo,
    severidad: alarma.severidad,
  });
  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Alarmas</h1>
          <p>
            {incluyeQr
              ? 'Riesgos críticos y carnets QR vencidos o falsos. Lo normal no aparece aquí.'
              : 'Riesgos que piden actuar. Sigue las instrucciones y mantén la calma.'}
          </p>
        </div>
        <div className="xn-admin-acciones">
          <span
            className={`xn-estado ${canal === 'conectado' ? 'es-exito' : 'es-neutro'}`}
            role="status"
          >
            {canal === 'conectado' ? 'En vivo' : 'Reconectando…'}
          </span>
          {esAdministrador && (
            <button
              className="xn-boton"
              onClick={() => cambiarAccion({ tipo: 'crear' })}
            >
              Nueva alerta
            </button>
          )}
        </div>
      </div>
      <MensajeEstado {...retroalimentacion} />
      <AlertasNavegador />
      <Semaforo conteo={conteo} filtro={filtro} alFiltrar={cambiarFiltro} />
      <EstadoConsulta recurso={alarmas}>
        <div className="xn-alarmas" aria-live="polite">
          {alarmas.datos?.map((alarma) => (
            <TarjetaAlarma key={alarma.id} alarma={alarma}>
              {alarma.origen === 'qr' && (
                <button
                  className="xn-boton xn-boton--secundario"
                  disabled={guardando}
                  onClick={() => atenderQr(alarma)}
                >
                  Marcar como revisada
                </button>
              )}
              {alarma.origen === 'riesgo' && esAdministrador && (
                <button
                  className="xn-boton xn-boton--secundario"
                  onClick={() => {
                    cambiarRetroalimentacion({});
                    cambiarAccion({ tipo: 'cerrar', alerta: comoAlerta(alarma) });
                  }}
                >
                  Cerrar alerta
                </button>
              )}
              {alarma.origen === 'riesgo' && rol === 'instructor' && (
                <button
                  className="xn-boton"
                  onClick={() =>
                    cambiarAccion({ tipo: 'reportar', alerta: comoAlerta(alarma) })
                  }
                >
                  Enviar pase de lista
                </button>
              )}
              {alarma.origen === 'riesgo' && !esAdministrador && (
                <button
                  className="xn-boton xn-boton--peligro"
                  onClick={() => {
                    cambiarRetroalimentacion({});
                    cambiarAccion({ tipo: 'sos', alerta: comoAlerta(alarma) });
                  }}
                >
                  Solicitar ayuda (SOS)
                </button>
              )}
            </TarjetaAlarma>
          ))}
        </div>
        {!alarmas.datos?.length && (
          <div className="xn-trabajo-tarjeta xn-alarmas-vacio">
            <h2>
              {filtro
                ? `No hay alarmas en ${SEMAFORO[filtro].nombre.toLowerCase()}.`
                : 'Todo tranquilo por aquí.'}
            </h2>
            <p>
              {filtro
                ? 'Elige «Ver todas» para revisar el otro color.'
                : 'Cuando aparezca un riesgo o un carnet con problemas, lo verás aquí al instante.'}
            </p>
          </div>
        )}
      </EstadoConsulta>
      {['admin', 'instructor'].includes(rol) && (
        <details className="xn-trabajo-tarjeta xn-alarmas-historial">
          <summary>Historial de alertas, reportes y SOS</summary>
          <EstadoConsulta recurso={historial}>
            <ul>
              {historial.datos?.map((alerta) => (
                <li key={alerta.id_alerta}>
                  <span className={`xn-alarma-punto es-${alerta.semaforo}`} />
                  <div>
                    <strong>{alerta.tipo_alerta}</strong>
                    <small>
                      {alerta.activa ? 'Activa' : 'Cerrada'}, publicada el{' '}
                      {formatearFecha(alerta.fecha_inicio)}
                    </small>
                  </div>
                  <button
                    className="xn-texto-enlace xn-enlace-boton"
                    onClick={() => cambiarAccion({ tipo: 'reportes', alerta })}
                  >
                    Ver reportes
                  </button>
                  {esAdministrador && (
                    <button
                      className="xn-texto-enlace xn-enlace-boton"
                      onClick={() => cambiarAccion({ tipo: 'lista-sos', alerta })}
                    >
                      Ver SOS
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!historial.datos?.length && (
              <p>Todavía no se ha publicado ninguna alerta.</p>
            )}
            <Paginacion
              paginacion={paginacion}
              cantidad={historial.datos?.length || 0}
            />
          </EstadoConsulta>
        </details>
      )}
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
