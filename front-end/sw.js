const CACHE = "adapt-ia-v2";
const STATIC = [
  "/index.html",
  "/chat.html",
  "/settings.html",
  "/assets/styles/index.css",
  "/assets/styles/chat.css",
  "/assets/styles/settings.css",
  "/assets/js/api.js",
  "/assets/js/auth.js",
  "/assets/js/chat.js",
  "/assets/js/database.js",
  "/assets/js/main.js",
  "/assets/js/settings.js",
  "/assets/js/theme.js",
  "/assets/js/supabaseClient.js",
  "/assets/robot-avatar.svg",
  "/assets/favicon.ico"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first para estáticos, network-first para API
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Requisições para o backend sempre vão para a rede
  if (["/chat", "/chat-stream", "/upload", "/admin"].some(p => url.pathname.startsWith(p))) {
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok && e.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
