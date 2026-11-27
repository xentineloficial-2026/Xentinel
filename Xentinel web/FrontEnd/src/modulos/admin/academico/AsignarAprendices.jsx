/** Buscar aprendices y vincular varios a la ficha de una vez. Quien está en otra ficha se
 * traslada: la anterior queda en su historial. */
import './academico.css';
import { useMemo, useState } from 'react';
import { Search as Buscar } from 'lucide-react';
import { Dialogo } from '../../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../../compartido/componentes/MensajeEstado.jsx';
import { useRecurso } from '../../../compartido/ganchos/useRecurso.js';
import { solicitar } from '../../../compartido/servicios/cliente.js';
import { useRetardo, useRolAprendiz } from './utilidades.js';

function textoResultado(resultado) {
  const partes = [];
  const n = (lista) => lista.length;
  if (n(resultado.asignados))
    partes.push(
      `${n(resultado.asignados)} ${n(resultado.asignados) === 1 ? 'aprendiz asignado' : 'aprendices asignados'}`
    );
  if (n(resultado.trasladados))
    partes.push(`${n(resultado.trasladados)} trasladados desde otra ficha`);
  if (n(resultado.ya_estaban))
    partes.push(`${n(resultado.ya_estaban)} ya estaban en la ficha`);
  if (n(resultado.rechazados))
    partes.push(
      `${n(resultado.rechazados)} no se asignaron: ${resultado.rechazados
        .map((fila) => `${fila.nombre ?? fila.id_usuarios} (${fila.motivo})`)
        .join(', ')}`
    );
  return `${partes.join(' · ')}.`;
}

export function AsignarAprendices({ ficha, alCerrar, alGuardar }) {
  const [texto, cambiarTexto] = useState('');
  const buscar = useRetardo(texto.trim());
  const [elegidos, cambiarElegidos] = useState(() => new Map());
  const [estado, cambiarEstado] = useState({});
  const [ocupado, cambiarOcupado] = useState(false);
  const { id: rolAprendiz, roles } = useRolAprendiz();
  const consulta = rolAprendiz
    ? `/usuarios?${new URLSearchParams({
        id_rol: rolAprendiz,
        estado: 'Activo',
        limit: '50',
        ...(buscar && { buscar }),
      })}`
    : null;
  const candidatos = useRecurso(consulta);
  const enFicha = useMemo(
    () => new Set(ficha.aprendices.map((persona) => persona.id_usuarios)),
    [ficha.aprendices]
  );

  const alternar = (persona) =>
    cambiarElegidos((actual) => {
      const siguiente = new Map(actual);
      if (siguiente.has(persona.id_usuarios))
        siguiente.delete(persona.id_usuarios);
      else siguiente.set(persona.id_usuarios, persona);
      return siguiente;
    });

  async function asignar() {
    if (ocupado || !elegidos.size) return;
    cambiarOcupado(true);
    cambiarEstado({});
    try {
      const { data } = await solicitar(`/fichas/${ficha.id_ficha}/aprendices`, {
        method: 'POST',
        body: { ids: [...elegidos.keys()] },
      });
      alGuardar(data.ficha, textoResultado(data));
    } catch (error) {
      cambiarEstado({ error });
      cambiarOcupado(false);
    }
  }

  const lista = candidatos.datos ?? [];
  return (
    <Dialogo
      titulo={`Asignar aprendices a la ficha ${ficha.numero_ficha}`}
      alCerrar={alCerrar}
      ocupado={ocupado}
    >
      <div className="xn-asignar">
        <label className="xn-buscador" htmlFor="asignar-buscar">
          <Buscar size={17} aria-hidden="true" />
          <span className="xn-solo-lectores">Buscar aprendices</span>
          <input
            id="asignar-buscar"
            data-initial-focus
            type="search"
            value={texto}
            onChange={(evento) => cambiarTexto(evento.target.value)}
            placeholder="Nombre, documento o correo"
            autoComplete="off"
          />
        </label>
        {(roles.estado === 'error' || candidatos.estado === 'error') && (
          <MensajeEstado error={roles.error ?? candidatos.error} />
        )}
        <ul
          className="xn-asignar-lista"
          aria-busy={candidatos.estado === 'cargando'}
        >
          {lista.map((persona) => {
            const yaEsta = enFicha.has(persona.id_usuarios);
            const otraFicha =
              !yaEsta && persona.formacion?.id_ficha ? persona.formacion : null;
            return (
              <li key={persona.id_usuarios}>
                <label
                  className="xn-asignar-opcion"
                  data-deshabilitada={yaEsta}
                >
                  <input
                    type="checkbox"
                    disabled={yaEsta || ocupado}
                    checked={yaEsta || elegidos.has(persona.id_usuarios)}
                    onChange={() => alternar(persona)}
                  />
                  <span className="xn-asignar-persona">
                    <strong>{persona.nombres_completos}</strong>
                    <span className="xn-dato-id">
                      {persona.tipo_documento} {persona.numero_documento}
                    </span>
                  </span>
                  <span className="xn-asignar-formacion">
                    {yaEsta
                      ? 'Ya está en esta ficha'
                      : otraFicha
                        ? `En la ficha ${otraFicha.numero_ficha}: se trasladará`
                        : 'Sin ficha'}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {candidatos.estado === 'listo' && !lista.length && (
          <p className="xn-vacio-texto">
            {buscar
              ? `Ningún aprendiz activo coincide con «${buscar}».`
              : 'No hay aprendices activos. Inscríbelos desde la ficha o con la carga masiva.'}
          </p>
        )}
        {lista.length === 50 && (
          <p className="xn-ayuda">
            Se muestran los primeros 50. Escribe un nombre o documento para
            encontrar a alguien más.
          </p>
        )}
      </div>
      <MensajeEstado {...estado} />
      <div className="xn-dialogo-acciones">
        <span className="xn-asignar-cuenta" role="status">
          {elegidos.size
            ? `${elegidos.size} ${elegidos.size === 1 ? 'elegido' : 'elegidos'}`
            : 'Marca a quienes quieres asignar'}
        </span>
        <button
          type="button"
          className="xn-boton xn-boton--secundario"
          disabled={ocupado}
          onClick={alCerrar}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="xn-boton"
          disabled={ocupado || !elegidos.size}
          onClick={asignar}
        >
          {ocupado
            ? 'Asignando…'
            : `Asignar ${elegidos.size || ''} ${elegidos.size === 1 ? 'aprendiz' : 'aprendices'}`.replace(
                /\s+/g,
                ' '
              )}
        </button>
      </div>
    </Dialogo>
  );
}
