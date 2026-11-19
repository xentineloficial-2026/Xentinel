/** Recuperación en tres pasos: correo, código de 6 dígitos verificado y nueva contraseña. */
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
  restablecerContrasena,
  solicitarRecuperacion,
  verificarCodigo,
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
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function FlujoRecuperacion({ correoInicial = '', pasoInicial = 'correo' }) {
  /* paso: correo → codigo → contrasena → exito. */
  const [paso, cambiarPaso] = useEstado(pasoInicial);
  const [correo, cambiarCorreo] = useEstado(correoInicial);
  const [codigo, cambiarCodigo] = useEstado('');
  const [contrasena, cambiarContrasena] = useEstado('');
  const [confirmacion, cambiarConfirmacion] = useEstado('');
  const [error, cambiarError] = useEstado('');
  const [aviso, cambiarAviso] = useEstado('');
  const [cargando, cambiarCargando] = useEstado(false);
  /* ocupado: evita envíos dobles sin esperar un nuevo renderizado. */
  const ocupado = useReferencia(false);
  const ejecutar = async (tarea) => {
    if (ocupado.current) return;
    ocupado.current = true;
    cambiarCargando(true);
    cambiarError('');
    try {
      await tarea();
    } catch (motivo) {
      cambiarError(motivo.message);
      if (motivo.code === 'INVALID_RESET_CODE' && paso === 'contrasena') {
        cambiarCodigo('');
        cambiarPaso('codigo');
      }
    } finally {
      ocupado.current = false;
      cambiarCargando(false);
    }
  };
  const pedirCodigo = (evento) => {
    evento?.preventDefault();
    if (!CORREO_VALIDO.test(correo.trim())) {
      cambiarError('Ingresa un correo electrónico válido.');
      document.getElementById('recovery-email')?.focus();
      return;
    }
    ejecutar(async () => {
      await solicitarRecuperacion(correo.trim());
      cambiarAviso(
        'Si el correo está asociado a una cuenta, te enviamos un código de 6 dígitos. Revisa también la carpeta de spam.'
      );
      cambiarCodigo('');
      cambiarPaso('codigo');
    });
  };
  const comprobarCodigo = (evento) => {
    evento.preventDefault();
    if (!/^[0-9]{6}$/.test(codigo)) {
      cambiarError('Escribe los 6 dígitos del código.');
      document.getElementById('recovery-code')?.focus();
      return;
    }
    ejecutar(async () => {
      await verificarCodigo(correo.trim(), codigo);
      cambiarAviso('');
      cambiarPaso('contrasena');
    });
  };
  const guardar = (evento) => {
    evento.preventDefault();
    if (errorContrasena(contrasena)) {
      cambiarError(errorContrasena(contrasena));
      document.getElementById('new-password')?.focus();
      return;
    }
    if (contrasena !== confirmacion) {
      cambiarError('Las contraseñas no coinciden.');
      document.getElementById('confirm-password')?.focus();
      return;
    }
    ejecutar(async () => {
      await restablecerContrasena(correo.trim(), codigo, contrasena);
      cambiarCodigo('');
      cambiarContrasena('');
      cambiarConfirmacion('');
      cambiarPaso('exito');
    });
  };
  const mensajeError = error && (
    <div id="recovery-error" role="alert" className="xn-acceso-error">
      {error}
    </div>
  );
  if (paso === 'exito')
    return (
      <div role="status">
        <EscudoVerificado size={34} />
        <h2>Contraseña actualizada</h2>
        <p>Ya puedes iniciar sesión con tu nueva contraseña.</p>
        <Enlace className="xn-boton" to="/login">
          Iniciar sesión
        </Enlace>
      </div>
    );
  if (paso === 'contrasena')
    return (
      <>
        <h2>Crea tu nueva contraseña</h2>
        <p>Código verificado. Usa una contraseña que no utilices en otro servicio.</p>
        <form noValidate onSubmit={guardar}>
          <CampoContrasena
            identificador="new-password"
            etiqueta="Nueva contraseña"
            valor={contrasena}
            alCambiar={(evento) => cambiarContrasena(evento.target.value)}
            ayuda="Entre 6 caracteres y 72 bytes UTF-8."
            error={error}
          />
          <CampoContrasena
            identificador="confirm-password"
            etiqueta="Confirmar contraseña"
            valor={confirmacion}
            alCambiar={(evento) => cambiarConfirmacion(evento.target.value)}
            error={error}
          />
          {mensajeError}
          <button className="xn-boton" disabled={cargando}>
            {cargando ? 'Guardando contraseña…' : 'Guardar nueva contraseña'}
          </button>
        </form>
      </>
    );
  if (paso === 'codigo')
    return (
      <>
        <CorreoVerificado size={32} />
        <h2>Escribe tu código</h2>
        <p>{aviso || `Revisa el correo que enviamos a ${correo}.`}</p>
        <form noValidate onSubmit={comprobarCodigo}>
          <div className="xn-campo">
            <label htmlFor="recovery-email">Correo electrónico</label>
            <input
              id="recovery-email"
              type="email"
              autoComplete="email"
              value={correo}
              onChange={(evento) => cambiarCorreo(evento.target.value)}
              required
            />
          </div>
          <div className="xn-campo">
            <label htmlFor="recovery-code">Código de 6 dígitos</label>
            <input
              id="recovery-code"
              className="xn-codigo-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={codigo}
              onChange={(evento) =>
                cambiarCodigo(evento.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="000000"
              required
              aria-invalid={!!error}
              aria-describedby={error ? 'recovery-error' : 'recovery-code-help'}
            />
            <small id="recovery-code-help">
              Vence a los 15 minutos. Tras 5 intentos fallidos debes pedir otro.
            </small>
          </div>
          {mensajeError}
          <button className="xn-boton" disabled={cargando}>
            {cargando ? 'Verificando…' : 'Verificar código'}
          </button>
        </form>
        <button
          type="button"
          className="xn-texto-enlace xn-enlace-boton"
          disabled={cargando}
          onClick={() => pedirCodigo()}
        >
          Enviar un código nuevo
        </button>
      </>
    );
  return (
    <>
      <h2>¿Olvidaste tu contraseña?</h2>
      <p>Usa el correo registrado en tu cuenta.</p>
      <form noValidate onSubmit={pedirCodigo}>
        <div className="xn-campo">
          <label htmlFor="recovery-email">Correo electrónico</label>
          <input
            id="recovery-email"
            type="email"
            autoComplete="email"
            value={correo}
            onChange={(evento) => cambiarCorreo(evento.target.value)}
            placeholder="tu.correo@ejemplo.com"
            required
            aria-invalid={!!error}
            aria-describedby={error ? 'recovery-error' : undefined}
          />
        </div>
        {mensajeError}
        <button className="xn-boton" disabled={cargando}>
          {cargando ? 'Enviando código…' : 'Enviar código de recuperación'}
        </button>
      </form>
    </>
  );
}
function RecuperarContrasena() {
  return (
    <MarcoAutenticacion
      titulo="Recupera tu acceso."
      text="Te enviaremos un código de 6 dígitos para que crees una nueva contraseña de forma segura."
    >
      <FlujoRecuperacion />
    </MarcoAutenticacion>
  );
}
export { RecuperarContrasena };
/** Destino del enlace del correo: abre el paso del código con el correo ya escrito. */
function RestablecerContrasena() {
  const ubicacionRuta = useUbicacion();
  const [correo] = useEstado(
    () =>
      new URLSearchParams(ubicacionRuta.hash.slice(1)).get('correo') ||
      new URLSearchParams(ubicacionRuta.search).get('correo') ||
      ''
  );
  useEfecto(() => {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname
    );
  }, []);
  return (
    <MarcoAutenticacion
      titulo="Un nuevo comienzo."
      text="Escribe el código que recibiste por correo y crea tu nueva contraseña."
    >
      <FlujoRecuperacion
        correoInicial={correo}
        pasoInicial={correo ? 'codigo' : 'correo'}
      />
    </MarcoAutenticacion>
  );
}
export { RestablecerContrasena };
