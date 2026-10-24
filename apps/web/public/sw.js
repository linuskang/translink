const SHELL_CACHE = "seq-transit-shell-v1";
const TILE_CACHE = "seq-transit-tiles-v1";
const MAX_TILE_ENTRIES = 180;

const PRECACHE_URLS = [
    "/",
    "/manifest.webmanifest",
    "/icon-192.png",
    "/icon-512.png",
    "/apple-touch-icon.png",
    "/icon.svg",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(SHELL_CACHE)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .catch(() => {})
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE)
                        .map((k) => caches.delete(k))
                )
            )
            .then(() => self.clients.claim())
    );
});

async function putBoundedTile(cache, request, response) {
    await cache.put(request, response);
    const keys = await cache.keys();
    if (keys.length > MAX_TILE_ENTRIES) {
        const overflow = keys.length - MAX_TILE_ENTRIES;
        for (let i = 0; i < overflow; i++) {
            await cache.delete(keys[i]);
        }
    }
}

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);

    // Never intercept live API endpoints in SW so realtime delta sync & ETag 304 stay direct
    if (
        url.origin === self.location.origin &&
        url.pathname.startsWith("/api/")
    ) {
        return;
    }

    // Cache immutable Next.js static chunks
    if (
        url.origin === self.location.origin &&
        (url.pathname.startsWith("/_next/static/") ||
            url.pathname.endsWith(".png") ||
            url.pathname.endsWith(".svg") ||
            url.pathname === "/manifest.webmanifest")
    ) {
        event.respondWith(
            caches.open(SHELL_CACHE).then(async (cache) => {
                const cached = await cache.match(req);
                if (cached) return cached;
                const fresh = await fetch(req);
                if (fresh.ok) {
                    cache.put(req, fresh.clone());
                }
                return fresh;
            })
        );
        return;
    }

    // Cache basemap raster tiles with bounded LRU to save mobile data
    if (
        url.hostname.includes("maptiler.com") ||
        url.hostname.includes("cartocdn.com")
    ) {
        event.respondWith(
            caches.open(TILE_CACHE).then(async (cache) => {
                const cached = await cache.match(req);
                if (cached) return cached;
                const fresh = await fetch(req);
                if (fresh.ok) {
                    void putBoundedTile(cache, req, fresh.clone());
                }
                return fresh;
            })
        );
        return;
    }

    // Navigation requests: network-first with cached app shell fallback when offline
    if (req.mode === "navigate") {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res.ok) {
                        const copy = res.clone();
                        caches
                            .open(SHELL_CACHE)
                            .then((c) => c.put("/", copy))
                            .catch(() => {});
                    }
                    return res;
                })
                .catch(async () => {
                    const cache = await caches.open(SHELL_CACHE);
                    return (
                        (await cache.match(req)) ||
                        (await cache.match("/")) ||
                        Response.error()
                    );
                })
        );
    }
});
