/* Service worker for the admin dashboard's browser push (optional).
   It wakes the page to re-sync; it never carries message content. Does nothing unless firebase-web-config.js is filled in. */
importScripts('firebase-web-config.js');
try {
  if (self.FIREBASE_WEB && self.FIREBASE_WEB.apiKey) {
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
    firebase.initializeApp(self.FIREBASE_WEB);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage(() => {
      self.registration.showNotification('New message', { body: 'Open the admin page to read it.', tag: 'wlb-msg' });
    });
  }
} catch (e) { /* no config / offline: the dashboard falls back to its normal refresh */ }

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    if (clients.openWindow) return clients.openWindow('admin.html');
  }));
});

/* Background save outbox. The admin page leaves the latest pending save, fully sealed and ready to POST, in IndexedDB
   (db 'wl-admin', store 'kv', key 'outbox'). This worker sends it — even after the page has closed — and retries when
   back online via a 'wl-drain' background-sync. A superseded save is harmless: the automation rejects it (REPLAY). */
function wlOpenDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('wl-admin', 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onupgradeneeded = () => { try { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); } catch (e) {} };
  });
}
function wlOutbox(mode, fn) {
  return wlOpenDb().then(db => new Promise(resolve => {
    let out = null;
    try {
      if (!db.objectStoreNames.contains('kv')) { resolve(null); return; }
      const t = db.transaction('kv', mode), s = t.objectStore('kv'), q = fn(s);
      if (q) q.onsuccess = () => { out = q.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  })).catch(() => null);
}
async function wlDrain() {
  const req = await wlOutbox('readonly', s => s.get('outbox'));
  if (!req || !req.url || !req.body) return;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(req.url, { method: req.method || 'POST', headers: req.headers, body: req.body });
      if (res.ok || res.status === 401 || res.status === 403 || res.status === 422) { await wlOutbox('readwrite', s => s.delete('outbox')); return; }
    } catch (e) { /* offline: keep it; background-sync will fire again when back online */ }
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
}
self.addEventListener('message', event => { if (event.data && event.data.type === 'wl-drain') event.waitUntil(wlDrain()); });
self.addEventListener('sync', event => { if (event.tag === 'wl-drain') event.waitUntil(wlDrain()); });
