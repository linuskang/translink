# Translink

Real-time SEQ (South East Queensland) transit map and API, organized as a
Turborepo monorepo.

## Apps

| App | Path       | Stack                                             | Port |
| --- | ---------- | ------------------------------------------------- | ---- |
| Web | `apps/web` | Next.js 16, React 19, MapLibre GL, TanStack Query | 3000 |
| API | `apps/api` | TypeScript, Hono, Node 22, `@hono/node-server`    | 8000 |

The **web** app is a Next.js frontend that renders a live transit map with
real-time vehicle positions. The **api** app is a Hono server that polls the
Translink GTFS-realtime feed every 30 seconds, caches the protobuf locally,
and serves parsed vehicle positions as JSON.

## Prerequisites

- **Node.js** 22+
- **npm** 10+
- **Docker** (for container builds / production)

## Quick Start

```bash
# Install dependencies
npm install

# Copy the example env file and fill in your keys
cp .example.env .env.local

# Start both apps in dev mode
npm run dev
```

Default URLs:

- Web: <http://localhost:3000>
- API: <http://localhost:8000>

## Environment Variables

Create `.env.local` in the repo root (see `.example.env`):

| Variable                   | Scope             | Required | Description                                                                                                               |
| -------------------------- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_MAPTILER_KEY` | Web (public)      | Yes      | MapTiler API key for map tiles. Exposed to the browser.                                                                   |
| `VEHICLE_API_URL`          | Web (server only) | Yes      | Upstream vehicle positions API. Defaults to `http://localhost:8000/v1/seq/vehicle_positions`. Not exposed to the browser. |
| `PORT`                     | API               | No       | API server port. Defaults to `8000`.                                                                                      |

In Docker Compose, `VEHICLE_API_URL` is set to `http://api:8000/v1/seq/vehicle_positions`
so the web container proxies to the API container over the internal network.

## Development

Run both apps concurrently through Turbo:

```bash
npm run dev          # turbo run dev (both apps)
```

Run a single app:

```bash
npm --workspace @translink/web run dev
npm --workspace @translink/api run dev
```

### How It Works

1. The API backgrounds a fetch loop that polls
   `https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions`
   every 30 seconds and writes the raw protobuf to
   `apps/api/data/SEQ_VehiclePositions.pb`.
2. On each request to `GET /v1/seq/vehicle_positions`, the API reads the
   cached protobuf, decodes it with `gtfs-realtime-bindings`, and returns
   a JSON array of vehicle positions.
3. The web app's `/api/vehicles` route (Next.js server route) proxies to the
   API. The client polls this route every 30 seconds via TanStack Query.
4. The map renders vehicle positions as GeoJSON points and supports filtering
   by route number.

## Scripts

Run from the repo root:

| Command                | Description                         |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Start both apps in dev mode (Turbo) |
| `npm run build`        | Build all apps (Turbo)              |
| `npm run lint`         | Lint all apps (Turbo)               |
| `npm run format`       | Format all files with Prettier      |
| `npm run format:check` | Check formatting without writing    |

Per-app commands:

```bash
npm --workspace @translink/web run dev      # next dev
npm --workspace @translink/web run build    # next build
npm --workspace @translink/web run lint     # eslint

npm --workspace @translink/api run dev      # tsx watch src/index.ts
npm --workspace @translink/api run build     # tsc -> dist/
npm --workspace @translink/api run start    # node dist/index.js
npm --workspace @translink/api run lint     # tsc --noEmit
```

## Project Structure

```text
.
├── .github/workflows/
│   └── build.yml                    # CI: builds and pushes both GHCR images
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts             # Hono app + server bootstrap
│   │   │   ├── updater.ts           # Background Translink fetch loop
│   │   │   └── positions.ts         # GTFS-realtime protobuf parsing
│   │   ├── data/                    # Runtime cache (gitignored, Docker volume)
│   │   ├── Dockerfile
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── web/
│       ├── src/
│       │   ├── app/                 # Next.js App Router
│       │   │   ├── api/vehicles/    # Server route proxying to the API
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx         # Map page
│       │   │   └── providers.tsx    # TanStack Query provider
│       │   ├── components/map/      # MapCanvas
│       │   ├── components/ui/       # shadcn/ui components
│       │   ├── hooks/               # useVehicles, useIsMobile
│       │   ├── lib/                 # geo helpers, cn()
│       │   └── types/               # Shared TypeScript types
│       ├── Dockerfile
│       ├── next.config.ts
│       └── package.json
├── .dockerignore
├── .gitignore
├── .prettierrc
├── .prettierignore
├── .example.env
├── docker-compose.yml
├── package.json
├── package-lock.json
└── turbo.json
```

## API Reference

### `GET /`

Service metadata.

**Response:**

```json
{
  "service": "Transit Live API",
  "description": "Real-time Brisbane Transit (SEQ) vehicle position tracking",
  "version": "1.0.0",
  "status": "operational",
  "endpoints": { ... },
  "update_interval": "30 seconds",
  "data_source": "https://gtfsrt.api.translink.com.au/..."
}
```

### `GET /v1/seq/vehicle_positions`

Cached vehicle positions from Translink GTFS realtime.

**Response:**

```json
{
    "vehicles": [
        {
            "vehicle": "DE58B3C0...",
            "route": "282",
            "trip": "37632990-TDEV 26_27-43012",
            "lat": -27.585,
            "lon": 153.281,
            "bearing": 0
        }
    ]
}
```

## Docker

### Validate the production compose file

```bash
docker compose config
```

### Build and run both services

```bash
docker compose up --build
```

### Images

| Service | Image                        | Build context   | Dockerfile            |
| ------- | ---------------------------- | --------------- | --------------------- |
| Web     | `ghcr.io/<owner>/<repo>-app` | `.` (repo root) | `apps/web/Dockerfile` |
| API     | `ghcr.io/<owner>/<repo>-api` | `apps/api`      | `apps/api/Dockerfile` |

Both images use `node:22-alpine` multi-stage builds:

- **Web**: builder installs all workspace deps with `npm ci`, runs
  `next build` (standalone output), then copies the standalone server +
  static assets into a minimal runner image.
- **API**: builder installs deps and runs `tsc`, then the runner installs
  production-only deps and copies `dist/`. The `data/` directory is a
  named volume (`translink-api-data`) for the protobuf cache.

### Health Checks

The API Dockerfile includes a health check (`GET /` every 30s). The web
service depends on the API being healthy before starting.

## CI/CD

A single GitHub Actions workflow (`.github/workflows/build.yml`) builds both
GHCR images in parallel via a matrix:

| Matrix target | Image                        | Build args                 |
| ------------- | ---------------------------- | -------------------------- |
| `app`         | `ghcr.io/<owner>/<repo>-app` | `NEXT_PUBLIC_MAPTILER_KEY` |
| `api`         | `ghcr.io/<owner>/<repo>-api` | _(none)_                   |

**Triggers:** push or PR to `main`/`master`, plus `workflow_dispatch`.

**Behavior:**

- Pull requests build images without pushing (validates the build).
- Pushes to the default branch build and push to GHCR with tags:
    - `latest` (default branch only)
    - `<branch>` (branch name)
    - `<branch>-<sha>` (short commit SHA)
    - Semantic version tags on git tags (`v1.0.0`, `v1.0`, `v1`)

**Caching:** each target uses a scoped GitHub Actions cache (`type=gha`)
to avoid rebuilding layers across runs.

**Required secrets:**

- `NEXT_PUBLIC_MAPTILER_KEY` — used as a Docker build arg for the web image.

## License

CC BY-NC 4.0 — see `package.json`.
