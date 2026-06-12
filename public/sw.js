// Service worker mínimo: habilita la instalación como PWA y sirve de base
// para notificaciones push en el futuro. No cachea peticiones para evitar
// mostrar resultados o clasificaciones desactualizadas.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
