/** Crear o editar una ficha: número, nombre, programa, jornada, modalidad y fechas. */
import './academico.css';
import { useState } from 'react';
import { Dialogo } from '../../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../../compartido/componentes/MensajeEstado.jsx';
import { useRecurso } from '../../../compartido/ganchos/useRecurso.js';
import { solicitar } from '../../../compartido/servicios/cliente.js';
import { JornadaRegla } from './JornadaRegla.jsx';
import { JORNADAS } from './utilidades.js';

export function EditorFicha({ ficha, programaInicial, alCerrar, alGuardar }) {
  const [datos, cambiarDatos] = useState(() => ({
    numero_ficha: ficha?.numero_ficha ?? '',
    nombre_ficha: ficha?.nombre_ficha ?? '',
    id_programa: String(ficha?.id_programa ?? programaInicial ?? ''),
    jornada: ficha?.jornada && JORNADAS[ficha.jornada] ? ficha.jornada : '',
    hora_inicio: ficha?.hora_inicio?.slice(0, 5) ?? '',
    hora_fin: ficha?.hora_fin?.slice(0, 5) ?? '',
    modalidad: ficha?.modalidad ?? 'Presencial',
    fecha_inicio: ficha?.fecha_inicio?.slice(0, 10) ?? '',
    fecha_fin: ficha?.fecha_fin?.slice(0, 10) ?? '',
  }));
  const [estado, cambiarEstado] = useState({});
  const [ocupado, cambiarOcupado] = useState(false);
  const programas = useRecurso('/programas?activo=true&limit=100');
  const cambiar = (campo) => (evento) =>
    cambiarDatos((actual) => ({ ...actual, [campo]: evento.target.value }));

  async function guardar(evento) {
    evento.preventDefault();
    if (ocupado) return;
    if (datos.jornada && datos.hora_fin <= datos.hora_inicio) {
      cambiarEstado({
        error:
          'La hora de fin de la jornada debe ser posterior a la de inicio.',
      });
      return;
    }
    if (
      datos.fecha_inicio &&
      datos.fecha_fin &&
      datos.fecha_fin < datos.fecha_inicio
    ) {
      cambiarEstado({
        error: 'La fecha de fin debe ser posterior a la de inicio.',
      });
      return;
    }
    cambiarOcupado(true);
    cambiarEstado({});
    try {
      const { data } = await solicitar(
        ficha ? `/fichas/${ficha.id_ficha}` : '/fichas',
        {
          method: ficha ? 'PATCH' : 'POST',
          body: {
            numero_ficha: datos.numero_ficha.trim(),
            nombre_ficha: datos.nombre_ficha.trim() || null,
            id_programa: Number(datos.id_programa),
            jornada: datos.jornada || null,
            hora_inicio: datos.jornada ? datos.hora_inicio : null,
            hora_fin: datos.jornada ? datos.hora_fin : null,
            modalidad: datos.modalidad || null,
            fecha_inicio: datos.fecha_inicio || null,
            fecha_fin: datos.fecha_fin || null,
          },
        }
      );
      alGuardar(data);
    } catch (error) {
      cambiarEstado({ error });
      cambiarOcupado(false);
    }
  }

  const programaActual =
    ficha &&
    !programas.datos?.some(
      (programa) => String(programa.id_programa) === String(ficha.id_programa)
    );

  return (
    <Dialogo
      titulo={ficha ? `Editar ficha ${ficha.numero_ficha}` : 'Nueva ficha'}
      alCerrar={alCerrar}
      ocupado={ocupado}
    >
      <form onSubmit={guardar}>
        <fieldset className="xn-admin-campos" disabled={ocupado}>
          <div className="xn-formulario-cuadricula">
            <div className="xn-campo">
              <label htmlFor="ficha-numero">Número de ficha</label>
              <input
                id="ficha-numero"
                required
                data-initial-focus
                maxLength={15}
                pattern="[A-Za-z0-9\-]+"
                inputMode="numeric"
                value={datos.numero_ficha}
                onChange={cambiar('numero_ficha')}
                placeholder="Ej. 2675859"
              />
            </div>
            <div className="xn-campo">
              <label htmlFor="ficha-nombre">Nombre (opcional)</label>
              <input
                id="ficha-nombre"
                maxLength={150}
                value={datos.nombre_ficha}
                onChange={cambiar('nombre_ficha')}
                placeholder="Ej. ADSO 2026 mañana"
              />
            </div>
            <div className="xn-campo xn-campo--ancho">
              <label htmlFor="ficha-programa">Programa de formación</label>
              <select
                id="ficha-programa"
                required
                value={datos.id_programa}
                onChange={cambiar('id_programa')}
              >
                <option value="">Elige el programa</option>
                {programaActual && (
                  <option value={ficha.id_programa}>
                    {ficha.nombre_programa} (desactivado)
                  </option>
                )}
                {programas.datos?.map((programa) => (
                  <option
                    key={programa.id_programa}
                    value={programa.id_programa}
                  >
                    {programa.nombre_programa}
                  </option>
                ))}
              </select>
              {programas.estado === 'listo' && !programas.datos.length && (
                <p className="xn-ayuda">
                  Primero crea un programa en el módulo Programas.
                </p>
              )}
            </div>
          </div>
          <fieldset className="xn-jornada-editor">
            <legend>Jornada</legend>
            <div className="xn-formulario-cuadricula">
              <div className="xn-campo">
                <label htmlFor="ficha-jornada">Jornada</label>
                <select
                  id="ficha-jornada"
                  value={datos.jornada}
                  onChange={(evento) => {
                    const jornada = evento.target.value;
                    const [inicio, fin] = JORNADAS[jornada] ?? ['', ''];
                    cambiarDatos((actual) => ({
                      ...actual,
                      jornada,
                      hora_inicio: jornada ? actual.hora_inicio || inicio : '',
                      hora_fin: jornada ? actual.hora_fin || fin : '',
                    }));
                  }}
                >
                  <option value="">Sin definir</option>
                  {Object.keys(JORNADAS).map((jornada) => (
                    <option key={jornada}>{jornada}</option>
                  ))}
                </select>
              </div>
              <div className="xn-campo">
                <label htmlFor="ficha-inicio">Hora de inicio</label>
                <input
                  id="ficha-inicio"
                  type="time"
                  required={!!datos.jornada}
                  disabled={!datos.jornada}
                  value={datos.hora_inicio}
                  onChange={cambiar('hora_inicio')}
                />
              </div>
              <div className="xn-campo">
                <label htmlFor="ficha-fin">Hora de fin</label>
                <input
                  id="ficha-fin"
                  type="time"
                  required={!!datos.jornada}
                  disabled={!datos.jornada}
                  value={datos.hora_fin}
                  onChange={cambiar('hora_fin')}
                />
              </div>
            </div>
            <JornadaRegla
              nombre={datos.jornada}
              inicio={datos.jornada && datos.hora_inicio}
              fin={datos.jornada && datos.hora_fin}
            />
            <p className="xn-ayuda">
              Quien entra después de la hora de inicio queda con «Retardo».
            </p>
          </fieldset>
          <div className="xn-formulario-cuadricula xn-formulario-cuadricula--tres">
            <div className="xn-campo">
              <label htmlFor="ficha-modalidad">Modalidad</label>
              <select
                id="ficha-modalidad"
                value={datos.modalidad}
                onChange={cambiar('modalidad')}
              >
                <option>Presencial</option>
                <option>Virtual</option>
                <option>Mixta</option>
              </select>
            </div>
            <div className="xn-campo">
              <label htmlFor="ficha-desde">Inicio de la formación</label>
              <input
                id="ficha-desde"
                type="date"
                value={datos.fecha_inicio}
                onChange={cambiar('fecha_inicio')}
              />
            </div>
            <div className="xn-campo">
              <label htmlFor="ficha-hasta">Fin de la formación</label>
              <input
                id="ficha-hasta"
                type="date"
                min={datos.fecha_inicio || undefined}
                value={datos.fecha_fin}
                onChange={cambiar('fecha_fin')}
              />
            </div>
          </div>
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
          <button className="xn-boton" disabled={ocupado}>
            {ocupado ? 'Guardando…' : ficha ? 'Guardar cambios' : 'Crear ficha'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
