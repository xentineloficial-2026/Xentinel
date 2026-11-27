/** Registro de entradas y salidas por QR o por documento. El carnet firmado se registra al
 * leerlo; el servidor verifica firma, vigencia, estado de la cuenta y secuencia. */
import { LectorCodigo } from './LectorCodigo.jsx';
import { ExportarReportes } from '../admin/ExportarReportes.jsx';
import '../../compartido/estilos/acceso.css';
import { resultadoError, resultadoRegistro } from './resultadoAcceso.js';
import { useRef as useReferencia, useState as useEstado } from 'react';
import {
  LogIn as Entrada,
  LogOut as Salida,
  UserX as Rechazo,
  TriangleAlert as Aviso,
} from 'lucide-react';
import { useAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { rolParaUsuario } from '../../configuracion/navegacion.js';
import { solicitar } from '../../compartido/servicios/cliente.js';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { useEventos } from '../../compartido/ganchos/useEventos.js';
import { tocarTono } from '../../compartido/utilidades/tonos.js';
import {
  MensajeEstado,
  EstadoConsulta,
} from '../../compartido/componentes/MensajeEstado.jsx';
import {
  TablaDatos,
  Paginacion,
} from '../../compartido/componentes/TablaDatos.jsx';
import {
  formatearFecha,
  usePaginacion,
} from '../../compartido/utilidades/tablas.js';

const ICONOS = {
  entrada: Entrada,
  salida: Salida,
  rechazo: Rechazo,
  aviso: Aviso,
};

/** Resultado del último registro: color, título y datos de la persona, a la vista del celador. */
function ResultadoEscaneo({ resultado, alCerrar }) {
  const Icono = ICONOS[resultado.variante];
  const persona = resultado.persona;
  return (
    <section
      className={`xn-resultado-acceso xn-resultado-acceso--${resultado.variante}`}
      role={resultado.variante === 'rechazo' ? 'alert' : 'status'}
      aria-live="assertive"
    >
      <Icono size={44} strokeWidth={2.2} aria-hidden="true" />
      <div className="xn-resultado-acceso-texto">
        <h2>{resultado.titulo}</h2>
        <p>{resultado.detalle}</p>
        {persona?.nombres_completos && (
          <dl>
            <dt>Persona</dt>
            <dd>
              <strong>{persona.nombres_completos}</strong>
            </dd>
            <dt>Documento</dt>
            <dd>
              {persona.tipo_documento} {persona.numero_documento}
            </dd>
            <dt>Rol</dt>
            <dd>{persona.nombre_rol}</dd>
            {persona.numero_ficha && (
              <>
                <dt>Ficha</dt>
                <dd>
                  {persona.numero_ficha}
                  {persona.nombre_programa && ` · ${persona.nombre_programa}`}
                </dd>
              </>
            )}
            {persona.ambiente && (
              <>
                <dt>Ambiente</dt>
                <dd>{persona.ambiente}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <button
        type="button"
        className="xn-enlace-boton xn-resultado-acceso-cerrar"
        onClick={alCerrar}
      >
        Listo
      </button>
    </section>
  );
}

function ControlAccesos() {
  const { usuario } = useAutenticacion();
  const rol = rolParaUsuario(usuario);
  const puedeRegistrar = ['admin', 'celador'].includes(rol);
  const paginacion = usePaginacion();
  const esAdmin = rol === 'admin';
  const recurso = useRecurso(
    esAdmin ? `/ingresos?${paginacion.consulta}` : null
  );
  /* canal: conexión en vivo; cada escaneo refresca el historial sin recargar. */
  const canal = useEventos(esAdmin ? 'acceso' : null, recurso.refrescar);
  const [formulario, cambiarFormulario] = useEstado({
    id_usuarios: '',
    tipo: 'ENTRADA',
  });
  const [retroalimentacion, cambiarRetroalimentacion] = useEstado({});
  const [resultado, cambiarResultado] = useEstado(null);
  const [guardando, cambiarGuardando] = useEstado(false);
  const [metodoRegistro, cambiarMetodoRegistro] = useEstado('Manual');
  const [identidadConfirmada, cambiarIdentidadConfirmada] = useEstado(false);
  /* persona: quién corresponde al documento digitado, para confirmarlo antes de registrar. */
  const [persona, cambiarPersona] = useEstado(null);
  /* operacion: clave de idempotencia; se conserva ante errores de red al reintentar. */
  const operacion = useReferencia(null);
  /* codigoLeido: carnet firmado leído con la cámara, enviado tal cual al servidor. */
  const codigoLeido = useReferencia(null);
  const ocupado = useReferencia(false);

  const mostrar = (nuevo) => {
    cambiarResultado(nuevo);
    tocarTono(nuevo.tono);
  };

  const buscarDocumento = async (documento) => {
    if (!/^[A-Za-z0-9-]{3,20}$/.test(documento)) {
      cambiarRetroalimentacion({
        error: 'Escribe el número de documento sin espacios ni puntos.',
      });
      return null;
    }
    try {
      const { data } = await solicitar(
        `/usuarios/documento/${encodeURIComponent(documento)}`
      );
      cambiarPersona(data);
      return data;
    } catch (error) {
      cambiarPersona(null);
      mostrar(resultadoError(error, formulario.tipo));
      return null;
    }
  };

  /** Envía el movimiento. Devuelve true si el servidor respondió (permitido o no). */
  const registrar = async (cuerpo) => {
    if (ocupado.current) return;
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarRetroalimentacion({});
    operacion.current ||= crypto.randomUUID();
    try {
      const { data } = await solicitar('/ingresos', {
        method: 'POST',
        body: { ...cuerpo, request_id: operacion.current },
      });
      mostrar(resultadoRegistro(data));
      operacion.current = null;
      cambiarFormulario((actual) => ({ ...actual, id_usuarios: '' }));
      cambiarPersona(null);
      cambiarIdentidadConfirmada(false);
      codigoLeido.current = null;
      cambiarMetodoRegistro('Manual');
      recurso.actualizar();
    } catch (error) {
      mostrar(resultadoError(error, cuerpo.tipo));
      // Un rechazo definitivo libera la clave; un fallo de red la conserva para no duplicar.
      if (error.status >= 400 && error.status < 500) operacion.current = null;
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };

  const leerCodigo = ({ id_usuarios: identificador, codigo_qr }) => {
    operacion.current = null;
    cambiarPersona(null);
    if (codigo_qr) {
      // Carnet firmado de la app o de la web: el servidor verifica la firma y la vigencia.
      registrar({
        codigo_qr,
        escaneado_en: new Date().toISOString(),
        tipo: formulario.tipo,
        metodo: 'QR',
      });
      return;
    }
    // Código antiguo sin firma: identifica, pero el celador confirma la identidad.
    cambiarFormulario((actual) => ({
      ...actual,
      id_usuarios: String(identificador),
    }));
    codigoLeido.current = null;
    cambiarMetodoRegistro('QR');
    cambiarIdentidadConfirmada(false);
    cambiarResultado(null);
    cambiarRetroalimentacion({
      mensaje:
        'Código sin firma leído. Verifica la identidad y confirma el movimiento.',
    });
    document.getElementById('access-user')?.focus();
  };

  const cambiar = (campo, valor) => {
    cambiarFormulario((actual) => ({ ...actual, [campo]: valor }));
    operacion.current = null;
    if (campo === 'id_usuarios') {
      cambiarMetodoRegistro('Manual');
      cambiarPersona(null);
      codigoLeido.current = null;
    }
    cambiarIdentidadConfirmada(false);
    cambiarRetroalimentacion({});
  };

  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    let identificador = Number(formulario.id_usuarios);
    if (metodoRegistro === 'Manual') {
      const encontrada =
        persona?.numero_documento === formulario.id_usuarios.trim()
          ? persona
          : await buscarDocumento(formulario.id_usuarios.trim());
      if (!encontrada) {
        document.getElementById('access-user').focus();
        return;
      }
      identificador = encontrada.id_usuarios;
    } else if (
      !Number.isSafeInteger(identificador) ||
      identificador < 1 ||
      identificador > 2147483647
    ) {
      cambiarRetroalimentacion({
        error: 'El código leído no es válido. Escanéalo de nuevo.',
      });
      return;
    }
    if (!identidadConfirmada) {
      cambiarRetroalimentacion({
        error: 'Confirma que verificaste la identidad antes de continuar.',
      });
      return;
    }
    await registrar({
      id_usuarios: identificador,
      tipo: formulario.tipo,
      metodo: metodoRegistro,
    });
  };

  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>{puedeRegistrar ? 'Ingresos y salidas' : 'Mis accesos'}</h1>
          <p>
            Escanea el carnet QR o digita el documento. Cada entrada registra la
            asistencia del día.
          </p>
        </div>
      </div>
      {puedeRegistrar && (
        <div
          className="xn-movimiento-selector"
          role="radiogroup"
          aria-label="Movimiento que se registra"
        >
          {[
            ['ENTRADA', 'Entrada', Entrada],
            ['SALIDA', 'Salida', Salida],
          ].map(([valor, etiqueta, Icono]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={formulario.tipo === valor}
              className={`xn-movimiento-opcion xn-movimiento-opcion--${valor.toLowerCase()}`}
              disabled={guardando}
              onClick={() => cambiar('tipo', valor)}
            >
              <Icono size={20} aria-hidden="true" />
              {etiqueta}
            </button>
          ))}
        </div>
      )}
      {resultado && (
        <ResultadoEscaneo
          resultado={resultado}
          alCerrar={() => cambiarResultado(null)}
        />
      )}
      {puedeRegistrar && <LectorCodigo alLeer={leerCodigo} />}
      {puedeRegistrar && (
        <section className="xn-trabajo-tarjeta">
          <h2>Registrar con el documento</h2>
          <p>
            Si la persona no tiene su código QR, digita su documento, verifica
            su identidad y registra el movimiento.
          </p>
          <form className="xn-access-formulario" noValidate onSubmit={enviar}>
            <div className="xn-campo">
              <label htmlFor="access-user">
                {metodoRegistro === 'QR'
                  ? 'ID leído del código'
                  : 'Número de documento'}
              </label>
              <input
                id="access-user"
                inputMode="numeric"
                autoComplete="off"
                value={formulario.id_usuarios}
                onChange={(evento) =>
                  cambiar('id_usuarios', evento.target.value)
                }
                onBlur={() =>
                  metodoRegistro === 'Manual' &&
                  formulario.id_usuarios.trim() &&
                  persona?.numero_documento !== formulario.id_usuarios.trim() &&
                  buscarDocumento(formulario.id_usuarios.trim())
                }
                disabled={guardando}
                placeholder="Ej. 1023456789"
              />
              {persona && metodoRegistro === 'Manual' && (
                <p className="xn-persona-encontrada" role="status">
                  <strong>{persona.nombres_completos}</strong>
                  {persona.nombre_rol} · {persona.tipo_documento}{' '}
                  {persona.numero_documento} · {persona.estado}
                </p>
              )}
            </div>
            <label className="xn-confirmacion xn-confirmacion-identidad">
              <input
                type="checkbox"
                checked={identidadConfirmada}
                disabled={guardando}
                onChange={(evento) =>
                  cambiarIdentidadConfirmada(evento.target.checked)
                }
              />
              Verifiqué la identidad de la persona.
            </label>
            <button className="xn-boton" disabled={guardando}>
              {guardando
                ? 'Registrando…'
                : formulario.tipo === 'ENTRADA'
                  ? 'Registrar entrada'
                  : 'Registrar salida'}
            </button>
          </form>
          <MensajeEstado {...retroalimentacion} />
        </section>
      )}
      {esAdmin && (
        <section className="xn-trabajo-tarjeta">
          <div className="xn-tarjeta-titulo">
            <h2>Historial de accesos</h2>
            <div className="xn-admin-acciones">
              <span
                className={`xn-estado ${canal === 'conectado' ? 'es-exito' : 'es-peligro'}`}
                role="status"
              >
                {canal === 'conectado' ? 'En vivo' : 'Reconectando…'}
              </span>
              <button
                className="xn-boton xn-boton--secundario"
                onClick={recurso.actualizar}
              >
                Actualizar
              </button>
              <ExportarReportes />
            </div>
          </div>
          <EstadoConsulta recurso={recurso}>
            <TablaDatos
              filas={recurso.datos || []}
              claveFila="id_acceso"
              columnas={[
                {
                  clave: 'fechahora',
                  etiqueta: 'Fecha y hora',
                  representar: (fila) => formatearFecha(fila.fechahora),
                },
                {
                  clave: 'id_usuarios',
                  etiqueta: 'Persona',
                  representar: (fila) =>
                    fila.nombres_completos || fila.id_usuarios,
                },
                {
                  clave: 'tipo',
                  etiqueta: 'Movimiento',
                  representar: (fila) =>
                    fila.tipo === 'ENTRADA' ? 'Entrada' : 'Salida',
                },
                {
                  clave: 'metodo',
                  etiqueta: 'Método',
                },
                {
                  clave: 'estado',
                  etiqueta: 'Resultado',
                  representar: (fila) => (
                    <span
                      className={`xn-estado ${fila.estado === 'Permitido' ? 'es-exito' : 'es-peligro'}`}
                    >
                      {fila.estado}
                    </span>
                  ),
                },
              ]}
            />
            <Paginacion
              paginacion={paginacion}
              cantidad={recurso.datos?.length || 0}
            />
          </EstadoConsulta>
        </section>
      )}
    </>
  );
}
export { ControlAccesos };
