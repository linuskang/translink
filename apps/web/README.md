# `@translink/web`

Next.js 16 real-time South East Queensland transit map and installable mobile Progressive Web App (PWA).

## Stack

- **Next.js 16** (App Router, standalone Docker output)
- **React 19**
- **MapLibre GL** (MapTiler `dataviz-dark` vector style when `NEXT_PUBLIC_MAPTILER_KEY` is provided, with automatic keyless fallback to CARTO Dark Matter `@2x` raster tiles)
- **TanStack React Query** (on-demand vehicle/route/stop detail queries) + custom visibility-aware incremental delta sync hook
- **Tailwind CSS 4** (flat, high-contrast dark transit palette with zero gradients)

## Commands

Run from the repo root:

```bash
npm --workspace @translink/web run dev      # next dev (port 3000)
npm --workspace @translink/web run build    # next build (standalone)
npm --workspace @translink/web run lint     # eslint
```

## Key Features

- **100% Fleet Coverage with Minimal Mobile Data**: [`src/hooks/useVehicles.ts`](./src/hooks/useVehicles.ts) synchronizes against `/api/vehicles/sync` using append-only route/headsign dictionaries, integer coordinate deltas (`?since=<seq>&epoch=<epoch>`), `ETag` (`304 Not Modified`), Brotli compression, `totalCount` invariant verification, and automatic background pause when the phone screen or browser tab is hidden.
- **Interactive Route & Direction Inspector**: Clicking any bus, train, ferry, or tram opens [`src/components/inspector/InspectorSheet.tsx`](./src/components/inspector/InspectorSheet.tsx) and draws its exact GTFS polyline + stops on [`src/components/map/MapCanvas.tsx`](./src/components/map/MapCanvas.tsx). Users can switch between **Inbound** and **Outbound** directions, overlay both direction paths simultaneously (solid primary + dashed secondary polyline), inspect live per-stop arrival predictions and delays, or tap any stop for upcoming departures.
- **GPU-Rotated Directional Markers**: Vehicles render crisp `@2x` canvas badges colored by official Translink route colors (`BUZ`, `CityGlider`, QR rail line colors, Ferry, G:link) with directional heading arrows and smooth 1.1s GPS interpolation that idles at 0 FPS between updates to save mobile battery.
- **Installable Mobile PWA**:
    - Web App Manifest ([`src/app/manifest.ts`](./src/app/manifest.ts)) + Apple touch icon & standalone status-bar metadata ([`src/app/layout.tsx`](./src/app/layout.tsx)).
    - Service worker ([`public/sw.js`](./public/sw.js)) caching app shell static assets and a bounded LRU basemap tile cache while keeping `/api/*` live.
    - Responsive 3-snap draggable bottom sheet on mobile (`peek` / `half` / `full`) with iOS safe-area inset handling (`env(safe-area-inset-*)`).
