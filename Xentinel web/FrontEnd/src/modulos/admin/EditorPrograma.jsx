/** Edición anidada: un envío guarda programa, fichas y horarios como una sola operación. */
import { useRef, useState } from 'react';
import { Dialogo } from '../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../compartido/componentes/MensajeEstado.jsx';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { solicitar } from '../../compartido/servicios/cliente.js';
import { DIAS_SEMANA, normalizarDia } from '../instructor/calendario.js';

const horarioNuevo = (clave) => ({
  clave,
  nombre_clase: '',
  dia_semana: 'Lunes',
  hora_inicio: '',
  hora_fin: '',
  ambiente: '',
  id_instructor: '',
});
const fichaNueva = (clave) => ({
  clave,
  numero_ficha: '',
  horarios: [horarioNuevo(`${clave}-horario`)],
});

function preparar(programa) {
  return {
    nombre_programa: programa?.nombre_programa ?? '',
    nivel_programa: programa?.nivel_programa ?? '',
    fichas: programa
      ? programa.fichas.map((ficha) => ({
          ...ficha,
          clave: `ficha-${ficha.id_ficha}`,
          horarios: ficha.horarios.map((horario) => ({
            ...horario,
            clave: `horario-${horario.id_horario}`,
            dia_semana:
              DIAS_SEMANA[normalizarDia(horario.dia_semana)] ??
              horario.dia_semana,
            hora_inicio: horario.hora_inicio.slice(0, 8),
            hora_fin: horario.hora_fin.slice(0, 8),
            ambiente: horario.ambiente ?? '',
          })),
        }))
      : [fichaNueva('ficha-inicial')],
  };
}

function datosParaGuardar(formulario, campos) {
  return {
    nombre_programa: formulario.nombre_programa.trim(),
    nivel_programa: formulario.nivel_programa.trim() || null,
    fichas: formulario.fichas.map((ficha) => ({
      ...(ficha.id_ficha && { id_ficha: ficha.id_ficha }),
      numero_ficha: ficha.numero_ficha.trim(),
      horarios: ficha.horarios.map((horario) => ({
        ...(horario.id_horario && { id_horario: horario.id_horario }),
        nombre_clase: horario.nombre_clase.trim(),
        dia_semana: horario.dia_semana,
        hora_inicio: campos.get(`${horario.clave}-inicio`),
        hora_fin: campos.get(`${horario.clave}-fin`),
        ambiente: horario.ambiente.trim() || null,
        id_instructor: Number(horario.id_instructor),
      })),
    })),
  };
}

function Campo({ etiqueta, children }) {
  return (
    <label className="xn-campo">
      <span>{etiqueta}</span>
      {children}
    </label>
  );
}

