/** Registro de entradas/salidas por QR o por documento digitado; idempotencia y autorización del servidor. */
import { LectorCodigo } from './LectorCodigo.jsx';
import { ExportarAccesos } from '../admin/ExportarAccesos.jsx';
import { useRef as useReferencia, useState as useEstado } from 'react';
import { useAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { rolParaUsuario } from '../../configuracion/navegacion.js';
import { solicitar } from '../../compartido/servicios/cliente.js';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { useEventos } from '../../compartido/ganchos/useEventos.js';
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
function ControlAccesos() {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useAutenticacion();
  /* puedeRegistrar: valor de trabajo utilizado en esta operación. */
  const rol = rolParaUsuario(usuario);
  const puedeRegistrar = ['admin', 'celador'].includes(rol);
  /* paginacion: valor de trabajo utilizado en esta operación. */
  const paginacion = usePaginacion();
  /* recurso: consulta cancelable al servidor, con datos, estado y reintento. */
  const esAdmin = rol === 'admin';
  const recurso = useRecurso(
    esAdmin ? `/ingresos?${paginacion.consulta}` : null
  );
  /* canal: estado de la conexión en vivo; cada escaneo refresca el historial sin recargar. */
  const canal = useEventos(esAdmin ? 'acceso' : null, recurso.refrescar);
  /* formulario, cambiarFormulario: estado de la vista y función para actualizarlo. */
  const [formulario, cambiarFormulario] = useEstado({
    id_usuarios: '',
    tipo: 'ENTRADA',
  });
  /* retroalimentacion, cambiarRetroalimentacion: estado de la vista y función para actualizarlo. */
  const [retroalimentacion, cambiarRetroalimentacion] = useEstado({});
  /* guardando, cambiarGuardando: estado de la vista y función para actualizarlo. */
  const [guardando, cambiarGuardando] = useEstado(false);
  /* metodoRegistro, cambiarMetodoRegistro: estado de la vista y función para actualizarlo. */
  const [metodoRegistro, cambiarMetodoRegistro] = useEstado('Manual');
  /* identidadConfirmada, cambiarIdentidadConfirmada: estado de la vista y función para actualizarlo. */
  const [identidadConfirmada, cambiarIdentidadConfirmada] = useEstado(false);
  /* persona: quién corresponde al documento digitado, para confirmarlo antes de registrar. */
  const [persona, cambiarPersona] = useEstado(null);
  /* buscarDocumento: sin QR, el documento se traduce al usuario en el servidor. */
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
      cambiarRetroalimentacion({ error });
      return null;
    }
  };
  /* leerCodigo: operación local que atiende el evento o transforma la información. */
  const leerCodigo = (identificador) => {
    cambiarFormulario((actual) => ({
      ...actual,
      id_usuarios: String(identificador),
    }));
    cambiarMetodoRegistro('QR');
    cambiarPersona(null);
    cambiarIdentidadConfirmada(false);
    operacion.current = null;
    cambiarRetroalimentacion({
      mensaje: 'Código leído. Verifica la identidad y confirma el movimiento.',
    });
    document.getElementById('access-user')?.focus();
  };
  /* operacion: referencia estable entre renderizados, sin disparar una actualización visual. */
  const operacion = useReferencia(null);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* cambiar: operación local que atiende el evento o transforma la información. */
  const cambiar = (campo, valor) => {
    cambiarFormulario((actual) => ({
      ...actual,
      [campo]: valor,
    }));
    operacion.current = null;
    if (campo === 'id_usuarios') {
      cambiarMetodoRegistro('Manual');
      cambiarPersona(null);
    }
    cambiarIdentidadConfirmada(false);
    cambiarRetroalimentacion({});
  };
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    // Con QR llega el ID; a mano se digita el documento y el servidor indica a quién pertenece.
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
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarRetroalimentacion({});
    // Conserva la operación ante errores de red para evitar registros duplicados al reintentar.
    operacion.current ||= crypto.randomUUID();
    try {
      /* data, datos: valor de trabajo utilizado en esta operación. */
      const { data: datos } = await solicitar('/ingresos', {
        method: 'POST',
        body: {
          id_usuarios: identificador,
          tipo: formulario.tipo,
          metodo: metodoRegistro,
          request_id: operacion.current,
        },
      });
      cambiarRetroalimentacion(
        datos.estado === 'Permitido'
          ? {
              mensaje: `${formulario.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} registrada. Acceso permitido.`,
            }
          : {
              error:
                'Registro guardado: acceso denegado por el estado de la cuenta.',
            }
      );
      operacion.current = null;
      recurso.actualizar();
    } catch (error) {
      cambiarRetroalimentacion({
        error,
      });
      if (error.status >= 400 && error.status < 500) operacion.current = null;
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>{puedeRegistrar ? 'Ingresos y salidas' : 'Mis accesos'}</h1>
          <p>
            Movimientos registrados por el personal autorizado de la
            institución.
          </p>
        </div>
      </div>
      {rol === 'celador' && <LectorCodigo alLeer={leerCodigo} />}
      {puedeRegistrar && (
        <section className="xn-trabajo-tarjeta">
          <h2>Registrar un movimiento</h2>
          <p>
            Verifica la identidad antes de registrar el acceso. La validación
            del estado y la secuencia de entrada/salida la realiza el servidor.
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
                placeholder="Documento, si no hay código QR"
              />
              {persona && metodoRegistro === 'Manual' && (
                <p className="xn-persona-encontrada" role="status">
                  <strong>{persona.nombres_completos}</strong>
                  {persona.nombre_rol} · {persona.tipo_documento}{' '}
                  {persona.numero_documento} · {persona.estado}
                </p>
              )}
            </div>
            <div className="xn-campo">
              <label htmlFor="access-type">Movimiento</label>
              <select
                id="access-type"
                value={formulario.tipo}
                onChange={(evento) => cambiar('tipo', evento.target.value)}
                disabled={guardando}
              >
                <option value="ENTRADA">Entrada</option>
                <option value="SALIDA">Salida</option>
              </select>
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
              Verifiqué la identidad de la persona ({metodoRegistro}).
            </label>
            <button className="xn-boton" disabled={guardando}>
              {guardando ? 'Registrando…' : 'Registrar acceso'}
            </button>
          </form>
          <MensajeEstado {...retroalimentacion} />
          <p className="xn-ayuda">
            {rol === 'celador' &&
              'El código identifica al usuario; sin código, digita su documento. '}
            La autorización de acceso depende del estado de su cuenta y del
            registro del movimiento.
          </p>
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
              <ExportarAccesos />
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
                  etiqueta: 'Usuario',
                  representar: (fila) =>
                    fila.nombres_completos || fila.id_usuarios,
                },
                {
                  clave: 'tipo',
                  etiqueta: 'Movimiento',
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
