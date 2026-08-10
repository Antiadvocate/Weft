/** Weaver's service worker.
 *
 *  It exists for one reason: a push notification cannot be delivered without one. There is no
 *  offline caching here on purpose — the app is already installed to the home screen, its assets
 *  are hash-named, and a cache layer between the player and their own save is a way to serve stale
 *  code after a deploy without anybody understanding why.
 *
 *  So this handles two events and nothing else: a push arriving, and the player tapping it. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "Weaver", body: "Your turn is ready." };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* keep the default */ }
  event.waitUntil(self.registration.showNotification(data.title || "Weaver", {
    body: data.body,
    // One tag for turn notifications, so a second turn replaces the first rather than stacking up
    // a column of them on the lock screen.
    tag: data.tag || "weaver-turn",
    renotify: true,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: "./" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Focus the app if it is already open rather than opening a second copy — two live copies of the
  // same save in two windows is a good way to lose one of them.
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) return c.focus();
    }
    return self.clients.openWindow(event.notification.data?.url || "./");
  })());
});
