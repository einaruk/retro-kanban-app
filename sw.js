// Uygulama kabuğunu önbellekte tutar (çevrimdışı açılış) ve bilgisayardan gelen Web Push
// bildirimlerini gösterir. Önce ağ denenir: yayınlanan yeni sürüm bir sonraki açılışta gelir.
const CACHE = 'rk-v1'; // eski önbellekler silinsin diye kabuk dosya listesi değişince artırılır
const SHELL = ['./', 'index.html', 'app.js', 'github.js', 'issues.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // GitHub API'ye dokunulmaz
  e.respondWith(fetch(e.request)
    .then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data?.json() ?? {}; } catch { data = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title ?? 'Ödev Panosu', {
    body: data.body ?? '',
    tag: data.tag,
    icon: 'icons/icon-192.png',
    data: { issue: data.issue ?? null },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const issue = e.notification.data?.issue;
  const target = new URL(issue ? `./?issue=${issue}` : './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list[0];
    if (!win) return self.clients.openWindow(target);
    if (issue) win.postMessage({ issue });
    return win.focus();
  }));
});
