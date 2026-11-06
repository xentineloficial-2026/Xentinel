/** Catálogo de administración con estados separados y detalle bajo demanda. */
import { useId, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { Dialogo } from '../../compartido/componentes/Dialogo.jsx';
import {
  EstadoConsulta,
  MensajeEstado,
} from '../../compartido/componentes/MensajeEstado.jsx';
import { Paginacion } from '../../compartido/componentes/TablaDatos.jsx';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { solicitar } from '../../compartido/servicios/cliente.js';
import { usePaginacion } from '../../compartido/utilidades/tablas.js';
import { EditorPrograma } from './EditorPrograma.jsx';
import { ExportarHorarios } from './ExportarHorarios.jsx';
import './administrador.css';

function HorarioDesplegable({ horario }) {
  return (
    <details className="xn-admin-horario-detalle">
      <summary>
        {horario.nombre_clase} · {horario.dia_semana}{' '}
        {horario.hora_inicio.slice(0, 5)}
      </summary>
      <dl className="xn-admin-datos">
        <dt>Día</dt>
        <dd>{horario.dia_semana}</dd>
        <dt>Hora</dt>
        <dd>
          {horario.hora_inicio.slice(0, 5)}–{horario.hora_fin.slice(0, 5)}
        </dd>
        <dt>Entorno</dt>
        <dd>{horario.ambiente || 'Sin asignar'}</dd>
        <dt>Instructor</dt>
        <dd>{horario.instructor || `ID ${horario.id_instructor}`}</dd>
      </dl>
    </details>
  );
}

function DetallePrograma({ programa, alEditar, alCambiarEstado }) {
  const recurso = useRecurso(`/programas/${programa.id_programa}`);
  const detalle = recurso.datos;
  return (
    <EstadoConsulta recurso={recurso}>
      {detalle && (
        <>
          <div className="xn-admin-detalle-cabecera">
            <h3>Información del programa</h3>
            <div className="xn-admin-acciones">
              <button
                className="xn-boton xn-boton--secundario"
                onClick={() => alEditar(detalle)}
              >
                Editar
              </button>
              <button
                className={`xn-boton ${detalle.activo ? 'xn-boton--peligro' : ''}`}
                onClick={() => alCambiarEstado(detalle)}
              >
                {detalle.activo ? 'Desactivar' : 'Reactivar'}
              </button>
            </div>
          </div>
          <dl className="xn-admin-datos">
            <dt>Nivel</dt>
            <dd>{detalle.nivel_programa || 'Sin nivel registrado'}</dd>
            <dt>Estado</dt>
            <dd>{detalle.activo ? 'Activo' : 'Desactivado'}</dd>
            <dt>Fichas</dt>
            <dd>{detalle.fichas.length}</dd>
          </dl>
          {detalle.fichas.length ? (
            <ul className="xn-admin-lista">
              {detalle.fichas.map((ficha) => (
                <li key={ficha.id_ficha}>
                  <details>
                    <summary>
                      Ficha {ficha.numero_ficha} · {ficha.horarios.length}{' '}
                      horarios
                    </summary>
                    {ficha.horarios.length ? (
                      <ul className="xn-admin-lista xn-admin-lista--anidada">
                        {ficha.horarios.map((horario) => (
                          <li key={horario.id_horario}>
                            <HorarioDesplegable horario={horario} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No hay horarios asignados a esta ficha.</p>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p>No hay fichas asociadas a este programa.</p>
          )}
          {detalle.fichas.some((ficha) => ficha.horarios.length > 0) && (
            <ExportarHorarios programa={detalle} />
          )}
        </>
      )}
    </EstadoConsulta>
  );
}

function TarjetaPrograma({
  programa,
  abierta,
  alAbrir,
  alEditar,
  alCambiarEstado,
}) {
  const identificador = useId();
  return (
    <article className="xn-tarjeta-academica xn-admin-programa">
      <h2>
        <button
          className="xn-admin-programa-selector"
          aria-expanded={abierta}
          aria-controls={identificador}
          onClick={alAbrir}
        >
          <span>
            <small>{programa.nivel_programa || 'PROGRAMA DE FORMACIÓN'}</small>
            {programa.nombre_programa}
          </span>
          <ChevronDown size={19} aria-hidden="true" />
        </button>
      </h2>
      <div
        id={identificador}
        className="xn-admin-programa-detalle"
        hidden={!abierta}
      >
        {abierta && (
          <DetallePrograma
            programa={programa}
            alEditar={alEditar}
            alCambiarEstado={alCambiarEstado}
          />
        )}
      </div>
    </article>
  );
}

export function GestionProgramas() {
  const paginacion = usePaginacion();
  const [activo, cambiarActivo] = useState(true);
  const [seleccion, cambiarSeleccion] = useState(null);
  const [editor, cambiarEditor] = useState(null);
  const [confirmacion, cambiarConfirmacion] = useState(null);
  const [ocupado, cambiarOcupado] = useState(false);
  const [estado, cambiarEstado] = useState({});
  const [errorConfirmacion, cambiarErrorConfirmacion] = useState(null);
  const enviando = useRef(false);
  const recurso = useRecurso(
    `/programas?activo=${activo}&${paginacion.consulta}`
  );
  const programas = recurso.datos ?? [];

  function actualizar({ volverAlInicio = false } = {}) {
    if (volverAlInicio) paginacion.cambiarPagina(1);
    recurso.actualizar();
  }

  async function confirmarEstado() {
    if (enviando.current) return;
    enviando.current = true;
    cambiarOcupado(true);
    cambiarErrorConfirmacion(null);
    try {
      await solicitar(`/programas/${confirmacion.id_programa}`, {
        method: 'PATCH',
        body: { activo: !confirmacion.activo },
      });
      cambiarEstado({
        mensaje: confirmacion.activo
          ? 'Programa desactivado. Se conservaron sus fichas y horarios.'
          : 'Programa reactivado.',
      });
      cambiarConfirmacion(null);
      cambiarSeleccion(null);
      actualizar({ volverAlInicio: true });
    } catch (error) {
      cambiarErrorConfirmacion(error);
    } finally {
      enviando.current = false;
      cambiarOcupado(false);
    }
  }

  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Programas de formación</h1>
          <p>Organiza las fichas, horarios y entornos de cada programa.</p>
        </div>
        <div className="xn-admin-acciones">
          <button
            className="xn-boton xn-boton--secundario"
            onClick={() => actualizar()}
          >
            Actualizar
          </button>
          <button
            className="xn-boton"
            onClick={() => cambiarEditor({ programa: null })}
          >
            <Plus size={17} /> Crear programa
          </button>
        </div>
      </div>
      <div
        className="xn-admin-filtros"
        role="group"
        aria-label="Estado de los programas"
      >
        {[
          [true, 'Activos'],
          [false, 'Desactivados'],
        ].map(([valor, etiqueta]) => (
          <button
            key={etiqueta}
            className="xn-boton xn-boton--secundario"
            aria-pressed={activo === valor}
            onClick={() => {
              if (activo === valor) return;
              cambiarActivo(valor);
              cambiarSeleccion(null);
              cambiarEstado({});
              paginacion.cambiarPagina(1);
            }}
          >
            {etiqueta}
          </button>
        ))}
      </div>
      <MensajeEstado {...estado} />
      <EstadoConsulta recurso={recurso}>
        <div className="xn-admin-programas">
          {programas.map((programa) => (
            <TarjetaPrograma
              key={programa.id_programa}
              programa={programa}
              abierta={seleccion === programa.id_programa}
              alAbrir={() =>
                cambiarSeleccion(
                  seleccion === programa.id_programa
                    ? null
                    : programa.id_programa
                )
              }
              alEditar={(detalle) => cambiarEditor({ programa: detalle })}
              alCambiarEstado={(detalle) => {
                cambiarErrorConfirmacion(null);
                cambiarConfirmacion(detalle);
              }}
            />
          ))}
        </div>
        {!programas.length && (
          <p className="xn-trabajo-tarjeta">
            No hay programas {activo ? 'activos' : 'desactivados'} en esta
            página.
          </p>
        )}
        <Paginacion paginacion={paginacion} cantidad={programas.length} />
      </EstadoConsulta>
      {editor && (
        <EditorPrograma
          programa={editor.programa}
          alCerrar={() => cambiarEditor(null)}
          alGuardar={() => {
            if (!editor.programa) {
              cambiarActivo(true);
              cambiarSeleccion(null);
            }
            cambiarEditor(null);
            cambiarEstado({ mensaje: 'Programa guardado correctamente.' });
            actualizar({ volverAlInicio: !editor.programa });
          }}
        />
      )}
      {confirmacion && (
        <Dialogo
          titulo={
            confirmacion.activo ? 'Desactivar programa' : 'Reactivar programa'
          }
          ocupado={ocupado}
          alCerrar={() => cambiarConfirmacion(null)}
        >
          <p>
            ¿{confirmacion.activo ? 'Desactivar' : 'Reactivar'}{' '}
            <strong>{confirmacion.nombre_programa}</strong>? Sus fichas y
            horarios se conservarán.
          </p>
          <MensajeEstado error={errorConfirmacion} />
          <div className="xn-dialogo-acciones">
            <button
              className="xn-boton xn-boton--secundario"
              data-initial-focus
              disabled={ocupado}
              onClick={() => cambiarConfirmacion(null)}
            >
              Cancelar
            </button>
            <button
              className={`xn-boton ${confirmacion.activo ? 'xn-boton--peligro' : ''}`}
              disabled={ocupado}
              onClick={confirmarEstado}
            >
              {ocupado
                ? 'Guardando…'
                : confirmacion.activo
                  ? 'Desactivar programa'
                  : 'Reactivar programa'}
            </button>
          </div>
        </Dialogo>
      )}
    </>
  );
}
