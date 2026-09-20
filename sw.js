/* Service worker do Vesty Aí.
   Guarda apenas a casca do app (HTML, CSS, JS) para abrir rápido e funcionar
   com internet ruim. Nunca guarda dados nem fotos da cliente: esses só chegam
   pela rede, com a sessão dela. */

const VERSAO = "vesty-casca-v1";
const CASCA = [
  "./index.html",
  "./app.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icone.svg",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((cache) => cache.addAll(CASCA)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Dados e fotos sempre da rede: nada da cliente fica no cache do navegador.
  if (url.origin !== self.location.origin) return;

  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        if (resposta.ok && CASCA.some((c) => url.pathname.endsWith(c.replace("./", "")))) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(req, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match("./index.html"))),
  );
});
