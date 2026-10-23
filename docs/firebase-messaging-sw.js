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
