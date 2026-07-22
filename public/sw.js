const CACHE='hotelio-v3';
const BASE=new URL('./',self.registration.scope).pathname;
const ASSETS=[BASE,`${BASE}index.html`,`${BASE}manifest.webmanifest`,`${BASE}icon.svg`,`${BASE}src/main.js`,`${BASE}src/providers.js`,`${BASE}src/style.css`,`${BASE}src/components.css`,`${BASE}src/direct-search.css`,`${BASE}src/portal-status.css`,`${BASE}src/api-config.css`,`${BASE}src/saved.css`];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).then(response=>{const clone=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,clone));return response}).catch(()=>caches.match(event.request)))});
