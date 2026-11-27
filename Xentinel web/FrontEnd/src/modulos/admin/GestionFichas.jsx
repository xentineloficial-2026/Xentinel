/** Fichas de la sede: buscar, filtrar por programa, crear y abrir el detalle de cada una. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileUp as Importar, Plus, Search as Buscar } from 'lucide-react';
import {
  EstadoConsulta,
  MensajeEstado,
} from '../../compartido/componentes/MensajeEstado.jsx';
import { Paginacion } from '../../compartido/componentes/TablaDatos.jsx';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { usePaginacion } from '../../compartido/utilidades/tablas.js';
import { useRetardo } from './academico/utilidades.js';
import { CargaMasiva } from './academico/CargaMasiva.jsx';
import { textoResumen } from './academico/utilidades.js';
import { DetalleFicha } from './academico/DetalleFicha.jsx';
import { EditorFicha } from './academico/EditorFicha.jsx';
import { FilaFicha } from './academico/FilaFicha.jsx';
import './academico/academico.css';
import './administrador.css';

export function GestionFichas() {
  const [parametros, cambiarParametros] = useSearchParams();
  const abierta = parametros.get('ficha');
  const paginacion = usePaginacion();
  const [texto, cambiarTexto] = useState('');
  const buscar = useRetardo(texto.trim());
  const [programa, cambiarPrograma] = useState(
    parametros.get('programa') ?? ''
  );
  const [dialogo, cambiarDialogo] = useState(null);
  const [aviso, cambiarAviso] = useState({});
  const programas = useRecurso('/programas?limit=100');
  const consulta = new URLSearchParams(paginacion.consulta);
  if (buscar) consulta.set('buscar', buscar);
  if (programa) consulta.set('id_programa', programa);
  const recurso = useRecurso(abierta ? null : `/fichas?${consulta}`);
  const fichas = recurso.datos ?? [];

  const abrir = (id) => {
    const siguiente = new URLSearchParams(parametros);
    siguiente.set('ficha', id);
    cambiarParametros(siguiente);
    window.scrollTo(0, 0);
  };
  const volver = (mensaje) => {
    const siguiente = new URLSearchParams(parametros);
    siguiente.delete('ficha');
    cambiarParametros(siguiente);
    cambiarAviso(mensaje ? { mensaje } : {});
  };

  if (abierta)
    return <DetalleFicha key={abierta} idFicha={abierta} alVolver={volver} />;

  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Fichas</h1>
          <p>
            Cada ficha es un grupo de aprendices de un programa, con su jornada,
            sus fechas y su horario.
          </p>
        </div>
        <div className="xn-admin-acciones">
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            onClick={() => cambiarDialogo('importar')}
          >
            <Importar size={17} aria-hidden="true" /> Carga masiva
          </button>
          <button
            type="button"
            className="xn-boton"
            onClick={() => cambiarDialogo('nueva')}
          >
            <Plus size={17} aria-hidden="true" /> Nueva ficha
          </button>
        </div>
      </div>
      <div className="xn-filtros-academicos">
        <label className="xn-buscador" htmlFor="fichas-buscar">
          <Buscar size={17} aria-hidden="true" />
          <span className="xn-solo-lectores">Buscar fichas</span>
          <input
            id="fichas-buscar"
            type="search"
            value={texto}
            onChange={(evento) => {
              cambiarTexto(evento.target.value);
              paginacion.cambiarPagina(1);
            }}
            placeholder="Número, nombre o programa"
            autoComplete="off"
          />
        </label>
        <div className="xn-campo xn-campo--en-linea">
          <label htmlFor="fichas-programa">Programa</label>
          <select
            id="fichas-programa"
            value={programa}
            onChange={(evento) => {
              cambiarPrograma(evento.target.value);
              paginacion.cambiarPagina(1);
            }}
          >
            <option value="">Todos los programas</option>
            {programas.datos?.map((opcion) => (
              <option key={opcion.id_programa} value={opcion.id_programa}>
                {opcion.nombre_programa}
              </option>
            ))}
          </select>
        </div>
      </div>
      <MensajeEstado {...aviso} />
      <EstadoConsulta recurso={recurso}>
        {fichas.length ? (
          <ul className="xn-lista-fichas" aria-label="Fichas">
            {fichas.map((ficha) => (
              <FilaFicha
                key={ficha.id_ficha}
                ficha={ficha}
                alAbrir={() => abrir(ficha.id_ficha)}
              />
            ))}
          </ul>
        ) : (
          <div className="xn-vacio xn-trabajo-tarjeta">
            <h3>
              {buscar || programa
                ? 'Ninguna ficha coincide con la búsqueda'
                : 'Todavía no hay fichas'}
            </h3>
            <p>
              {buscar || programa
                ? 'Prueba con otro número o elige todos los programas.'
                : 'Crea la primera ficha y asígnale sus aprendices.'}
            </p>
          </div>
        )}
        <Paginacion paginacion={paginacion} cantidad={fichas.length} />
      </EstadoConsulta>
      {dialogo === 'nueva' && (
        <EditorFicha
          programaInicial={programa || undefined}
          alCerrar={() => cambiarDialogo(null)}
          alGuardar={(ficha) => {
            cambiarDialogo(null);
            abrir(ficha.id_ficha);
          }}
        />
      )}
      {dialogo === 'importar' && (
        <CargaMasiva
          alCerrar={() => cambiarDialogo(null)}
          alImportar={(resumen) => {
            cambiarAviso({ mensaje: `${textoResumen(resumen, false)}.` });
            recurso.actualizar();
          }}
        />
      )}
    </>
  );
}
