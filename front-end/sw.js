const CACHE = "adapt-ia-v3";

self.addEventListener("install", e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: sempre busca da rede, usa cache só se offline
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  if (e.request.method !== "GET") return;
  if (["/chat", "/chat-stream", "/upload", "/admin", "/profile"].some(p => url.pathname.startsWith(p))) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
