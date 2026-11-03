/* Домашние запасы · обновляемые файлы online-first, офлайн-копия в cache. */
const CACHE_PREFIX='domashnie-zapasy-shell-';
const CACHE=CACHE_PREFIX+'v10';
const BASE=new URL('./',self.location.href);
const ASSETS=['./','./index.html','./styles.css?v=20261103-06','./app.js?v=20261103-06','./catalog.js?v=20261103-05','./scanner.js?v=20261103-05','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key))))
   .then(()=>self.clients.claim())
 );
});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE.pathname))return;
 const appFile=req.mode==='navigate'||/\.(?:html|js|css|webmanifest)$/.test(url.pathname)||url.pathname===BASE.pathname;
 if(appFile){
  // Refresh HTML and JS from the network. Keep cache for offline use only.
  event.respondWith(
   fetch(req,{cache:'no-cache'}).then(response=>{
    if(response.ok){
     const copy=response.clone();
     event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)));
    }
    return response;
   }).catch(async()=>{
    const cached=await caches.match(req);
    if(cached)return cached;
    if(req.mode==='navigate')return await caches.match('./index.html')||Response.error();
    return Response.error();
   })
  );
 }else{
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(response=>{
   if(response.ok){
    const copy=response.clone();
    event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)));
   }
   return response;
  })));
 }
});
