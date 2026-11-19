/* Alertas sísmicas con el navegador minimizado o cerrado (Firebase Cloud Messaging).
   La configuración pública de Firebase llega en la URL con la que se registra este archivo.
   La versión debe coincidir con la del paquete "firebase" de package.json. */
/* global firebase */
self.importScripts(
  'https://www.gstatic.com/firebasejs/13.2.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging-compat.js'
);

firebase.initializeApp(Object.fromEntries(new URL(self.location.href).searchParams));
const mensajeria = firebase.messaging();

// Los mensajes con "notification" (los del servidor) los muestra el SDK; aquí solo se arman
// los que lleguen únicamente con datos.
mensajeria.onBackgroundMessage((mensaje) => {
  if (mensaje.notification) return;
  const datos = mensaje.data || {};
  self.registration.showNotification(datos.titulo || 'Alerta sísmica', {
    body: datos.mensaje || 'Agáchate, cúbrete y sujétate.',
    tag: `sismo-${datos.id_alerta || Date.now()}`,
    renotify: true,
    requireInteraction: true,
    vibrate: [600, 200, 600, 200, 600],
    icon: '/favicon-xentinel.png',
    data: { url: '/login' },
  });
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = evento.notification.data?.url || '/login';
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      const abierta = ventanas.find((ventana) => 'focus' in ventana);
      return abierta ? abierta.focus() : self.clients.openWindow(destino);
    })
  );
});
