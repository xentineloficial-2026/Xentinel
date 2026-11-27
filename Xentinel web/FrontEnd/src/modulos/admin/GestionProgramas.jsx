/** Programas de formación: la lista a la izquierda y, al elegir uno, sus fichas a la derecha. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pencil as Editar,
  Plus,
  Search as Buscar,
  X as Cerrar,
} from 'lucide-react';
import { Dialogo } from '../../compartido/componentes/Dialogo.jsx';
import {
  EstadoConsulta,
  MensajeEstado,
} from '../../compartido/componentes/MensajeEstado.jsx';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { solicitar } from '../../compartido/servicios/cliente.js';
import { EditorFicha } from './academico/EditorFicha.jsx';
import { FilaFicha } from './academico/FilaFicha.jsx';
import { EditorPrograma } from './EditorPrograma.jsx';
import { ExportarHorarios } from './ExportarHorarios.jsx';
import './academico/academico.css';
import './administrador.css';

const CLAVE_GUIA = 'xentinel:guia-formacion-oculta';

function leerGuiaOculta() {
  try {
    return localStorage.getItem(CLAVE_GUIA) === '1';
  } catch {
    return false;
  }
}

/** Cómo se organiza la formación: programa, ficha, aprendices y horario. */
function GuiaFormacion() {
  const [oculta, cambiarOculta] = useState(leerGuiaOculta);
  if (oculta) return null;
  return (
    <section className="xn-guia-formacion" aria-labelledby="guia-formacion">
      <div className="xn-guia-formacion-cabecera">
        <h2 id="guia-formacion">Cómo se organiza la formación</h2>
        <button
          type="button"
          className="xn-icono-boton"
          aria-label="Ocultar la guía"
          onClick={() => {
            cambiarOculta(true);
            try {
              localStorage.setItem(CLAVE_GUIA, '1');
            } catch {
              /* Sin almacenamiento: se vuelve a mostrar al recargar. */
            }
          }}
        >
          <Cerrar size={18} aria-hidden="true" />
        </button>
      </div>
      <ol>
        <li>
          <strong>Programa</strong>
          <span>
            Lo que se estudia, por ejemplo Análisis y desarrollo de software.
          </span>
        </li>
        <li>
          <strong>Ficha</strong>
          <span>
            Un grupo del programa con su número, su jornada y sus fechas.
          </span>
        </li>
        <li>
          <strong>Aprendices y horario</strong>
          <span>
            Quiénes estudian en la ficha y sus clases de la semana. Con eso se
            calcula la asistencia.
          </span>
        </li>
      </ol>
    </section>
  );
}

function DetallePrograma({
  id,
  alEditar,
  alCambiarEstado,
  alEliminar,
  version,
}) {
  const navegar = useNavigate();
  const recurso = useRecurso(`/programas/${id}?v=${version}`);
  const [nuevaFicha, cambiarNuevaFicha] = useState(false);
  const programa = recurso.datos;
  const abrirFicha = (ficha) => navegar(`/admin/fichas?ficha=${ficha}`);
  return (
    <EstadoConsulta recurso={recurso}>
      {programa && (
        <article
          className="xn-programa-detalle"
          aria-labelledby="programa-elegido"
        >
          <header className="xn-programa-cabecera">
            <div>
              <p className="xn-programa-nivel">
                {programa.nivel_programa || 'Programa de formación'}
                {!programa.activo && (
                  <span className="xn-estado es-neutro">Desactivado</span>
                )}
              </p>
              <h2 id="programa-elegido">{programa.nombre_programa}</h2>
            </div>
            <div className="xn-admin-acciones">
              <button
                type="button"
                className="xn-boton xn-boton--secundario"
                onClick={() => alEditar(programa)}
              >
                <Editar size={16} aria-hidden="true" /> Editar
              </button>
              <button
                type="button"
                className={`xn-boton ${programa.activo ? 'xn-boton--peligro-suave' : 'xn-boton--secundario'}`}
                onClick={() => alCambiarEstado(programa)}
              >
                {programa.activo ? 'Desactivar' : 'Reactivar'}
              </button>
              {!programa.fichas.length && (
                <button
                  type="button"
                  className="xn-boton xn-boton--peligro-suave"
                  onClick={() => alEliminar(programa)}
                >
                  Eliminar
                </button>
              )}
            </div>
          </header>
          <div className="xn-programa-fichas-titulo">
            <h3>
              {programa.fichas.length === 1
                ? '1 ficha'
                : `${programa.fichas.length} fichas`}
            </h3>
            {programa.activo && (
              <button
                type="button"
                className="xn-boton"
                onClick={() => cambiarNuevaFicha(true)}
              >
                <Plus size={17} aria-hidden="true" /> Nueva ficha
              </button>
            )}
          </div>
          {programa.fichas.length ? (
            <ul className="xn-lista-fichas xn-lista-fichas--programa">
              {programa.fichas.map((ficha) => (
                <FilaFicha
                  key={ficha.id_ficha}
                  ficha={ficha}
                  mostrarPrograma={false}
                  alAbrir={() => abrirFicha(ficha.id_ficha)}
                />
              ))}
            </ul>
          ) : (
            <div className="xn-vacio">
              <h3>Este programa aún no tiene fichas</h3>
              <p>
                Crea una ficha por cada grupo: número, jornada y fechas. Luego
                le asignas sus aprendices y su horario.
              </p>
            </div>
          )}
          {programa.fichas.some((ficha) => ficha.horarios.length > 0) && (
            <div className="xn-programa-exportar">
              <h3>Horarios del programa</h3>
              <ExportarHorarios programa={programa} />
            </div>
          )}
          {nuevaFicha && (
            <EditorFicha
              programaInicial={programa.id_programa}
              alCerrar={() => cambiarNuevaFicha(false)}
              alGuardar={(ficha) => abrirFicha(ficha.id_ficha)}
            />
          )}
        </article>
      )}
    </EstadoConsulta>
  );
}

