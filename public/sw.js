/*
 * Self-unregistering kill-switch service worker.
 *
 * This file previously hosted Monetag's ad/push service worker, which ran
 * `importScripts('https://5gvci.com/...')` and installed a fetch handler that
 * intercepted navigation/RSC requests. When that remote script was blocked or
 * unreachable, the handler broke page loads — profiles and politician pages
 * rendered the loading skeleton but never swapped in content (Bug #0795).
 *
 * Deleting the file alone does not help browsers that already registered the
 * old worker: a 404 on the script does not reliably unregister an installed SW.
 * Browsers DO re-fetch this script (on navigation and on their periodic update
 * check) and, on seeing it changed, install this version. This worker then
 * clears all caches, unregisters itself, and reloads open tabs so they run
 * SW-free from then on.
 *
 * It deliberately registers NO fetch handler, so it never intercepts requests.
 */

self.addEventListener("install", () => {
  // Activate immediately, replacing the previously-installed worker.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop anything the old worker cached.
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch {
        // caches API may be unavailable; unregister regardless.
      }

      // Take control of open tabs from the previously-active worker. Without
      // this, those tabs stay controlled by the old worker until reload, and
      // WindowClient.navigate() below would reject (it only works on clients
      // this worker controls).
      await self.clients.claim();

      // Remove this registration so future loads are not controlled by any SW.
      await self.registration.unregister();

      // Reload controlled tabs once so they re-request resources without the SW.
      // A one-time URL marker makes this idempotent: if an external ad tag keeps
      // re-registering /sw.js, the marked tab is skipped here, so we never loop.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        if (!("navigate" in client)) continue;
        const url = new URL(client.url);
        if (url.searchParams.has("sw-cleared")) continue;
        url.searchParams.set("sw-cleared", "1");
        client.navigate(url.href);
      }
    })()
  );
});
