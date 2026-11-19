/** Alertas sísmicas por Firebase Cloud Messaging en el navegador (tema alertas_sismo). */
import {
  claveVapid,
  firebaseWeb,
  pushConfigurado,
} from '../../configuracion/firebase.js';
import { solicitar } from './cliente.js';

const ALCANCE = '/firebase-cloud-messaging-push-scope';
let mensajeria = null;

async function obtenerMensajeria() {
  if (mensajeria) return mensajeria;
  const [{ initializeApp, getApps }, { getMessaging }] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ]);
  mensajeria = getMessaging(getApps()[0] || initializeApp(firebaseWeb));
  return mensajeria;
}

/** El navegador admite push y la web tiene configuración de Firebase. */
export async function pushDisponible() {
  if (!pushConfigurado || !('Notification' in window)) return false;
  const { isSupported } = await import('firebase/messaging');
  return isSupported();
}

export const permisoPush = () =>
  'Notification' in window ? Notification.permission : 'denied';

/** Pide permiso, registra el service worker y suscribe este navegador en el servidor. */
export async function activarAlertasSismo() {
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error(
      'El navegador bloqueó las notificaciones. Actívalas en la configuración del sitio.'
    );
  // La configuración pública viaja en la URL: el service worker no lee variables de Vite.
  const registro = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${new URLSearchParams(firebaseWeb)}`,
    { scope: ALCANCE }
  );
  const { getToken } = await import('firebase/messaging');
  const token = await getToken(await obtenerMensajeria(), {
    vapidKey: claveVapid,
    serviceWorkerRegistration: registro,
  });
  await solicitar('/alertas/suscribir-web', {
    method: 'POST',
    body: { token },
  });
}

/** Con la pestaña abierta, un sismo recarga las alertas: el aviso a pantalla completa aparece al instante. */
export async function escucharAlertasEnPrimerPlano() {
  if (!(await pushDisponible()) || permisoPush() !== 'granted') return () => {};
  const { onMessage } = await import('firebase/messaging');
  return onMessage(await obtenerMensajeria(), () =>
    window.dispatchEvent(new Event('xentinel:alerts-changed'))
  );
}
