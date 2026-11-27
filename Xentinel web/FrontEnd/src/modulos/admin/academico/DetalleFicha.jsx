/** Una ficha completa: sus datos, sus aprendices y su horario semanal. */
import { useState } from 'react';
import {
  ChevronLeft as Volver,
  FileUp as Importar,
  Pencil as Editar,
  Trash2 as Eliminar,
  UserPlus as Inscribir,
  UsersRound as Asignar,
} from 'lucide-react';
import { Dialogo } from '../../../compartido/componentes/Dialogo.jsx';
import {
  EstadoConsulta,
  MensajeEstado,
} from '../../../compartido/componentes/MensajeEstado.jsx';
import { useRecurso } from '../../../compartido/ganchos/useRecurso.js';
import { solicitar } from '../../../compartido/servicios/cliente.js';
import { DIAS_SEMANA, normalizarDia } from '../../instructor/calendario.js';
import { AsignarAprendices } from './AsignarAprendices.jsx';
import { CargaMasiva } from './CargaMasiva.jsx';
import { EditorFicha } from './EditorFicha.jsx';
import { EditorHorario } from './EditorHorario.jsx';
import { Periodo } from './FilaFicha.jsx';
import { InscribirAprendiz } from './InscribirAprendiz.jsx';
import { JornadaRegla } from './JornadaRegla.jsx';
import { fechaCorta, horaCorta } from './utilidades.js';

function situacion(persona) {
  if (persona.requiere_activacion) return ['Pendiente de activar', 'es-aviso'];
  const texto =
    persona.situacion_formativa || persona.estado_ficha || 'En formación';
  return [texto, /desert|retir/i.test(texto) ? 'es-peligro' : 'es-exito'];
}

