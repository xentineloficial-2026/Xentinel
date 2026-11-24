/** Perfil personal: foto y estado a la izquierda; datos y seguridad de la cuenta a la derecha.
 * La contraseña y el correo se cambian en diálogos propios, no en formularios fijos. */
import { useRef as useReferencia, useState as useEstado } from 'react';
import { KeyRound as Llave, Mail as Sobre } from 'lucide-react';
import { useAutenticacion } from '../contextos/autenticacion.js';
import { solicitar } from '../servicios/cliente.js';
import { caducarSesion } from '../servicios/sesion.js';
import { useRecurso } from '../ganchos/useRecurso.js';
import { errorContrasena } from '../servicios/recuperacion.js';
import { MensajeEstado, EstadoConsulta } from './MensajeEstado.jsx';
import { CampoContrasena } from './CampoContrasena.jsx';
import { Dialogo } from './Dialogo.jsx';
import { FotoPerfil } from './FotoPerfil.jsx';
import { subirFoto } from '../servicios/fotos.js';

/** Requisitos visibles mientras se escribe: la persona sabe qué falta antes de enviar. */
function Requisitos({ elementos }) {
  return (
    <ul className="xn-requisitos" aria-label="Requisitos de la nueva contraseña">
      {elementos.map(([texto, cumplido]) => (
        <li key={texto} className={cumplido ? 'es-cumplido' : undefined}>
          <span aria-hidden="true" />
          {texto}
          <span className="xn-solo-lectores">
            {cumplido ? ' (cumplido)' : ' (pendiente)'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DialogoContrasena({ alCerrar }) {
  const [valores, cambiarValores] = useEstado({
    actual: '',
    nueva: '',
    confirmacion: '',
  });
  const [error, cambiarError] = useEstado(null);
  const [guardando, cambiarGuardando] = useEstado(false);
  const ocupado = useReferencia(false);
  const cambiar = (clave) => (evento) =>
    cambiarValores({ ...valores, [clave]: evento.target.value });
  const largoValido = !errorContrasena(valores.nueva);
  const distinta = valores.nueva.length > 0 && valores.nueva !== valores.actual;
  const coinciden =
    valores.confirmacion.length > 0 && valores.nueva === valores.confirmacion;
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    const problema = !valores.actual
      ? 'Escribe tu contraseña actual.'
      : errorContrasena(valores.nueva) ||
        (!distinta && 'La nueva contraseña debe ser distinta de la actual.') ||
        (!coinciden && 'La confirmación no coincide con la nueva contraseña.');
    if (problema) {
      cambiarError(problema);
      return;
    }
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarError(null);
    try {
      await solicitar('/auth/contrasena', {
        method: 'PUT',
        body: { actual: valores.actual, nueva: valores.nueva },
      });
      caducarSesion('Contraseña actualizada. Ingresa con tu nueva contraseña.');
    } catch (motivo) {
      cambiarError(motivo);
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  return (
    <Dialogo
      titulo="Cambiar contraseña"
      alCerrar={alCerrar}
      ocupado={guardando}
      estrecho
    >
      <p>
        Al guardarla cerramos tu sesión en este navegador y en la app. Vuelve a
        ingresar con la contraseña nueva.
      </p>
      <form noValidate onSubmit={enviar} className="xn-formulario-dialogo">
        <CampoContrasena
          identificador="clave-actual"
          etiqueta="Contraseña actual"
          autocompletado="current-password"
          valor={valores.actual}
          alCambiar={cambiar('actual')}
          enfocar
        />
        <CampoContrasena
          identificador="clave-nueva"
          etiqueta="Nueva contraseña"
          valor={valores.nueva}
          alCambiar={cambiar('nueva')}
        />
        <Requisitos
          elementos={[
            ['Al menos 6 caracteres', largoValido && valores.nueva.length > 0],
            ['Distinta de la actual', distinta],
            ['Las dos contraseñas coinciden', coinciden],
          ]}
        />
        <CampoContrasena
          identificador="clave-confirmacion"
          etiqueta="Confirmar nueva contraseña"
          valor={valores.confirmacion}
          alCambiar={cambiar('confirmacion')}
        />
        <MensajeEstado error={error} />
        <div className="xn-dialogo-acciones">
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            onClick={alCerrar}
            disabled={guardando}
          >
            Cancelar
          </button>
          <button className="xn-boton" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Dos pasos: el código llega al correo nuevo y prueba que la dirección es de la persona. */
function DialogoCorreo({ correoActual, alCerrar }) {
  const [paso, cambiarPaso] = useEstado('pedir');
  const [correo, cambiarCorreo] = useEstado('');
  const [contrasena, cambiarContrasena] = useEstado('');
  const [codigo, cambiarCodigo] = useEstado('');
  const [aviso, cambiarAviso] = useEstado({});
  const [guardando, cambiarGuardando] = useEstado(false);
  const ocupado = useReferencia(false);
  const ejecutar = async (tarea) => {
    if (ocupado.current) return;
    ocupado.current = true;
    cambiarGuardando(true);
    cambiarAviso({});
    try {
      await tarea();
    } catch (error) {
      cambiarAviso({ error });
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  const pedirCodigo = (evento) => {
    evento?.preventDefault();
    const limpio = correo.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio)) {
      cambiarAviso({ error: 'Escribe un correo válido, como nombre@dominio.co.' });
      return;
    }
    if (!contrasena) {
      cambiarAviso({ error: 'Escribe tu contraseña actual para confirmar que eres tú.' });
      return;
    }
    ejecutar(async () => {
      const { data } = await solicitar('/auth/correo/solicitar', {
        method: 'POST',
        body: { correo: limpio, contrasena },
      });
      cambiarCorreo(limpio);
      cambiarCodigo('');
      cambiarPaso('confirmar');
      cambiarAviso({ mensaje: data.message });
    });
  };
  const confirmar = (evento) => {
    evento.preventDefault();
    if (!/^[0-9]{6}$/.test(codigo)) {
      cambiarAviso({ error: 'El código tiene 6 dígitos.' });
      return;
    }
    ejecutar(async () => {
      await solicitar('/auth/correo/confirmar', {
        method: 'POST',
        body: { codigo },
      });
      caducarSesion(`Tu correo ahora es ${correo}. Ingresa de nuevo para continuar.`);
    });
  };
  return (
    <Dialogo
      titulo="Cambiar correo"
      alCerrar={alCerrar}
      ocupado={guardando}
      estrecho
    >
      {paso === 'pedir' ? (
        <form noValidate onSubmit={pedirCodigo} className="xn-formulario-dialogo">
          <p>
            {correoActual
              ? `Hoy recibes los avisos en ${correoActual}. `
              : 'Tu cuenta no tiene correo. '}
            Te enviaremos un código al correo nuevo para confirmarlo.
          </p>
          <div className="xn-campo">
            <label htmlFor="correo-nuevo">Correo nuevo</label>
            <input
              id="correo-nuevo"
              type="email"
              autoComplete="email"
              data-initial-focus
              value={correo}
              onChange={(evento) => cambiarCorreo(evento.target.value)}
            />
          </div>
          <CampoContrasena
            identificador="correo-clave"
            etiqueta="Contraseña actual"
            autocompletado="current-password"
            valor={contrasena}
            alCambiar={(evento) => cambiarContrasena(evento.target.value)}
          />
          <MensajeEstado {...aviso} />
          <div className="xn-dialogo-acciones">
            <button
              type="button"
              className="xn-boton xn-boton--secundario"
              onClick={alCerrar}
              disabled={guardando}
            >
              Cancelar
            </button>
            <button className="xn-boton" disabled={guardando}>
              {guardando ? 'Enviando…' : 'Enviar código'}
            </button>
          </div>
        </form>
      ) : (
        <form noValidate onSubmit={confirmar} className="xn-formulario-dialogo">
          <MensajeEstado {...aviso} />
          <div className="xn-campo">
            <label htmlFor="correo-codigo">Código de 6 dígitos</label>
            <input
              id="correo-codigo"
              className="xn-codigo-entrada"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              data-initial-focus
              value={codigo}
              onChange={(evento) =>
                cambiarCodigo(evento.target.value.replace(/\D/g, '').slice(0, 6))
              }
            />
            <small>¿No llegó? Revisa la carpeta de spam o pide otro código.</small>
          </div>
          <div className="xn-dialogo-acciones">
            <button
              type="button"
              className="xn-boton xn-boton--secundario"
              onClick={() => pedirCodigo()}
              disabled={guardando}
            >
              Pedir otro código
            </button>
            <button className="xn-boton" disabled={guardando}>
              {guardando ? 'Confirmando…' : 'Confirmar correo'}
            </button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}

function EditorPerfil({ usuario }) {
  const [formulario, cambiarFormulario] = useEstado({
    nombres_completos: usuario.nombres_completos,
    telefono: usuario.telefono || '',
  });
  const [retroalimentacion, cambiarRetroalimentacion] = useEstado({});
  const [guardando, cambiarGuardando] = useEstado(false);
  /* dialogo: «contrasena» o «correo» mientras uno de los dos está abierto. */
  const [dialogo, cambiarDialogo] = useEstado(null);
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
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    cambiarRetroalimentacion({});
    if (formulario.nombres_completos.trim().length < 2) {
      cambiarRetroalimentacion({ error: 'Escribe tu nombre completo.' });
      document.getElementById('profile-name').focus();
      return;
    }
    ocupado.current = true;
    cambiarGuardando(true);
    try {
      await solicitar(`/usuarios/${usuario.id_usuarios}`, {
        method: 'PATCH',
        body: formulario,
      });
      caducarSesion('Guardamos tus datos. Inicia sesión de nuevo para verlos.');
    } catch (error) {
      cambiarRetroalimentacion({ error });
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
            <form noValidate onSubmit={enviar}>
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
            <h2>Acceso a tu cuenta</h2>
            <ul className="xn-seguridad">
              <li>
                <Sobre size={20} aria-hidden="true" />
                <div>
                  <strong>Correo electrónico</strong>
                  <span>{usuario.correo || 'Sin correo registrado'}</span>
                </div>
                <button
                  type="button"
                  className="xn-boton xn-boton--secundario"
                  onClick={() => cambiarDialogo('correo')}
                >
                  Cambiar correo
                </button>
              </li>
              <li>
                <Llave size={20} aria-hidden="true" />
                <div>
                  <strong>Contraseña</strong>
                  <span>La usas para ingresar en la web y en la app.</span>
                </div>
                <button
                  type="button"
                  className="xn-boton xn-boton--secundario"
                  onClick={() => cambiarDialogo('contrasena')}
                >
                  Cambiar contraseña
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>
      {dialogo === 'contrasena' && (
        <DialogoContrasena alCerrar={() => cambiarDialogo(null)} />
      )}
      {dialogo === 'correo' && (
        <DialogoCorreo
          correoActual={usuario.correo}
          alCerrar={() => cambiarDialogo(null)}
        />
      )}
    </>
  );
}

function MiPerfil() {
  const { usuario } = useAutenticacion();
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
