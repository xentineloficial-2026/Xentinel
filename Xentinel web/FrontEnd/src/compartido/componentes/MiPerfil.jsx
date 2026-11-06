/** Perfil personal y cambio de contraseña; la API revoca sesiones tras cambios de identidad. */
import { useRef as useReferencia, useState as useEstado } from 'react';
import { useAutenticacion } from '../contextos/autenticacion.js';
import { solicitar } from '../servicios/cliente.js';
import { caducarSesion } from '../servicios/sesion.js';
import { useRecurso } from '../ganchos/useRecurso.js';
import { errorContrasena } from '../servicios/recuperacion.js';
import { MensajeEstado, EstadoConsulta } from './MensajeEstado.jsx';
import { CampoContrasena } from './CampoContrasena.jsx';
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
      <div className="xn-perfil-cuadricula">
        <section className="xn-trabajo-tarjeta">
          <h2>Tu información</h2>
          <p className="xn-ayuda">
            Tu ID de usuario es <strong>{usuario.id_usuarios}</strong>. Correo:{' '}
            {usuario.correo}.
          </p>
          <form noValidate onSubmit={(evento) => enviar(evento, false)}>
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
            <p className="xn-ayuda">
              Al guardar, inicia sesión nuevamente para proteger tu cuenta.
            </p>
            <button className="xn-boton" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar mis datos'}
            </button>
          </form>
        </section>
        <section className="xn-trabajo-tarjeta">
          <h2>Una cuenta segura</h2>
          <form noValidate onSubmit={(evento) => enviar(evento, true)}>
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
                    ? 'Al menos 12 caracteres y máximo 72 bytes UTF-8.'
                    : undefined
                }
              />
            ))}
            <button className="xn-boton" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
          </form>
        </section>
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
