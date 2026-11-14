/** Perfil personal en dos tarjetas: foto y estado a la izquierda, datos y contraseña a la derecha. */
import { useRef as useReferencia, useState as useEstado } from 'react';
import { useAutenticacion } from '../contextos/autenticacion.js';
import { solicitar } from '../servicios/cliente.js';
import { caducarSesion } from '../servicios/sesion.js';
import { useRecurso } from '../ganchos/useRecurso.js';
import { errorContrasena } from '../servicios/recuperacion.js';
import { MensajeEstado, EstadoConsulta } from './MensajeEstado.jsx';
import { CampoContrasena } from './CampoContrasena.jsx';
import { FotoPerfil } from './FotoPerfil.jsx';
import { subirFoto } from '../servicios/fotos.js';
function EditorPerfil({ usuario }) {
  /* formulario, cambiarFormulario: estado de la vista y función para actualizarlo. */
  const [formulario, cambiarFormulario] = useEstado({
    nombres_completos: usuario.nombres_completos,
    telefono: usuario.telefono || '',
  });
  /* contrasenas, cambiarContrasenas: estado de la vista y función para actualizarlo. */
  const [contrasenas, cambiarContrasenas] = useEstado({
    actual: '',
    nueva: '',
    confirmacion: '',
  });
  /* retroalimentacion, cambiarRetroalimentacion: estado de la vista y función para actualizarlo. */
  const [retroalimentacion, cambiarRetroalimentacion] = useEstado({});
  /* guardando, cambiarGuardando: estado de la vista y función para actualizarlo. */
  const [guardando, cambiarGuardando] = useEstado(false);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* fotoUrl: cambia al subir una foto nueva para mostrarla sin recargar. */
  const [fotoUrl, cambiarFotoUrl] = useEstado(usuario.foto_url);
  const [subiendo, cambiarSubiendo] = useEstado(false);
  /* guardarFoto: la foto se guarda en cuanto se elige, sin cerrar la sesión. */
  const guardarFoto = async (archivo) => {
    cambiarSubiendo(true);
    cambiarRetroalimentacion({});
    try {
      const actualizado = await subirFoto(usuario.id_usuarios, archivo);
      cambiarFotoUrl(actualizado.foto_url);
      cambiarRetroalimentacion({ mensaje: 'Foto actualizada.' });
    } catch (error) {
      cambiarRetroalimentacion({ error });
    } finally {
      cambiarSubiendo(false);
    }
  };
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento, cambioContrasena) => {
    evento.preventDefault();
    if (ocupado.current) return;
    cambiarRetroalimentacion({});
    if (
      cambioContrasena &&
      (!contrasenas.actual ||
        errorContrasena(contrasenas.nueva) ||
        contrasenas.nueva !== contrasenas.confirmacion)
    ) {
      cambiarRetroalimentacion({
        error: !contrasenas.actual
          ? 'Ingresa tu contraseña actual.'
          : errorContrasena(contrasenas.nueva) ||
            'Las contraseñas no coinciden.',
      });
      return;
    }
    if (!cambioContrasena && formulario.nombres_completos.trim().length < 2) {
      cambiarRetroalimentacion({
        error: 'Escribe tu nombre completo.',
      });
      document.getElementById('profile-name').focus();
      return;
    }
    ocupado.current = true;
    cambiarGuardando(true);
    try {
      await solicitar(
        cambioContrasena
          ? '/auth/contrasena'
          : `/usuarios/${usuario.id_usuarios}`,
        {
          method: cambioContrasena ? 'PUT' : 'PATCH',
          body: cambioContrasena
            ? {
                actual: contrasenas.actual,
                nueva: contrasenas.nueva,
              }
            : formulario,
        }
      );
      caducarSesion();
    } catch (error) {
      cambiarRetroalimentacion({
        error,
      });
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  return (
    <>
      <MensajeEstado {...retroalimentacion} />
      <div className="xn-perfil-distribucion">
        <section className="xn-trabajo-tarjeta xn-perfil-lateral">
          <span
            className={`xn-estado ${usuario.estado === 'Activo' ? 'es-exito' : 'es-neutro'}`}
          >
            {usuario.estado}
          </span>
          <FotoPerfil
            fotoUrl={fotoUrl}
            nombre={usuario.nombres_completos}
            alElegir={guardarFoto}
            deshabilitado={subiendo}
          />
          <div className="xn-perfil-identidad">
            <strong>{usuario.nombres_completos}</strong>
            <span>{usuario.nombre_rol}</span>
          </div>
        </section>
        <div className="xn-perfil-columna">
          <section className="xn-trabajo-tarjeta">
            <h2>Tu información</h2>
            <form noValidate onSubmit={(evento) => enviar(evento, false)}>
              <div className="xn-formulario-cuadricula">
                <div className="xn-campo">
                  <label htmlFor="profile-name">Nombre completo</label>
                  <input
                    id="profile-name"
                    autoComplete="name"
                    value={formulario.nombres_completos}
                    onChange={(evento) =>
                      cambiarFormulario({
                        ...formulario,
                        nombres_completos: evento.target.value,
                      })
                    }
                  />
                </div>
                <div className="xn-campo">
                  <label htmlFor="profile-phone">Teléfono</label>
                  <input
                    id="profile-phone"
                    type="tel"
                    autoComplete="tel"
                    value={formulario.telefono}
                    onChange={(evento) =>
                      cambiarFormulario({
                        ...formulario,
                        telefono: evento.target.value,
                      })
                    }
                  />
                </div>
                <div className="xn-campo">
                  <label htmlFor="profile-document">Documento</label>
                  <input
                    id="profile-document"
                    value={`${usuario.tipo_documento} ${usuario.numero_documento}`}
                    readOnly
                  />
                </div>
                <div className="xn-campo">
                  <label htmlFor="profile-email">Correo electrónico</label>
                  <input id="profile-email" value={usuario.correo} readOnly />
                </div>
              </div>
              <p className="xn-ayuda">
                Al guardar, inicia sesión nuevamente para proteger tu cuenta.
              </p>
              <div className="xn-perfil-acciones">
                <button className="xn-boton" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </section>
          <section className="xn-trabajo-tarjeta">
            <h2>Contraseña</h2>
            <form noValidate onSubmit={(evento) => enviar(evento, true)}>
              <div className="xn-formulario-cuadricula">
                {[
                  ['actual', 'Contraseña actual'],
                  ['nueva', 'Nueva contraseña'],
                  ['confirmacion', 'Confirmar contraseña'],
                ].map(([clave, etiqueta]) => (
                  <CampoContrasena
                    key={clave}
                    identificador={`profile-${clave}`}
                    etiqueta={etiqueta}
                    autocompletado={
                      clave === 'actual' ? 'current-password' : 'new-password'
                    }
                    valor={contrasenas[clave]}
                    alCambiar={(evento) =>
                      cambiarContrasenas({
                        ...contrasenas,
                        [clave]: evento.target.value,
                      })
                    }
                    ayuda={
                      clave === 'nueva'
                        ? 'Al menos 6 caracteres y máximo 72 bytes UTF-8.'
                        : undefined
                    }
                  />
                ))}
              </div>
              <div className="xn-perfil-acciones">
                <button className="xn-boton" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Cambiar contraseña'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
function MiPerfil() {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useAutenticacion();
  /* perfil: consulta cancelable al servidor, con datos, estado y reintento. */
  const perfil = useRecurso(`/usuarios/${usuario.id_usuarios}`);
  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Hagamos que sea tuyo.</h1>
          <p>Mantén tus datos al día. Estamos para ayudarte.</p>
        </div>
      </div>
      <EstadoConsulta recurso={perfil}>
        {perfil.datos && <EditorPerfil usuario={perfil.datos} />}
      </EstadoConsulta>
    </>
  );
}
export { MiPerfil };
