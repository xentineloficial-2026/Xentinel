/** Horario semanal de una ficha: agrega, edita y quita clases en una sola operación. */
import './academico.css';
import { useRef, useState } from 'react';
import { Plus, Trash2 as Quitar } from 'lucide-react';
import { Dialogo } from '../../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../../compartido/componentes/MensajeEstado.jsx';
import { useRecurso } from '../../../compartido/ganchos/useRecurso.js';
import { solicitar } from '../../../compartido/servicios/cliente.js';
import { DIAS_SEMANA, normalizarDia } from '../../instructor/calendario.js';

const claseNueva = (clave) => ({
  clave,
  nombre_clase: '',
  dia_semana: 'Lunes',
  hora_inicio: '',
  hora_fin: '',
  ambiente: '',
  id_instructor: '',
});

function preparar(horarios) {
  return horarios.map((horario) => ({
    ...horario,
    clave: `horario-${horario.id_horario}`,
    dia_semana:
      DIAS_SEMANA[normalizarDia(horario.dia_semana)] ?? horario.dia_semana,
    hora_inicio: horario.hora_inicio.slice(0, 5),
    hora_fin: horario.hora_fin.slice(0, 5),
    ambiente: horario.ambiente ?? '',
  }));
}

function Clase({ clase, numero, instructores, cambiar, quitar }) {
  const campo = (nombre) => (evento) => cambiar(nombre, evento.target.value);
  const id = (nombre) => `${clase.clave}-${nombre}`;
  const instructorAnterior =
    clase.id_instructor &&
    !instructores.some(
      (persona) => String(persona.id_usuarios) === String(clase.id_instructor)
    );
  return (
    <fieldset className="xn-clase-editor">
      <legend>Clase {numero}</legend>
      <div className="xn-clase-campos">
        <div className="xn-campo xn-clase-nombre">
          <label htmlFor={id('nombre')}>Clase o competencia</label>
          <input
            id={id('nombre')}
            required
            maxLength={150}
            value={clase.nombre_clase}
            onChange={campo('nombre_clase')}
            placeholder="Ej. Programación de software"
          />
        </div>
        <div className="xn-campo">
          <label htmlFor={id('dia')}>Día</label>
          <select
            id={id('dia')}
            required
            value={clase.dia_semana}
            onChange={campo('dia_semana')}
          >
            {DIAS_SEMANA.map((dia) => (
              <option key={dia}>{dia}</option>
            ))}
          </select>
        </div>
        <div className="xn-campo">
          <label htmlFor={id('inicio')}>Inicio</label>
          <input
            id={id('inicio')}
            required
            type="time"
            value={clase.hora_inicio}
            onChange={campo('hora_inicio')}
          />
        </div>
        <div className="xn-campo">
          <label htmlFor={id('fin')}>Fin</label>
          <input
            id={id('fin')}
            required
            type="time"
            value={clase.hora_fin}
            onChange={campo('hora_fin')}
          />
        </div>
        <div className="xn-campo">
          <label htmlFor={id('ambiente')}>Ambiente</label>
          <input
            id={id('ambiente')}
            required
            maxLength={50}
            value={clase.ambiente}
            onChange={campo('ambiente')}
            placeholder="Ej. Laboratorio 02"
          />
        </div>
        <div className="xn-campo xn-clase-instructor">
          <label htmlFor={id('instructor')}>Instructor</label>
          <select
            id={id('instructor')}
            required
            value={clase.id_instructor}
            onChange={campo('id_instructor')}
          >
            <option value="">Elige un instructor</option>
            {instructorAnterior && (
              <option value={clase.id_instructor}>
                {clase.instructor ?? `ID ${clase.id_instructor}`} (asignado)
              </option>
            )}
            {instructores.map((persona) => (
              <option key={persona.id_usuarios} value={persona.id_usuarios}>
                {persona.nombres_completos}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="button"
        className="xn-enlace-boton xn-clase-quitar"
        onClick={quitar}
        aria-label={`Quitar la clase ${numero}`}
      >
        <Quitar size={16} aria-hidden="true" /> Quitar
      </button>
    </fieldset>
  );
}

export function EditorHorario({ ficha, alCerrar, alGuardar }) {
  const [clases, cambiarClases] = useState(() =>
    preparar(ficha.horarios ?? [])
  );
  const [estado, cambiarEstado] = useState({});
  const [ocupado, cambiarOcupado] = useState(false);
  const siguiente = useRef(0);
  const instructores = useRecurso('/programas/instructores');

  const cambiar = (clave, campo, valor) =>
    cambiarClases((actuales) =>
      actuales.map((clase) =>
        clase.clave === clave ? { ...clase, [campo]: valor } : clase
      )
    );

  async function guardar(evento) {
    evento.preventDefault();
    if (ocupado) return;
    if (clases.some((clase) => clase.hora_fin <= clase.hora_inicio)) {
      cambiarEstado({
        error:
          'En cada clase, la hora de fin debe ser posterior a la de inicio.',
      });
      return;
    }
    cambiarOcupado(true);
    cambiarEstado({});
    try {
      const { data } = await solicitar(`/fichas/${ficha.id_ficha}/horarios`, {
        method: 'PUT',
        body: {
          horarios: clases.map((clase) => ({
            ...(clase.id_horario && { id_horario: clase.id_horario }),
            nombre_clase: clase.nombre_clase.trim(),
            dia_semana: clase.dia_semana,
            hora_inicio: clase.hora_inicio,
            hora_fin: clase.hora_fin,
            ambiente: clase.ambiente.trim(),
            id_instructor: Number(clase.id_instructor),
          })),
        },
      });
      alGuardar(data);
    } catch (error) {
      cambiarEstado({ error });
      cambiarOcupado(false);
    }
  }

  return (
    <Dialogo
      titulo={`Horario de la ficha ${ficha.numero_ficha}`}
      alCerrar={alCerrar}
      ocupado={ocupado}
    >
      <form onSubmit={guardar}>
        <fieldset className="xn-admin-campos" disabled={ocupado}>
          <p className="xn-ayuda">
            Las clases que quites dejan de aparecer en el calendario de la ficha
            y de su instructor.
          </p>
          {instructores.estado === 'error' && (
            <MensajeEstado error={instructores.error} />
          )}
          {instructores.estado === 'listo' && !instructores.datos.length && (
            <p>No hay instructores activos. Crea uno en Personas.</p>
          )}
          {clases.length ? (
            clases.map((clase, indice) => (
              <Clase
                key={clase.clave}
                clase={clase}
                numero={indice + 1}
                instructores={instructores.datos ?? []}
                cambiar={(campo, valor) => cambiar(clase.clave, campo, valor)}
                quitar={() =>
                  cambiarClases((actuales) =>
                    actuales.filter((otra) => otra.clave !== clase.clave)
                  )
                }
              />
            ))
          ) : (
            <p className="xn-vacio-texto">Esta ficha aún no tiene clases.</p>
          )}
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            disabled={clases.length >= 150}
            onClick={() =>
              cambiarClases((actuales) => [
                ...actuales,
                claseNueva(`nueva-${++siguiente.current}`),
              ])
            }
          >
            <Plus size={17} aria-hidden="true" /> Agregar clase
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
            {ocupado ? 'Guardando…' : 'Guardar horario'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
