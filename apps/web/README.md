# Web App

Next.js 16 frontend for the Translink realtime transit map.

## Stack

- Next.js 16 (App Router, standalone output)
- React 19
- MapLibre GL + MapTiler dark tiles
- TanStack React Query (30s polling)
- Tailwind CSS 4 + shadcn/ui

## Commands

Run from the repo root:

```bash
npm --workspace @translink/web run dev      # next dev (port 3000)
npm --workspace @translink/web run build    # next build (standalone)
npm --workspace @translink/web run lint     # eslint
```

Or run all apps through Turbo:

```bash
npm run dev
npm run lint
npm run build
```

## Environment Variables

Set in `.env.local` at the repo root (see `.example.env`):

| Variable                   | Required | Description                                                                                        |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_MAPTILER_KEY` | Yes      | MapTiler API key for map tiles (exposed to browser).                                               |
| `VEHICLE_API_URL`          | Yes      | Upstream API URL (server-side only). Defaults to `http://localhost:8000/v1/seq/vehicle_positions`. |

In Docker Compose, `VEHICLE_API_URL` is set to
`http://api:8000/v1/seq/vehicle_positions` so the web container proxies
to the API container over the internal network.

## Architecture

- `src/app/page.tsx` — dynamically imports `MapCanvas` (SSR disabled).
- `src/app/api/vehicles/route.ts` — Next.js server route that proxies
  `GET /api/vehicles` to the upstream `VEHICLE_API_URL`.
- `src/hooks/useVehicles.ts` — TanStack Query hook that polls
  `/api/vehicles` every 30 seconds.
- `src/components/map/MapCanvas.tsx` — MapLibre GL map with live vehicle
  markers and route-number filtering.
- `src/lib/geo.ts` — converts vehicle entities to GeoJSON FeatureCollections.

## Structure

```text
apps/web
├── src/
│   ├── app/
│   │   ├── api/vehicles/route.ts   # Server proxy to API
│   │   ├── globals.css              # Tailwind + theme
│   │   ├── layout.tsx               # Root layout (Geist font, dark)
│   │   ├── page.tsx                 # Map page
│   │   └── providers.tsx            # TanStack Query provider
│   ├── components/
│   │   ├── map/                     # MapCanvas
│   │   └── ui/                     # shadcn/ui components
│   ├── hooks/                       # useVehicles, useIsMobile
│   ├── lib/                         # geo, utils
│   └── types/                       # Shared types
├── Dockerfile                       # Multi-stage build (repo root context)
├── next.config.ts                   # standalone output
├── tsconfig.json
└── package.json
```

## Docker

The production image is built from the repo root context with
`apps/web/Dockerfile` so npm workspaces and the root lockfile are available
for `npm ci`. The builder runs `next build` (standalone mode), then the
runner copies only the standalone server, static assets, and public files
into a minimal image.
