/** Gestiona inicio de sesión, revocación, caducidad y comprobación con el servidor. */
import {
  useCallback as useRetorno,
  useEffect as useEfecto,
  useState as useEstado,
} from 'react';
import { ContextoAutenticacion } from './autenticacion.js';
import { solicitar } from '../servicios/cliente.js';
import { leerSesion, guardarSesion } from '../servicios/sesion.js';
function ProveedorAutenticacion({ children: contenido }) {
  /* sesion, cambiarSesion: estado de la vista y función para actualizarlo. */
  const [sesion, cambiarSesion] = useEstado(leerSesion);
  /* mensajeSesion, cambiarMensajeSesion: estado de la vista y función para actualizarlo. */
  const [mensajeSesion, cambiarMensajeSesion] = useEstado('');
  /* tonoSesion: «exito» cuando el cierre fue una confirmación (contraseña o correo nuevos). */
  const [tonoSesion, cambiarTonoSesion] = useEstado('error');
  /* iniciarSesion: valor de trabajo utilizado en esta operación. */
  const iniciarSesion = useRetorno((datos) => {
    if (
      !datos?.access_token ||
      !datos?.usuario ||
      !Number.isFinite(datos.expires_in)
    )
      throw new Error('El servidor no devolvió una sesión válida.');
    /* siguiente: valor de trabajo utilizado en esta operación. */
    const siguiente = {
      tokenAcceso: datos.access_token,
      usuario: datos.usuario,
      venceEn: Date.now() + datos.expires_in * 1000,
    };
    guardarSesion(siguiente);
    cambiarSesion(siguiente);
    cambiarMensajeSesion('');
  }, []);
  /* cerrarSesion: valor de trabajo utilizado en esta operación. */
  const cerrarSesion = useRetorno(async () => {
    /* revocacion: valor de trabajo utilizado en esta operación. */
    const revocacion = solicitar('/auth/logout', {
      method: 'POST',
    }).catch(() => {});
    guardarSesion(null);
    cambiarSesion(null);
    cambiarMensajeSesion('');
    await revocacion;
  }, []);
  useEfecto(() => {
    /* caducar: operación local que atiende el evento o transforma la información. */
    const caducar = (evento) => {
      guardarSesion(null);
      cambiarSesion(null);
      cambiarMensajeSesion(
        evento?.detail?.mensaje || 'Tu sesión venció. Inicia sesión nuevamente.'
      );
      cambiarTonoSesion(evento?.detail?.tono || 'error');
    };
    window.addEventListener('xentinel:session-expired', caducar);
    /* temporizador: valor de trabajo utilizado en esta operación. */
    const temporizador = sesion
      ? setTimeout(caducar, Math.max(0, sesion.venceEn - Date.now()))
      : undefined;
    return () => {
      clearTimeout(temporizador);
      window.removeEventListener('xentinel:session-expired', caducar);
    };
  }, [sesion]);
  useEfecto(() => {
    if (!sesion) return;
    /* controlador: instancia que se mantiene durante la operación y se libera cuando corresponde. */
    const controlador = new AbortController();
    solicitar('/auth/me', {
      signal: controlador.signal,
    }).catch(() => {
      /* El transporte resuelve sesiones revocadas; los fallos de red permiten reintento. */
    });
    return () => controlador.abort();
  }, [sesion]);
  return (
    <ContextoAutenticacion.Provider
      value={{
        usuario: sesion?.usuario || null,
        iniciarSesion,
        cerrarSesion,
        mensajeSesion,
        tonoSesion,
      }}
    >
      {contenido}
    </ContextoAutenticacion.Provider>
  );
}
export { ProveedorAutenticacion };