function Aprendices({ ficha, alQuitar }) {
  if (!ficha.aprendices.length)
    return (
      <div className="xn-vacio">
        <h3>Esta ficha aún no tiene aprendices</h3>
        <p>
          Asigna aprendices que ya tienen cuenta, inscribe uno nuevo o importa
          una lista desde un archivo CSV o Excel.
        </p>
      </div>
    );
  return (
    <div
      className="xn-tabla-desplazable"
      tabIndex={0}
      aria-label="Aprendices de la ficha"
    >
      <table className="xn-datos-tabla xn-tabla-aprendices">
        <thead>
          <tr>
            <th scope="col">Aprendiz</th>
            <th scope="col">Documento</th>
            <th scope="col">Correo</th>
            <th scope="col">Situación</th>
            <th scope="col">En la ficha desde</th>
            <th scope="col">
              <span className="xn-solo-lectores">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ficha.aprendices.map((persona) => {
            const [texto, clase] = situacion(persona);
            return (
              <tr key={persona.id_usuarios}>
                <th scope="row">{persona.nombres_completos}</th>
                <td className="xn-dato-id">
                  {persona.tipo_documento} {persona.numero_documento}
                </td>
                <td>{persona.correo || '—'}</td>
                <td>
                  <span className={`xn-estado ${clase}`}>{texto}</span>
                </td>
                <td>{fechaCorta(persona.fechaingreso) || '—'}</td>
                <td>
                  <button
                    type="button"
                    className="xn-enlace-boton"
                    onClick={() => alQuitar(persona)}
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Horario({ ficha }) {
  if (!ficha.horarios.length)
    return (
      <div className="xn-vacio">
        <h3>Sin clases programadas</h3>
        <p>
          Agrega las clases de la semana con su ambiente e instructor. Aparecen
          en el calendario de los aprendices y del instructor.
        </p>
      </div>
    );
  const porDia = DIAS_SEMANA.map((dia, indice) => ({
    dia,
    clases: ficha.horarios
      .filter((clase) => normalizarDia(clase.dia_semana) === indice)
      .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio)),
  })).filter((grupo) => grupo.clases.length);
  return (
    <ol className="xn-semana">
      {porDia.map(({ dia, clases }) => (
        <li key={dia}>
          <h3>{dia}</h3>
          <ul>
            {clases.map((clase) => (
              <li key={clase.id_horario}>
                <span className="xn-semana-hora">
                  {horaCorta(clase.hora_inicio)}–{horaCorta(clase.hora_fin)}
                </span>
                <span>
                  <strong>{clase.nombre_clase}</strong>
                  {[clase.ambiente, clase.instructor]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export function DetalleFicha({ idFicha, alVolver, alCambiar }) {
  const recurso = useRecurso(`/fichas/${idFicha}`);
  const [ficha, cambiarFicha] = useState(null);
  const vigente = ficha?.id_ficha === Number(idFicha) ? ficha : recurso.datos;
  const [pestana, cambiarPestana] = useState('aprendices');
  const [dialogo, cambiarDialogo] = useState(null);
  const [aviso, cambiarAviso] = useState({});
  const [ocupado, cambiarOcupado] = useState(false);
  const [errorDialogo, cambiarErrorDialogo] = useState(null);

  const recargar = (mensaje) => {
    cambiarDialogo(null);
    cambiarFicha(null);
    if (mensaje) cambiarAviso({ mensaje });
    recurso.actualizar();
    alCambiar?.();
  };
  const actualizar = (datos, mensaje) => {
    cambiarFicha(datos);
    cambiarDialogo(null);
    if (mensaje) cambiarAviso({ mensaje });
    alCambiar?.();
  };

  async function confirmar() {
    if (ocupado) return;
    cambiarOcupado(true);
    cambiarErrorDialogo(null);
    try {
      if (dialogo.tipo === 'quitar') {
        await solicitar(
          `/fichas/${vigente.id_ficha}/aprendices/${dialogo.persona.id_usuarios}`,
          { method: 'DELETE' }
        );
        recargar(`${dialogo.persona.nombres_completos} salió de la ficha.`);
      } else {
        await solicitar(`/fichas/${vigente.id_ficha}`, { method: 'DELETE' });
        alCambiar?.();
        alVolver(`Ficha ${vigente.numero_ficha} eliminada.`);
      }
    } catch (error) {
      cambiarErrorDialogo(error);
    } finally {
      cambiarOcupado(false);
    }
  }

  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <button
            type="button"
            className="xn-volver"
            onClick={() => alVolver()}
          >
            <Volver size={20} aria-hidden="true" />
            Fichas
          </button>
        </div>
      </div>
      <EstadoConsulta recurso={vigente ? { estado: 'listo' } : recurso}>
        {vigente && (
          <>
            <header className="xn-ficha-cabecera">
              <div className="xn-ficha-identidad">
                <span className="xn-ficha-numero">{vigente.numero_ficha}</span>
                <div>
                  <h1>
                    {vigente.nombre_ficha || `Ficha ${vigente.numero_ficha}`}
                  </h1>
                  <p>
                    {vigente.nombre_programa}
                    {vigente.nivel_programa && ` · ${vigente.nivel_programa}`}
                    {vigente.modalidad && ` · ${vigente.modalidad}`}
                  </p>
                </div>
              </div>
              <div className="xn-admin-acciones">
                <button
                  type="button"
                  className="xn-boton xn-boton--secundario"
                  onClick={() => cambiarDialogo({ tipo: 'editar' })}
                >
                  <Editar size={16} aria-hidden="true" /> Editar datos
                </button>
                <button
                  type="button"
                  className="xn-boton xn-boton--peligro-suave"
                  onClick={() => {
                    cambiarErrorDialogo(null);
                    cambiarDialogo({ tipo: 'eliminar' });
                  }}
                >
                  <Eliminar size={16} aria-hidden="true" /> Eliminar
                </button>
              </div>
              <dl className="xn-ficha-hechos">
                <div>
                  <dt>Jornada</dt>
                  <dd>
                    <JornadaRegla
                      nombre={vigente.jornada}
                      inicio={vigente.hora_inicio}
                      fin={vigente.hora_fin}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Periodo de formación</dt>
                  <dd>
                    <Periodo
                      inicio={vigente.fecha_inicio}
                      fin={vigente.fecha_fin}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Aprendices</dt>
                  <dd className="xn-ficha-cifra">{vigente.total_aprendices}</dd>
                </div>
                <div>
                  <dt>Clases por semana</dt>
                  <dd className="xn-ficha-cifra">{vigente.horarios.length}</dd>
                </div>
              </dl>
            </header>
            <MensajeEstado {...aviso} />
            <div
              className="xn-pestanas"
              role="tablist"
              aria-label="Contenido de la ficha"
            >
              {[
                ['aprendices', `Aprendices (${vigente.total_aprendices})`],
                ['horario', `Horario (${vigente.horarios.length})`],
              ].map(([clave, etiqueta]) => (
                <button
                  key={clave}
                  type="button"
                  role="tab"
                  id={`pestana-${clave}`}
                  aria-controls={`panel-${clave}`}
                  aria-selected={pestana === clave}
                  onClick={() => cambiarPestana(clave)}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
            <section
              className="xn-trabajo-tarjeta xn-ficha-panel"
              role="tabpanel"
              id={`panel-${pestana}`}
              aria-labelledby={`pestana-${pestana}`}
            >
              {pestana === 'aprendices' ? (
                <>
                  <div className="xn-ficha-panel-acciones">
                    <button
                      type="button"
                      className="xn-boton"
                      onClick={() => cambiarDialogo({ tipo: 'asignar' })}
                    >
                      <Asignar size={17} aria-hidden="true" /> Asignar
                      aprendices
                    </button>
                    <button
                      type="button"
                      className="xn-boton xn-boton--secundario"
                      onClick={() => cambiarDialogo({ tipo: 'inscribir' })}
                    >
                      <Inscribir size={17} aria-hidden="true" /> Inscribir
                      aprendiz
                    </button>
                    <button
                      type="button"
                      className="xn-boton xn-boton--secundario"
                      onClick={() => cambiarDialogo({ tipo: 'importar' })}
                    >
                      <Importar size={17} aria-hidden="true" /> Importar lista
                    </button>
                  </div>
                  <Aprendices
                    ficha={vigente}
                    alQuitar={(persona) => {
                      cambiarErrorDialogo(null);
                      cambiarDialogo({ tipo: 'quitar', persona });
                    }}
                  />
                </>
              ) : (
                <>
                  <div className="xn-ficha-panel-acciones">
                    <button
                      type="button"
                      className="xn-boton"
                      onClick={() => cambiarDialogo({ tipo: 'horario' })}
                    >
                      <Editar size={16} aria-hidden="true" />
                      {vigente.horarios.length
                        ? 'Editar horario'
                        : 'Agregar clases'}
                    </button>
                  </div>
                  <Horario ficha={vigente} />
                </>
              )}
            </section>
            {dialogo?.tipo === 'editar' && (
              <EditorFicha
                ficha={vigente}
                alCerrar={() => cambiarDialogo(null)}
                alGuardar={(datos) => actualizar(datos, 'Ficha actualizada.')}
              />
            )}
            {dialogo?.tipo === 'horario' && (
              <EditorHorario
                ficha={vigente}
                alCerrar={() => cambiarDialogo(null)}
                alGuardar={(datos) => actualizar(datos, 'Horario guardado.')}
              />
            )}
            {dialogo?.tipo === 'asignar' && (
              <AsignarAprendices
                ficha={vigente}
                alCerrar={() => cambiarDialogo(null)}
                alGuardar={actualizar}
              />
            )}
            {dialogo?.tipo === 'inscribir' && (
              <InscribirAprendiz
                ficha={vigente}
                alCerrar={() => cambiarDialogo(null)}
                alGuardar={recargar}
              />
            )}
            {dialogo?.tipo === 'importar' && (
              <CargaMasiva
                ficha={vigente}
                alCerrar={() => cambiarDialogo(null)}
                alImportar={() => {
                  cambiarFicha(null);
                  recurso.actualizar();
                  alCambiar?.();
                }}
              />
            )}
            {['quitar', 'eliminar'].includes(dialogo?.tipo) && (
              <Dialogo
                titulo={
                  dialogo.tipo === 'quitar'
                    ? 'Quitar de la ficha'
                    : `Eliminar la ficha ${vigente.numero_ficha}`
                }
                ocupado={ocupado}
                alCerrar={() => cambiarDialogo(null)}
              >
                <p>
                  {dialogo.tipo === 'quitar' ? (
                    <>
                      <strong>{dialogo.persona.nombres_completos}</strong> sale
                      de la lista de esta ficha. Su cuenta sigue activa y su
                      asistencia anterior se conserva.
                    </>
                  ) : (
                    <>
                      Se eliminan la ficha, su jornada y su horario. Solo es
                      posible si nunca registró asistencia; si ya la tiene,
                      quita a sus aprendices en lugar de eliminarla.
                    </>
                  )}
                </p>
                <MensajeEstado error={errorDialogo} />
                <div className="xn-dialogo-acciones">
                  <button
                    type="button"
                    className="xn-boton xn-boton--secundario"
                    data-initial-focus
                    disabled={ocupado}
                    onClick={() => cambiarDialogo(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="xn-boton xn-boton--peligro"
                    disabled={ocupado}
                    onClick={confirmar}
                  >
                    {ocupado
                      ? 'Guardando…'
                      : dialogo.tipo === 'quitar'
                        ? 'Quitar de la ficha'
                        : 'Eliminar ficha'}
                  </button>
                </div>
              </Dialogo>
            )}
          </>
        )}
      </EstadoConsulta>
    </>
  );
}
