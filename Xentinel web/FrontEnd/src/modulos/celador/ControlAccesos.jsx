/** Registro de entradas/salidas con idempotencia y autorización del servidor; historial paginado. */
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
  /* leerCodigo: operación local que atiende el evento o transforma la información. */
  const leerCodigo = (identificador) => {
    cambiarFormulario((actual) => ({
      ...actual,
      id_usuarios: String(identificador),
    }));
    cambiarMetodoRegistro('QR');
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
    if (campo === 'id_usuarios') cambiarMetodoRegistro('Manual');
    cambiarIdentidadConfirmada(false);
    cambiarRetroalimentacion({});
  };
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    if (
      !/^\d+$/.test(formulario.id_usuarios) ||
      Number(formulario.id_usuarios) < 1 ||
      Number(formulario.id_usuarios) > 2147483647
    ) {
      cambiarRetroalimentacion({
        error: 'Ingresa el ID de usuario válido de la credencial.',
      });
      document.getElementById('access-user').focus();
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
          id_usuarios: Number(formulario.id_usuarios),
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
              <label htmlFor="access-user">ID de usuario</label>
              <input
                id="access-user"
                inputMode="numeric"
                value={formulario.id_usuarios}
                onChange={(evento) =>
                  cambiar('id_usuarios', evento.target.value)
                }
                disabled={guardando}
                placeholder="ID de la credencial"
              />
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
            {rol === 'celador' && 'El código identifica al usuario. '}
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
