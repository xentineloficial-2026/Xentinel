/** El administrador define la jornada vigente de una ficha; la asistencia ya registrada no cambia. */
import { useState as useEstado } from 'react';
import { Dialogo } from '../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../compartido/componentes/MensajeEstado.jsx';
import { solicitar } from '../../compartido/servicios/cliente.js';

const HORAS_SUGERIDAS = {
  Mañana: ['06:00', '12:00'],
  Tarde: ['12:00', '18:00'],
  Noche: ['18:00', '22:00'],
  Mixta: ['06:00', '18:00'],
};

export function EditorJornada({ ficha, alCerrar, alGuardar }) {
  const inicial = HORAS_SUGERIDAS[ficha.jornada] ? ficha.jornada : 'Mañana';
  const [nombre, cambiarNombre] = useEstado(inicial);
  const [inicio, cambiarInicio] = useEstado(
    ficha.hora_inicio?.slice(0, 5) || HORAS_SUGERIDAS[inicial][0]
  );
  const [fin, cambiarFin] = useEstado(
    ficha.hora_fin?.slice(0, 5) || HORAS_SUGERIDAS[inicial][1]
  );
  const [error, cambiarError] = useEstado(null);
  const [guardando, cambiarGuardando] = useEstado(false);

  const elegirJornada = (valor) => {
    cambiarNombre(valor);
    cambiarInicio(HORAS_SUGERIDAS[valor][0]);
    cambiarFin(HORAS_SUGERIDAS[valor][1]);
  };
  const enviar = async (evento) => {
    evento.preventDefault();
    if (guardando) return;
    if (!inicio || !fin || fin <= inicio) {
      cambiarError('La hora de fin debe ser posterior a la de inicio.');
      return;
    }
    cambiarError(null);
    cambiarGuardando(true);
    try {
      await solicitar(`/fichas/${ficha.id_ficha}/jornada`, {
        method: 'PUT',
        body: { nombre, hora_inicio: inicio, hora_fin: fin },
      });
      alGuardar();
    } catch (motivo) {
      cambiarError(motivo);
      cambiarGuardando(false);
    }
  };

  return (
    <Dialogo
      titulo={`Jornada de la ficha ${ficha.numero_ficha}`}
      alCerrar={alCerrar}
      ocupado={guardando}
    >
      <form noValidate onSubmit={enviar}>
        <p>
          Se aplica desde el próximo escaneo. La asistencia ya registrada
          conserva su estado.
        </p>
        <div className="xn-lista-filtros">
          <div className="xn-campo">
            <label htmlFor="jornada-nombre">Jornada</label>
            <select
              id="jornada-nombre"
              data-initial-focus
              value={nombre}
              onChange={(evento) => elegirJornada(evento.target.value)}
            >
              {Object.keys(HORAS_SUGERIDAS).map((opcion) => (
                <option key={opcion}>{opcion}</option>
              ))}
            </select>
          </div>
          <div className="xn-campo">
            <label htmlFor="jornada-inicio">Hora de inicio</label>
            <input
              id="jornada-inicio"
              type="time"
              required
              value={inicio}
              onChange={(evento) => cambiarInicio(evento.target.value)}
            />
          </div>
          <div className="xn-campo">
            <label htmlFor="jornada-fin">Hora de fin</label>
            <input
              id="jornada-fin"
              type="time"
              required
              value={fin}
              onChange={(evento) => cambiarFin(evento.target.value)}
            />
          </div>
        </div>
        <MensajeEstado error={error} />
        <div className="xn-dialogo-acciones">
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            disabled={guardando}
            onClick={alCerrar}
          >
            Cancelar
          </button>
          <button className="xn-boton" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar jornada'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
