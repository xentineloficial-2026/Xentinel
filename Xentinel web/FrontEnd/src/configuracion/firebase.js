// Configuración web pública de Firebase (no es secreta). Sin estas variables, las
// notificaciones push del navegador quedan desactivadas y la web sigue funcionando igual.
const entorno = import.meta.env ?? {};
const firebaseWeb = {
  apiKey: entorno.VITE_FIREBASE_API_KEY || '',
  projectId: entorno.VITE_FIREBASE_PROJECT_ID || '',
  messagingSenderId: entorno.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: entorno.VITE_FIREBASE_APP_ID || '',
};
const claveVapid = entorno.VITE_FIREBASE_VAPID_KEY || '';
const pushConfigurado =
  Object.values(firebaseWeb).every(Boolean) && Boolean(claveVapid);
export { claveVapid, firebaseWeb, pushConfigurado };
