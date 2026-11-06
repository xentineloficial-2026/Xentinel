/** Solicitud de correo y formulario de cambio habilitado solo tras validación del enlace. */
import {
  useEffect as useEfecto,
  useRef as useReferencia,
  useState as useEstado,
} from 'react';
import { Link as Enlace, useLocation as useUbicacion } from 'react-router-dom';
import {
  MailCheck as CorreoVerificado,
  ShieldCheck as EscudoVerificado,
} from 'lucide-react';
import { CampoContrasena } from '../../compartido/componentes/CampoContrasena.jsx';
import { SimboloXentinel } from '../../compartido/identidad/Marca.jsx';
import { Perimetro } from '../../compartido/identidad/Perimetro.jsx';
import {
  errorContrasena,
  solicitarRecuperacion,
  restablecerContrasena,
  verificarEnlace,
} from '../../compartido/servicios/recuperacion.js';
function MarcoAutenticacion({ children: contenido, titulo, text: texto }) {
  return (
    <section className="xn-acceso">
      <div className="xn-acceso-introduccion">
        <Perimetro />
        <SimboloXentinel className="xn-acceso-simbolo" />
        <h1>{titulo}</h1>
        <p>{texto}</p>
        <Enlace to="/login" className="xn-texto-enlace">
          Volver a iniciar sesión
        </Enlace>
      </div>
      <div className="xn-acceso-tarjeta">{contenido}</div>
    </section>
  );
}
function RecuperarContrasena() {
  /* correoFormulario, cambiarCorreo: estado de la vista y función para actualizarlo. */
  const [correoFormulario, cambiarCorreo] = useEstado('');
  /* estado, cambiarEstado: estado de la vista y función para actualizarlo. */
  const [estado, cambiarEstado] = useEstado('inactivo');
  /* error, cambiarError: estado de la vista y función para actualizarlo. */
  const [error, cambiarError] = useEstado('');
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    cambiarError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoFormulario.trim())) {
      cambiarError('Ingresa un correo electrónico válido.');
      document.getElementById('recovery-email').focus();
      return;
    }
    ocupado.current = true;
    cambiarEstado('cargando');
    try {
      await solicitarRecuperacion(correoFormulario.trim());
      cambiarEstado('enviado');
    } catch (motivo) {
      cambiarError(motivo.message);
      cambiarEstado('inactivo');
    } finally {
      ocupado.current = false;
    }
  };
  return (
    <MarcoAutenticacion
      titulo="Recupera tu acceso."
      text="Te enviaremos un enlace para que puedas crear una nueva contraseña de forma segura."
    >
      {estado === 'enviado' ? (
        <div role="status">
          <CorreoVerificado size={32} />
          <h2>Revisa tu correo</h2>
          <p>
            Si el correo está asociado a una cuenta, recibirás un enlace. Revisa
            también la carpeta de spam.
          </p>
          <Enlace className="xn-texto-enlace" to="/login">
            Volver al inicio de sesión
          </Enlace>
        </div>
      ) : (
        <>
          <h2>¿Olvidaste tu contraseña?</h2>
          <p>Usa el correo registrado en tu cuenta.</p>
          <form noValidate onSubmit={enviar}>
            <div className="xn-campo">
              <label htmlFor="recovery-email">Correo electrónico</label>
              <input
                id="recovery-email"
                type="email"
                autoComplete="email"
                value={correoFormulario}
                onChange={(evento) => cambiarCorreo(evento.target.value)}
                placeholder="tu.correo@ejemplo.com"
                required
                aria-invalid={!!error}
                aria-describedby={error ? 'recovery-error' : undefined}
              />
            </div>
            {error && (
              <div id="recovery-error" role="alert" className="xn-acceso-error">
                {error}
              </div>
            )}
            <button className="xn-boton" disabled={estado === 'cargando'}>
              {estado === 'cargando'
                ? 'Enviando enlace…'
                : 'Enviar enlace de recuperación'}
            </button>
          </form>
        </>
      )}
    </MarcoAutenticacion>
  );
}
export { RecuperarContrasena };
function RestablecerContrasena() {
  /* ubicacionRuta: valor de trabajo utilizado en esta operación. */
  const ubicacionRuta = useUbicacion();
  /* token, cambiarToken: estado de la vista y función para actualizarlo. */
  const [token, cambiarToken] = useEstado(
    () =>
      new URLSearchParams(ubicacionRuta.hash.slice(1)).get('token') ||
      new URLSearchParams(ubicacionRuta.search).get('token') ||
      ''
  );
  /* correo: estado de la vista y función para actualizarlo. */
  const [correo] = useEstado(
    () =>
      new URLSearchParams(ubicacionRuta.hash.slice(1)).get('correo') ||
      new URLSearchParams(ubicacionRuta.search).get('correo') ||
      ''
  );
  /* verificacion, cambiarVerificacion: estado de la vista y función para actualizarlo. */
  const [verificacion, cambiarVerificacion] = useEstado({
    estado: token ? 'verificando' : 'invalido',
    mensaje: 'Abre el enlace que recibiste en tu correo para continuar.',
  });
  /* intento, cambiarIntento: estado de la vista y función para actualizarlo. */
  const [intento, cambiarIntento] = useEstado(0);
  /* contrasena, cambiarContrasena: estado de la vista y función para actualizarlo. */
  const [contrasena, cambiarContrasena] = useEstado('');
  /* confirmacion, cambiarConfirmacion: estado de la vista y función para actualizarlo. */
  const [confirmacion, cambiarConfirmacion] = useEstado('');
  /* error, cambiarError: estado de la vista y función para actualizarlo. */
  const [error, cambiarError] = useEstado('');
  /* guardando, cambiarGuardando: estado de la vista y función para actualizarlo. */
  const [guardando, cambiarGuardando] = useEstado(false);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  useEfecto(() => {
    // Retira el token de la URL para evitar su persistencia y propagación.
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname
    );
    if (!token) return;
    /* controlador: instancia que se mantiene durante la operación y se libera cuando corresponde. */
    const controlador = new AbortController();
    verificarEnlace(token, correo, controlador.signal)
      .then(() => {
        if (controlador.signal.aborted) return;
        cambiarVerificacion({
          estado: 'verificado',
        });
      })
      .catch((motivo) => {
        if (!controlador.signal.aborted)
          cambiarVerificacion({
            estado: 'invalido',
            mensaje: motivo.message,
          });
      });
    return () => controlador.abort();
  }, [token, correo, intento]);
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current || verificacion.estado !== 'verificado') return;
    cambiarError('');
    if (errorContrasena(contrasena)) {
      cambiarError(errorContrasena(contrasena));
      document.getElementById('new-password').focus();
      return;
    }
    if (contrasena !== confirmacion) {
      cambiarError('Las contraseñas no coinciden.');
      document.getElementById('confirm-password').focus();
      return;
    }
    ocupado.current = true;
    cambiarGuardando(true);
    try {
      await restablecerContrasena(token, correo, contrasena);
      cambiarContrasena('');
      cambiarConfirmacion('');
      cambiarToken('');
      cambiarVerificacion({
        estado: 'exito',
      });
    } catch (motivo) {
      if (motivo.code === 'INVALID_RESET_TOKEN')
        cambiarVerificacion({
          estado: 'invalido',
          mensaje: motivo.message,
        });
      else cambiarError(motivo.message);
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  return (
    <MarcoAutenticacion
      titulo="Un nuevo comienzo."
      text="El cambio de contraseña se habilita después de verificar tu enlace de recuperación."
    >
      {verificacion.estado === 'verificando' && (
        <div role="status">
          <h2>Verificando tu enlace…</h2>
          <p>Un momento mientras comprobamos su validez.</p>
        </div>
      )}
      {verificacion.estado === 'invalido' && (
        <>
          <h2>Enlace no verificado</h2>
          <p role="alert">{verificacion.mensaje}</p>
          <Enlace className="xn-boton" to="/recuperar-contrasena">
            Solicitar un nuevo enlace
          </Enlace>
          {token && (
            <button
              className="xn-texto-enlace xn-enlace-boton"
              onClick={() => {
                cambiarVerificacion({
                  estado: 'verificando',
                });
                cambiarIntento((valor) => valor + 1);
              }}
            >
              Volver a verificar
            </button>
          )}
        </>
      )}
      {verificacion.estado === 'exito' && (
        <div role="status">
          <EscudoVerificado size={34} />
          <h2>Contraseña actualizada</h2>
          <p>Ya puedes iniciar sesión con tu nueva contraseña.</p>
          <Enlace className="xn-boton" to="/login">
            Iniciar sesión
          </Enlace>
        </div>
      )}
      {verificacion.estado === 'verificado' && (
        <>
          <h2>Crea tu nueva contraseña</h2>
          <p>
            Enlace verificado. Usa una contraseña que no utilices en otro
            servicio.
          </p>
          <form noValidate onSubmit={enviar}>
            <CampoContrasena
              identificador="new-password"
              etiqueta="Nueva contraseña"
              valor={contrasena}
              alCambiar={(evento) => cambiarContrasena(evento.target.value)}
              ayuda="Entre 12 caracteres y 72 bytes UTF-8."
              error={error}
            />
            <CampoContrasena
              identificador="confirm-password"
              etiqueta="Confirmar contraseña"
              valor={confirmacion}
              alCambiar={(evento) => cambiarConfirmacion(evento.target.value)}
              error={error}
            />
            {error && (
              <div role="alert" className="xn-acceso-error">
                {error}
              </div>
            )}
            <button className="xn-boton" disabled={guardando}>
              {guardando ? 'Guardando contraseña…' : 'Guardar nueva contraseña'}
            </button>
          </form>
        </>
      )}
    </MarcoAutenticacion>
  );
}
export { RestablecerContrasena };
