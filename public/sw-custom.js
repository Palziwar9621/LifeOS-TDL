// LifeOS — custom service worker: web push alarms that work even when the
// app AND browser are closed. Imported by the vite-plugin-PWA generated SW
// via importScripts (see vite.config.ts importScripts option).
//
// Flow: Supabase Edge Function (cron, every minute) finds due items and sends
// a Web Push per subscription. This worker receives the push and shows a
// max-importance notification with vibration. Tapping it opens the app.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePayload(raw) {
  try { return raw ? raw.json() : {}; } catch { return {}; }
}

self.addEventListener('push', (event) => {
  const p = parsePayload(event.data);
  const title = p.title || '⏰ LifeOS alarm';
  const body = p.body || 'Time is up — open LifeOS.';
  const kind = p.kind || 'reminder';
  const key = p.key || String(Date.now());

  event.waitUntil((async () => {
    // Bring any existing alarm notification for this key to front, else create.
    const showOpts = {
      body,
      tag: 'lifeos-alarm-' + key,
      renotify: true,
      requireInteraction: true, // stays on screen until user acts
      vibrate: [500, 150, 500, 150, 500, 150, 800], // long, loud pattern
      silent: false, // use the system notification sound ( loudest option with app closed)
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { key, kind, url: p.url || '/' },
      actions: [
        { action: 'snooze', title: 'Snooze 10m' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };
    const all = await self.registration.getNotifications({ tag: showOpts.tag });
    if (all.length) { all.forEach((n) => n.close()); }
    await self.registration.showNotification(title, showOpts);
    // Ask every open LifeOS client to run its in-app alarm too (louder WebAudio
    // when the app happens to be open on this device).
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) c.postMessage({ type: 'lifeos-alarm', key, kind, title, body });
  })());
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  const action = event.action;
  n.close();

  event.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = (self.registration.scope + (data.url || '').replace(/^\//, ''));
    if (action === 'snooze') {
      // Tell the app to re-ring in 10 minutes. If it's closed, open it with a
      // snooze param the app picks up on boot.
      for (const c of cs) { c.postMessage({ type: 'lifeos-snooze', key: data.key, kind: data.kind }); c.focus?.(); break; }
      if (cs.length) return;
      return self.clients.openWindow('/?lifeos-snooze=' + encodeURIComponent(data.key) + '&min=10');
    }
    if (action === 'dismiss') {
      for (const c of cs) { c.postMessage({ type: 'lifeos-dismiss', key: data.key }); break; }
      return;
    }
    // Plain tap → open/focus the app.
    for (const c of cs) {
      if ('focus' in c) { await c.focus(); if (c.navigate && data.url) await c.navigate(target).catch(() => {}); return; }
    }
    return self.clients.openWindow(target);
  })());
});

// Forward app messages (e.g. snooze from in-app UI) if needed later.
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'lifeos-close-alarm' && d.key) {
    (async () => {
      const all = await self.registration.getNotifications({ tag: 'lifeos-alarm-' + d.key });
      all.forEach((n) => n.close());
    })();
  }
});