function CamposHorario({ horario, indice, instructores, cambiar, quitar }) {
  const cambiarCampo = (campo) => (evento) =>
    cambiar(campo, evento.target.value);
  const instructorAnterior =
    horario.id_instructor &&
    !instructores.some(
      (persona) => String(persona.id_usuarios) === String(horario.id_instructor)
    );
  return (
    <fieldset className="xn-admin-horario-editor">
      <legend>Horario {indice + 1}</legend>
      <div className="xn-formulario-cuadricula">
        <Campo etiqueta="Clase">
          <input
            required
            maxLength={150}
            value={horario.nombre_clase}
            onChange={cambiarCampo('nombre_clase')}
          />
        </Campo>
        <Campo etiqueta="Día">
          <select
            required
            value={horario.dia_semana}
            onChange={cambiarCampo('dia_semana')}
          >
            {!DIAS_SEMANA.includes(horario.dia_semana) && (
              <option value={horario.dia_semana} disabled>
                Selecciona un día
              </option>
            )}
            {DIAS_SEMANA.map((dia) => (
              <option key={dia}>{dia}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Hora de inicio">
          <input
            required
            type="time"
            name={`${horario.clave}-inicio`}
            step={horario.hora_inicio.slice(6) > '00' ? 1 : 60}
            defaultValue={horario.hora_inicio}
          />
        </Campo>
        <Campo etiqueta="Hora de fin">
          <input
            required
            type="time"
            name={`${horario.clave}-fin`}
            step={horario.hora_fin.slice(6) > '00' ? 1 : 60}
            defaultValue={horario.hora_fin}
          />
        </Campo>
        <Campo etiqueta="Entorno">
          <input
            required={!horario.id_horario}
            maxLength={50}
            value={horario.ambiente}
            onChange={cambiarCampo('ambiente')}
            placeholder="Ej. Laboratorio 02"
          />
        </Campo>
        <Campo etiqueta="Instructor">
          <select
            required
            value={horario.id_instructor}
            onChange={cambiarCampo('id_instructor')}
          >
            <option value="">Selecciona un instructor</option>
            {instructorAnterior && (
              <option value={horario.id_instructor}>
                {horario.instructor ?? `ID ${horario.id_instructor}`} (asignado)
              </option>
            )}
            {instructores.map((persona) => (
              <option key={persona.id_usuarios} value={persona.id_usuarios}>
                {persona.nombres_completos}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      {quitar && (
        <button type="button" className="xn-enlace-boton" onClick={quitar}>
          Quitar horario nuevo
        </button>
      )}
    </fieldset>
  );
}

export function EditorPrograma({ programa, alCerrar, alGuardar }) {
  const [formulario, cambiarFormulario] = useState(() => preparar(programa));
  const [estado, cambiarEstado] = useState({});
  const [ocupado, cambiarOcupado] = useState(false);
  const enviando = useRef(false);
  const siguienteClave = useRef(0);
  const instructores = useRecurso('/programas/instructores');
  const nuevaClave = () => `nuevo-${++siguienteClave.current}`;
  const modificarFicha = (clave, transformar) =>
    cambiarFormulario((actual) => ({
      ...actual,
      fichas: actual.fichas.map((ficha) =>
        ficha.clave === clave ? transformar(ficha) : ficha
      ),
    }));

  async function guardar(evento) {
    evento.preventDefault();
    if (enviando.current) return;
    // Los selectores nativos pueden dejar segmentos pendientes mientras se editan.
    // Tomamos las horas que el formulario ya validó al enviar.
    const datos = datosParaGuardar(formulario, new FormData(evento.currentTarget));
    if (
      datos.fichas.some((ficha) =>
        ficha.horarios.some(
          (horario) =>
            horario.hora_fin.padEnd(8, ':00') <=
            horario.hora_inicio.padEnd(8, ':00')
        )
      )
    ) {
      cambiarEstado({
        error:
          'La hora de fin debe ser posterior a la de inicio en todos los horarios.',
      });
      return;
    }
    enviando.current = true;
    cambiarOcupado(true);
    cambiarEstado({});
    try {
      await solicitar(
        programa ? `/programas/${programa.id_programa}` : '/programas',
        {
          method: programa ? 'PATCH' : 'POST',
          body: datos,
        }
      );
      alGuardar();
    } catch (error) {
      cambiarEstado({ error });
    } finally {
      enviando.current = false;
      cambiarOcupado(false);
    }
  }

  return (
    <Dialogo
      titulo={programa ? 'Editar programa' : 'Crear programa'}
      alCerrar={alCerrar}
      ocupado={ocupado}
    >
      <form onSubmit={guardar}>
        <fieldset className="xn-admin-campos" disabled={ocupado}>
          <div className="xn-formulario-cuadricula">
            <Campo etiqueta="Nombre del programa">
              <input
                required
                data-initial-focus
                maxLength={150}
                value={formulario.nombre_programa}
                onChange={(evento) =>
                  cambiarFormulario({
                    ...formulario,
                    nombre_programa: evento.target.value,
                  })
                }
              />
            </Campo>
            <Campo etiqueta="Nivel (opcional)">
              <input
                maxLength={50}
                value={formulario.nivel_programa}
                onChange={(evento) =>
                  cambiarFormulario({
                    ...formulario,
                    nivel_programa: evento.target.value,
                  })
                }
              />
            </Campo>
          </div>
          <h3>Fichas y horarios</h3>
          {instructores.estado === 'cargando' && (
            <p role="status">Cargando instructores…</p>
          )}
          {instructores.estado === 'error' && (
            <>
              <MensajeEstado error={instructores.error} />
              <button
                type="button"
                className="xn-enlace-boton"
                onClick={instructores.actualizar}
              >
                Reintentar consulta de instructores
              </button>
            </>
          )}
          {instructores.estado === 'listo' && !instructores.datos.length && (
            <p>No hay instructores activos para asignar nuevos horarios.</p>
          )}
          {formulario.fichas.map((ficha, indice) => (
            <fieldset key={ficha.clave} className="xn-admin-ficha-editor">
              <legend>Ficha {indice + 1}</legend>
              <Campo etiqueta="Número de ficha">
                <input
                  required
                  maxLength={15}
                  value={ficha.numero_ficha}
                  onChange={(evento) =>
                    modificarFicha(ficha.clave, (grupo) => ({
                      ...grupo,
                      numero_ficha: evento.target.value,
                    }))
                  }
                />
              </Campo>
              {ficha.horarios.map((horario, posicion) => (
                <CamposHorario
                  key={horario.clave}
                  horario={horario}
                  indice={posicion}
                  instructores={instructores.datos ?? []}
                  cambiar={(campo, valor) =>
                    modificarFicha(ficha.clave, (grupo) => ({
                      ...grupo,
                      horarios: grupo.horarios.map((clase) =>
                        clase.clave === horario.clave
                          ? { ...clase, [campo]: valor }
                          : clase
                      ),
                    }))
                  }
                  quitar={
                    !horario.id_horario &&
                    (ficha.id_ficha || ficha.horarios.length > 1)
                      ? () =>
                          modificarFicha(ficha.clave, (grupo) => ({
                            ...grupo,
                            horarios: grupo.horarios.filter(
                              (clase) => clase.clave !== horario.clave
                            ),
                          }))
                      : null
                  }
                />
              ))}
              <div className="xn-admin-acciones">
                <button
                  type="button"
                  className="xn-boton xn-boton--secundario"
                  disabled={ficha.horarios.length >= 150}
                  onClick={() => {
                    const horario = horarioNuevo(nuevaClave());
                    modificarFicha(ficha.clave, (grupo) => ({
                      ...grupo,
                      horarios: [...grupo.horarios, horario],
                    }));
                  }}
                >
                  Agregar horario
                </button>
                {!ficha.id_ficha &&
                  (programa || formulario.fichas.length > 1) && (
                    <button
                      type="button"
                      className="xn-enlace-boton"
                      onClick={() =>
                        cambiarFormulario((actual) => ({
                          ...actual,
                          fichas: actual.fichas.filter(
                            (grupo) => grupo.clave !== ficha.clave
                          ),
                        }))
                      }
                    >
                      Quitar ficha nueva
                    </button>
                  )}
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            disabled={formulario.fichas.length >= 100}
            onClick={() => {
              const ficha = fichaNueva(nuevaClave());
              cambiarFormulario((actual) => ({
                ...actual,
                fichas: [...actual.fichas, ficha],
              }));
            }}
          >
            Agregar ficha
          </button>
        </fieldset>
        <MensajeEstado {...estado} />
        <div className="xn-dialogo-acciones">
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            disabled={ocupado}
            onClick={alCerrar}
          >
            Cancelar
          </button>
          <button
            className="xn-boton"
            disabled={ocupado || instructores.estado !== 'listo'}
          >
            {ocupado ? 'Guardando…' : 'Guardar programa'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
