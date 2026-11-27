/** Datos del programa de formación. Las fichas, sus aprendices y su horario se gestionan
 * desde cada ficha. */
import { useState } from 'react';
import { Dialogo } from '../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../compartido/componentes/MensajeEstado.jsx';
import { solicitar } from '../../compartido/servicios/cliente.js';

const NIVELES = [
  'Técnico',
  'Tecnólogo',
  'Operario',
  'Auxiliar',
  'Especialización tecnológica',
  'Curso complementario',
];

export function EditorPrograma({ programa, alCerrar, alGuardar }) {
  const [nombre, cambiarNombre] = useState(programa?.nombre_programa ?? '');
  const [nivel, cambiarNivel] = useState(programa?.nivel_programa ?? '');
  const [estado, cambiarEstado] = useState({});
  const [ocupado, cambiarOcupado] = useState(false);

  async function guardar(evento) {
    evento.preventDefault();
    if (ocupado) return;
    cambiarOcupado(true);
    cambiarEstado({});
    try {
      const { data } = await solicitar(
        programa ? `/programas/${programa.id_programa}` : '/programas',
        {
          method: programa ? 'PATCH' : 'POST',
          body: {
            nombre_programa: nombre.trim(),
            nivel_programa: nivel.trim() || null,
          },
        }
      );
      alGuardar(data);
    } catch (error) {
      cambiarEstado({ error });
      cambiarOcupado(false);
    }
  }

  return (
    <Dialogo
      titulo={programa ? 'Editar programa' : 'Nuevo programa de formación'}
      alCerrar={alCerrar}
      ocupado={ocupado}
    >
      <form onSubmit={guardar}>
        <fieldset className="xn-admin-campos" disabled={ocupado}>
          <div className="xn-campo">
            <label htmlFor="programa-nombre">Nombre del programa</label>
            <input
              id="programa-nombre"
              required
              data-initial-focus
              maxLength={150}
              value={nombre}
              onChange={(evento) => cambiarNombre(evento.target.value)}
              placeholder="Ej. Análisis y desarrollo de software"
            />
          </div>
          <div className="xn-campo">
            <label htmlFor="programa-nivel">Nivel de formación</label>
            <input
              id="programa-nivel"
              list="programa-niveles"
              maxLength={50}
              value={nivel}
              onChange={(evento) => cambiarNivel(evento.target.value)}
              placeholder="Elige o escribe un nivel"
            />
            <datalist id="programa-niveles">
              {NIVELES.map((opcion) => (
                <option key={opcion} value={opcion} />
              ))}
            </datalist>
          </div>
          {!programa && (
            <p className="xn-ayuda">
              Después de crearlo, agrega sus fichas: cada ficha es un grupo con
              su jornada, sus fechas, sus aprendices y su horario.
            </p>
          )}
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
          <button className="xn-boton" disabled={ocupado || !nombre.trim()}>
            {ocupado
              ? 'Guardando…'
              : programa
                ? 'Guardar cambios'
                : 'Crear programa'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
