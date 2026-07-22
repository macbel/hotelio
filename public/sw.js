const CACHE='hotelio-v6';
const BASE=new URL('./',self.registration.scope).pathname;
const ASSETS=[BASE,`${BASE}index.html`,`${BASE}manifest.webmanifest`,`${BASE}icon.svg`,`${BASE}src/main.js?v=1.1.1`,`${BASE}src/providers.js?v=1.1.1`,`${BASE}src/style.css?v=1.1.1`,`${BASE}src/components.css?v=1.1.1`,`${BASE}src/direct-search.css?v=1.1.1`,`${BASE}src/portal-status.css?v=1.1.1`,`${BASE}src/api-config.css?v=1.1.1`,`${BASE}src/saved.css?v=1.1.1`,`${BASE}src/search-v2.css?v=1.1.1`];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).then(response=>{const clone=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,clone));return response}).catch(()=>caches.match(event.request)))});
