// Shadow CO – service worker : l'appli fonctionne hors connexion une fois ouverte.
const CACHE = 'shadowco-v1.3.0';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // fonds de carte : réseau direct
  if (req.mode === 'navigate') { // page : la dernière version si le réseau répond vite, sinon celle gardée hors ligne
    e.respondWith(caches.open(CACHE).then(async c => {
      try {
        const r = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('lent')), 4000))]);
        if (r && r.ok) c.put('./index.html', r.clone());
        return r;
      } catch (err) { return (await c.match('./index.html')) || (await c.match(req, { ignoreSearch: true })) || Response.error(); }
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
