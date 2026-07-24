const CACHE='hotelio-v9';
const BASE=new URL('./',self.registration.scope).pathname;
const ASSETS=[BASE,`${BASE}index.html`,`${BASE}manifest.webmanifest`,`${BASE}icon.svg`,`${BASE}data/airports.json`,`${BASE}src/main.js?v=1.2.2`,`${BASE}src/providers.js?v=1.2.2`,`${BASE}src/flights.js?v=1.2.2`,`${BASE}src/style.css?v=1.2.2`,`${BASE}src/components.css?v=1.2.2`,`${BASE}src/direct-search.css?v=1.2.2`,`${BASE}src/portal-status.css?v=1.2.2`,`${BASE}src/api-config.css?v=1.2.2`,`${BASE}src/saved.css?v=1.2.2`,`${BASE}src/search-v2.css?v=1.2.2`,`${BASE}src/flights.css?v=1.2.2`];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).then(response=>{const clone=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,clone));return response}).catch(()=>caches.match(event.request)))});