export function GestionProgramas() {
  const [activo, cambiarActivo] = useState(true);
  const [texto, cambiarTexto] = useState('');
  const [seleccion, cambiarSeleccion] = useState(null);
  const [version, cambiarVersion] = useState(0);
  const [editor, cambiarEditor] = useState(null);
  const [confirmacion, cambiarConfirmacion] = useState(null);
  const [ocupado, cambiarOcupado] = useState(false);
  const [aviso, cambiarAviso] = useState({});
  const [errorConfirmacion, cambiarErrorConfirmacion] = useState(null);
  const detalle = useRef(null);
  const recurso = useRecurso(`/programas?activo=${activo}&limit=100`);
  const filtro = texto.trim().toLowerCase();
  const programas = (recurso.datos ?? []).filter(
    (programa) =>
      !filtro ||
      programa.nombre_programa.toLowerCase().includes(filtro) ||
      (programa.nivel_programa ?? '').toLowerCase().includes(filtro)
  );
  const elegido = programas.some(
    (programa) => programa.id_programa === seleccion
  )
    ? seleccion
    : null;

  useEffect(() => {
    if (elegido && window.matchMedia('(max-width: 960px)').matches)
      detalle.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [elegido]);

  const refrescar = () => {
    recurso.actualizar();
    cambiarVersion((actual) => actual + 1);
  };

  async function confirmar() {
    if (ocupado) return;
    cambiarOcupado(true);
    cambiarErrorConfirmacion(null);
    const { programa, tipo } = confirmacion;
    try {
      if (tipo === 'eliminar') {
        await solicitar(`/programas/${programa.id_programa}`, {
          method: 'DELETE',
        });
        cambiarSeleccion(null);
        cambiarAviso({
          mensaje: `Programa «${programa.nombre_programa}» eliminado.`,
        });
      } else {
        await solicitar(`/programas/${programa.id_programa}`, {
          method: 'PATCH',
          body: { activo: !programa.activo },
        });
        cambiarSeleccion(null);
        cambiarAviso({
          mensaje: programa.activo
            ? 'Programa desactivado. Sus fichas y horarios se conservan.'
            : 'Programa reactivado.',
        });
      }
      cambiarConfirmacion(null);
      refrescar();
    } catch (error) {
      cambiarErrorConfirmacion(error);
    } finally {
      cambiarOcupado(false);
    }
  }

  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Programas de formación</h1>
          <p>Elige un programa para ver y organizar sus fichas.</p>
        </div>
        <button
          type="button"
          className="xn-boton"
          onClick={() => cambiarEditor({ programa: null })}
        >
          <Plus size={17} aria-hidden="true" /> Nuevo programa
        </button>
      </div>
      <GuiaFormacion />
      <MensajeEstado {...aviso} />
      <div className="xn-academico">
        <aside className="xn-academico-lista" aria-label="Programas">
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
                type="button"
                className="xn-boton xn-boton--secundario"
                aria-pressed={activo === valor}
                onClick={() => {
                  cambiarActivo(valor);
                  cambiarSeleccion(null);
                  cambiarAviso({});
                }}
              >
                {etiqueta}
              </button>
            ))}
          </div>
          <label className="xn-buscador" htmlFor="programas-buscar">
            <Buscar size={17} aria-hidden="true" />
            <span className="xn-solo-lectores">Buscar programas</span>
            <input
              id="programas-buscar"
              type="search"
              value={texto}
              onChange={(evento) => cambiarTexto(evento.target.value)}
              placeholder="Buscar programa"
              autoComplete="off"
            />
          </label>
          <EstadoConsulta recurso={recurso}>
            {programas.length ? (
              <ul className="xn-programas-lista">
                {programas.map((programa) => (
                  <li key={programa.id_programa}>
                    <button
                      type="button"
                      className="xn-programa-opcion"
                      aria-current={
                        elegido === programa.id_programa || undefined
                      }
                      onClick={() => cambiarSeleccion(programa.id_programa)}
                    >
                      <strong>{programa.nombre_programa}</strong>
                      <span>
                        {programa.nivel_programa &&
                          `${programa.nivel_programa} · `}
                        {programa.total_fichas ?? 0}{' '}
                        {programa.total_fichas === 1 ? 'ficha' : 'fichas'} ·{' '}
                        {programa.total_aprendices ?? 0}{' '}
                        {programa.total_aprendices === 1
                          ? 'aprendiz'
                          : 'aprendices'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="xn-vacio-texto">
                {filtro
                  ? `Ningún programa coincide con «${texto.trim()}».`
                  : activo
                    ? 'No hay programas activos. Crea el primero.'
                    : 'No hay programas desactivados.'}
              </p>
            )}
          </EstadoConsulta>
        </aside>
        <section
          className="xn-academico-detalle"
          ref={detalle}
          aria-live="polite"
        >
          {elegido ? (
            <DetallePrograma
              key={elegido}
              id={elegido}
              version={version}
              alEditar={(programa) => cambiarEditor({ programa })}
              alCambiarEstado={(programa) => {
                cambiarErrorConfirmacion(null);
                cambiarConfirmacion({ programa, tipo: 'estado' });
              }}
              alEliminar={(programa) => {
                cambiarErrorConfirmacion(null);
                cambiarConfirmacion({ programa, tipo: 'eliminar' });
              }}
            />
          ) : (
            <div className="xn-vacio xn-academico-sin-eleccion">
              <h3>Elige un programa</h3>
              <p>
                Aquí verás sus fichas con su jornada y cuántos aprendices tiene
                cada una.
              </p>
            </div>
          )}
        </section>
      </div>
      {editor && (
        <EditorPrograma
          programa={editor.programa}
          alCerrar={() => cambiarEditor(null)}
          alGuardar={(guardado) => {
            const nuevo = !editor.programa;
            cambiarEditor(null);
            cambiarAviso({
              mensaje: nuevo
                ? 'Programa creado. Ahora agrégale sus fichas.'
                : 'Programa actualizado.',
            });
            if (nuevo) {
              cambiarActivo(true);
              cambiarTexto('');
            }
            cambiarSeleccion(guardado.id_programa);
            refrescar();
          }}
        />
      )}
      {confirmacion && (
        <Dialogo
          titulo={
            confirmacion.tipo === 'eliminar'
              ? 'Eliminar programa'
              : confirmacion.programa.activo
                ? 'Desactivar programa'
                : 'Reactivar programa'
          }
          ocupado={ocupado}
          alCerrar={() => cambiarConfirmacion(null)}
        >
          <p>
            {confirmacion.tipo === 'eliminar' ? (
              <>
                ¿Eliminar{' '}
                <strong>{confirmacion.programa.nombre_programa}</strong>? No
                tiene fichas, así que no se pierde ningún registro.
              </>
            ) : confirmacion.programa.activo ? (
              <>
                ¿Desactivar{' '}
                <strong>{confirmacion.programa.nombre_programa}</strong>? Sus
                fichas, aprendices y horarios se conservan, pero no podrás
                crearle fichas nuevas.
              </>
            ) : (
              <>
                ¿Reactivar{' '}
                <strong>{confirmacion.programa.nombre_programa}</strong>?
              </>
            )}
          </p>
          <MensajeEstado error={errorConfirmacion} />
          <div className="xn-dialogo-acciones">
            <button
              type="button"
              className="xn-boton xn-boton--secundario"
              data-initial-focus
              disabled={ocupado}
              onClick={() => cambiarConfirmacion(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className={`xn-boton ${confirmacion.tipo === 'eliminar' || confirmacion.programa.activo ? 'xn-boton--peligro' : ''}`}
              disabled={ocupado}
              onClick={confirmar}
            >
              {ocupado
                ? 'Guardando…'
                : confirmacion.tipo === 'eliminar'
                  ? 'Eliminar programa'
                  : confirmacion.programa.activo
                    ? 'Desactivar programa'
                    : 'Reactivar programa'}
            </button>
          </div>
        </Dialogo>
      )}
    </>
  );
}
