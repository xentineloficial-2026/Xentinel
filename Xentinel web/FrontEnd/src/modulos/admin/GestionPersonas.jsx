/** Directorio paginado con creación, edición y desactivación explícita; contratos de usuarios del API vigente. */
import { useRef as useReferencia, useState as useEstado } from 'react';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { solicitar } from '../../compartido/servicios/cliente.js';
import { caducarSesion } from '../../compartido/servicios/sesion.js';
import { useAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { errorContrasena } from '../../compartido/servicios/recuperacion.js';
import { CampoContrasena } from '../../compartido/componentes/CampoContrasena.jsx';
import { Dialogo } from '../../compartido/componentes/Dialogo.jsx';
import {
  MensajeEstado,
  EstadoConsulta,
} from '../../compartido/componentes/MensajeEstado.jsx';
import {
  TablaDatos,
  Paginacion,
} from '../../compartido/componentes/TablaDatos.jsx';
import { usePaginacion } from '../../compartido/utilidades/tablas.js';
/* personaVacia: valor de trabajo utilizado en esta operación. */
const personaVacia = {
  nombres_completos: '',
  tipo_documento: 'CC',
  numero_documento: '',
  correo: '',
  telefono: '',
  fecha_nacimiento: '',
  contrasena: '',
  id_rol: '',
  estado: 'Activo',
};
function EditorPersona({ usuario, alCerrar, alGuardar }) {
  /* editando: valor de trabajo utilizado en esta operación. */
  const editando = !!usuario?.id_usuarios;
  /* formulario, cambiarFormulario: estado de la vista y función para actualizarlo. */
  const [formulario, cambiarFormulario] = useEstado(() => ({
    ...personaVacia,
    ...usuario,
    fecha_nacimiento: usuario?.fecha_nacimiento?.slice(0, 10) || '',
  }));
  /* roles: consulta cancelable al servidor, con datos, estado y reintento. */
  const roles = useRecurso('/roles?limit=100');
  /* esAprendiz: la situación formativa solo aplica a aprendices. */
  const esAprendiz =
    roles.datos
      ?.find((rol) => String(rol.id_rol) === String(formulario.id_rol))
      ?.nombre_rol?.toLowerCase() === 'aprendiz';
  /* error, cambiarError: estado de la vista y función para actualizarlo. */
  const [error, cambiarError] = useEstado(null);
  /* guardando, cambiarGuardando: estado de la vista y función para actualizarlo. */
  const [guardando, cambiarGuardando] = useEstado(false);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* cambiar: operación local que atiende el evento o transforma la información. */
  const cambiar = (campo, valor) =>
    cambiarFormulario((actual) => ({
      ...actual,
      [campo]: valor,
    }));
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    cambiarError(null);
    /* comprobaciones: valor de trabajo utilizado en esta operación. */
    const comprobaciones = [
      [
        'nombres_completos',
        formulario.nombres_completos.trim().length < 2,
        'Escribe el nombre completo.',
      ],
      [
        'numero_documento',
        !/^[A-Za-z0-9-]{3,20}$/.test(formulario.numero_documento),
        'Revisa el documento: entre 3 y 20 letras, números o guiones.',
      ],
      [
        'correo',
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formulario.correo),
        'Escribe un correo válido.',
      ],
      ['id_rol', !formulario.id_rol, 'Selecciona un rol.'],
      [
        'contrasena',
        !editando && !!errorContrasena(formulario.contrasena),
        errorContrasena(formulario.contrasena),
      ],
    ];
    /* invalido: valor de trabajo utilizado en esta operación. */
    const invalido = comprobaciones.find(([, fallido]) => fallido);
    if (invalido) {
      cambiarError(invalido[2]);
      document.getElementById(`user-${invalido[0]}`)?.focus();
      return;
    }
    /* cuerpo: valor de trabajo utilizado en esta operación. */
    const cuerpo = {
      nombres_completos: formulario.nombres_completos.trim(),
      tipo_documento: formulario.tipo_documento,
      numero_documento: formulario.numero_documento,
      correo: formulario.correo.trim(),
      telefono: formulario.telefono || '',
      id_rol: Number(formulario.id_rol),
      ...(formulario.fecha_nacimiento
        ? {
            fecha_nacimiento: formulario.fecha_nacimiento,
          }
        : {}),
      ...(editando
        ? {
            estado: formulario.estado,
            ...(esAprendiz && formulario.situacion_formativa
              ? { situacion_formativa: formulario.situacion_formativa }
              : {}),
          }
        : {
            contrasena: formulario.contrasena,
          }),
    };
    ocupado.current = true;
    cambiarGuardando(true);
    try {
      await solicitar(
        editando ? `/usuarios/${usuario.id_usuarios}` : '/usuarios',
        {
          method: editando ? 'PATCH' : 'POST',
          body: cuerpo,
        }
      );
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
      titulo={editando ? 'Editar persona' : 'Agregar persona'}
      alCerrar={alCerrar}
      ocupado={guardando}
    >
      <form noValidate onSubmit={enviar}>
        <div className="xn-formulario-cuadricula">
          {[
            ['nombres_completos', 'Nombre completo', 'text'],
            ['numero_documento', 'Documento', 'text'],
            ['correo', 'Correo electrónico', 'email'],
            ['telefono', 'Teléfono', 'tel'],
            ['fecha_nacimiento', 'Fecha de nacimiento', 'date'],
          ].map(([clave, etiqueta, tipo]) => (
            <div className="xn-campo" key={clave}>
              <label htmlFor={`user-${clave}`}>{etiqueta}</label>
              <input
                id={`user-${clave}`}
                type={tipo}
                value={formulario[clave] || ''}
                onChange={(evento) => cambiar(clave, evento.target.value)}
                required={[
                  'nombres_completos',
                  'numero_documento',
                  'correo',
                ].includes(clave)}
              />
            </div>
          ))}
          <div className="xn-campo">
            <label htmlFor="user-document-type">Tipo de documento</label>
            <select
              id="user-document-type"
              value={formulario.tipo_documento}
              onChange={(evento) =>
                cambiar('tipo_documento', evento.target.value)
              }
            >
              {['CC', 'TI', 'CE', 'PA', 'PEP', 'PPT'].map((tipo) => (
                <option key={tipo}>{tipo}</option>
              ))}
            </select>
          </div>
          <div className="xn-campo">
            <label htmlFor="user-id_rol">Rol</label>
            <select
              id="user-id_rol"
              value={formulario.id_rol}
              onChange={(evento) => cambiar('id_rol', evento.target.value)}
            >
              <option value="">Seleccionar rol</option>
              {roles.datos?.map((rol) => (
                <option key={rol.id_rol} value={rol.id_rol}>
                  {rol.nombre_rol}
                </option>
              ))}
            </select>
            {roles.estado === 'error' && (
              <button
                type="button"
                className="xn-enlace-boton xn-texto-enlace"
                onClick={roles.actualizar}
              >
                Reintentar carga de roles
              </button>
            )}
          </div>
          {editando && (
            <div className="xn-campo">
              <label htmlFor="user-state">Estado</label>
              <select
                id="user-state"
                value={formulario.estado}
                onChange={(evento) => cambiar('estado', evento.target.value)}
              >
                <option>Activo</option>
                <option>Inactivo</option>
              </select>
            </div>
          )}
          {editando && esAprendiz && (
            <div className="xn-campo">
              <label htmlFor="user-situacion">Situación formativa</label>
              <select
                id="user-situacion"
                value={formulario.situacion_formativa || ''}
                onChange={(evento) =>
                  cambiar('situacion_formativa', evento.target.value)
                }
              >
                <option value="" disabled>
                  Seleccionar
                </option>
                <option>En inducción</option>
                <option>En formación</option>
                <option>Desertado</option>
                <option>Retirado</option>
              </select>
              {['Desertado', 'Retirado'].includes(
                formulario.situacion_formativa
              ) && (
                <p className="xn-ayuda">
                  Sale de la lista de su ficha y no podrá ingresar a la sede. Su
                  historial se conserva y puedes revertirlo.
                </p>
              )}
            </div>
          )}
        </div>
        {!editando && (
          <CampoContrasena
            identificador="user-contrasena"
            etiqueta="Contraseña inicial"
            valor={formulario.contrasena}
            alCambiar={(evento) => cambiar('contrasena', evento.target.value)}
            ayuda="Al menos 12 caracteres; máximo 72 bytes UTF-8."
          />
        )}
        <MensajeEstado error={error} />
        <p className="xn-ayuda">
          Al editar, se cerrarán las sesiones de esta persona para aplicar los
          cambios de forma segura.
        </p>
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
            disabled={guardando || roles.estado !== 'listo'}
          >
            {guardando ? 'Guardando…' : 'Guardar persona'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
function GestionPersonas() {
  /* usuario, usuarioActual: valor de trabajo utilizado en esta operación. */
  const { usuario: usuarioActual } = useAutenticacion();
  /* paginacion: valor de trabajo utilizado en esta operación. */
  const paginacion = usePaginacion();
  /* recurso: consulta cancelable al servidor, con datos, estado y reintento. */
  const [estado, cambiarEstado] = useEstado('Activo');
  const recurso = useRecurso(
    `/usuarios?estado=${estado}&${paginacion.consulta}`
  );
  const totales = recurso.metadatos?.totales;
  /* busqueda, cambiarBusqueda: estado de la vista y función para actualizarlo. */
  const [busqueda, cambiarBusqueda] = useEstado('');
  /* editor, cambiarEditor: estado de la vista y función para actualizarlo. */
  const [editor, cambiarEditor] = useEstado(null);
  /* objetivo, cambiarObjetivo: estado de la vista y función para actualizarlo. */
  const [objetivo, cambiarObjetivo] = useEstado(null);
  /* retroalimentacion, cambiarRetroalimentacion: estado de la vista y función para actualizarlo. */
  const [retroalimentacion, cambiarRetroalimentacion] = useEstado({});
  /* guardando, cambiarGuardando: estado de la vista y función para actualizarlo. */
  const [guardando, cambiarGuardando] = useEstado(false);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* desactivar: operación local que atiende el evento o transforma la información. */
  const desactivar = async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarRetroalimentacion({});
    try {
      await solicitar(`/usuarios/${objetivo.id_usuarios}`, {
        method: 'DELETE',
      });
      cambiarObjetivo(null);
      cambiarRetroalimentacion({
        mensaje: 'Cuenta desactivada. Sus registros se conservan.',
      });
      recurso.actualizar();
    } catch (error) {
      cambiarRetroalimentacion({
        error,
      });
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  /* filas: valor de trabajo utilizado en esta operación. */
  const filas = (recurso.datos || []).filter((fila) =>
    `${fila.nombres_completos} ${fila.numero_documento} ${fila.correo}`
      .toLowerCase()
      .includes(busqueda.toLowerCase())
  );
  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Tu comunidad</h1>
          <p>
            Cada perfil tiene su lugar. Gestiona sus datos y permisos con
            cuidado.
          </p>
        </div>
        <button className="xn-boton" onClick={() => cambiarEditor({})}>
          Agregar persona
        </button>
      </div>
      <MensajeEstado {...retroalimentacion} />
      <section className="xn-trabajo-tarjeta">
        <div
          className="xn-admin-filtros"
          role="group"
          aria-label="Estado de las personas"
        >
          {[
            ['Activo', 'Activos', totales?.activos],
            ['Inactivo', 'Inactivos', totales?.inactivos],
          ].map(([valor, etiqueta, total]) => (
            <button
              key={valor}
              type="button"
              className="xn-boton xn-boton--secundario"
              aria-pressed={estado === valor}
              onClick={() => {
                if (estado === valor) return;
                cambiarEstado(valor);
                cambiarBusqueda('');
                paginacion.cambiarPagina(1);
              }}
            >
              {etiqueta} <span className="xn-admin-total">{total ?? '—'}</span>
            </button>
          ))}
        </div>
        <div className="xn-busqueda">
          <label htmlFor="user-search">Buscar en esta página</label>
          <input
            id="user-search"
            value={busqueda}
            onChange={(evento) => cambiarBusqueda(evento.target.value)}
            placeholder="Nombre, documento o correo"
          />
          {busqueda && (
            <button
              onClick={() => {
                cambiarBusqueda('');
                document.getElementById('user-search').focus();
              }}
            >
              Limpiar búsqueda
            </button>
          )}
        </div>
        <EstadoConsulta recurso={recurso}>
          <TablaDatos
            claveFila="id_usuarios"
            filas={filas}
            vacio={
              busqueda
                ? 'No encontramos coincidencias en esta página.'
                : estado === 'Activo'
                  ? 'No hay personas activas en esta página.'
                  : 'No hay personas inactivas en esta página.'
            }
            columnas={[
              {
                clave: 'id_usuarios',
                etiqueta: 'ID',
              },
              {
                clave: 'nombres_completos',
                etiqueta: 'Nombre',
              },
              {
                clave: 'numero_documento',
                etiqueta: 'Documento',
              },
              {
                clave: 'nombre_rol',
                etiqueta: 'Rol',
              },
              {
                clave: 'estado',
                etiqueta: 'Estado',
                representar: (fila) => (
                  <span
                    className={`xn-estado ${fila.estado === 'Activo' ? 'es-exito' : 'es-neutro'}`}
                  >
                    {fila.estado}
                  </span>
                ),
              },
              {
                clave: 'actions',
                etiqueta: 'Acciones',
                representar: (fila) => (
                  <div className="xn-tabla-acciones">
                    <button onClick={() => cambiarEditor(fila)}>Editar</button>
                    <button
                      disabled={
                        fila.id_usuarios === usuarioActual.id_usuarios ||
                        fila.estado === 'Inactivo'
                      }
                      onClick={() => {
                        cambiarRetroalimentacion({});
                        cambiarObjetivo(fila);
                      }}
                    >
                      Desactivar
                    </button>
                  </div>
                ),
              },
            ]}
          />
          <Paginacion
            paginacion={paginacion}
            cantidad={recurso.datos?.length || 0}
            total={estado === 'Activo' ? totales?.activos : totales?.inactivos}
          />
        </EstadoConsulta>
      </section>
      {editor && (
        <EditorPersona
          usuario={editor}
          alCerrar={() => cambiarEditor(null)}
          alGuardar={() => {
            /* esPropio: valor de trabajo utilizado en esta operación. */
            const esPropio = editor.id_usuarios === usuarioActual.id_usuarios;
            cambiarEditor(null);
            cambiarRetroalimentacion({
              mensaje: 'Datos guardados correctamente.',
            });
            recurso.actualizar();
            if (esPropio) caducarSesion();
          }}
        />
      )}
      {objetivo && (
        <Dialogo
          titulo="Desactivar cuenta"
          alCerrar={() => cambiarObjetivo(null)}
          ocupado={guardando}
        >
          <p>
            ¿Desactivar la cuenta de{' '}
            <strong>{objetivo.nombres_completos}</strong>? No podrá iniciar
            sesión. Sus registros se conservarán y podrás reactivarla desde
            Editar.
          </p>
          <MensajeEstado error={retroalimentacion.error} />
          <div className="xn-dialogo-acciones">
            <button
              data-initial-focus
              className="xn-boton xn-boton--secundario"
              disabled={guardando}
              onClick={() => cambiarObjetivo(null)}
            >
              Conservar cuenta
            </button>
            <button
              className="xn-boton xn-boton--peligro"
              disabled={guardando}
              onClick={desactivar}
            >
              {guardando ? 'Desactivando…' : 'Desactivar cuenta'}
            </button>
          </div>
        </Dialogo>
      )}
    </>
  );
}
export { GestionPersonas };
