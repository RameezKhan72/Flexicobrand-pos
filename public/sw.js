/* Flexico POS offline application shell ONLY. Sales need a running Node.js POS server. */
'use strict';
const CACHE='flexico-shell-v1.3.0';
const SHELL=['/','/index.html','/styles.css','/pro.css','/brand-cream.css','/app.js','/favicon.svg','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install', event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE&&key.startsWith('flexico-shell-')).map(key=>caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/uploads/'))return;
  // Network-first prevents silently using stale cashier code while connected.
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).catch(()=>caches.match('/index.html')));
    return;
  }
  if(!SHELL.includes(url.pathname))return;
  event.respondWith(fetch(req).then(response=>{
    if(response.ok){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(url.pathname,clone)));}
    return response;
  }).catch(()=>caches.match(url.pathname)));
});
