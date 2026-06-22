const CACHE='clipforge-studio-v4';
const ASSETS=['/index.html','/app.js','/manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=e.request.url;
  // never cache API or CDN engine
  if(u.includes('anthropic.com')||u.includes('unpkg.com')){ e.respondWith(fetch(e.request).catch(()=>new Response('',{status:503}))); return; }
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));
});
