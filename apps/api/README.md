# API App

TypeScript + Hono service for SEQ GTFS realtime vehicle positions.

## Stack

- Hono 4 (web framework)
- `@hono/node-server` (Node.js adapter)
- `gtfs-realtime-bindings` (protobuf decoding)
- Node 22 (runtime)
- `tsx` (dev), `tsc` (build)

## Commands

Run from the repo root:

```bash
npm --workspace @translink/api run dev      # tsx watch src/index.ts
npm --workspace @translink/api run build    # tsc -> dist/
npm --workspace @translink/api run start    # node dist/index.js
npm --workspace @translink/api run lint     # tsc --noEmit
```

The app runs on `http://localhost:8000` by default. Override with the
`PORT` environment variable.

## Endpoints

### `GET /`

Service metadata (name, version, status, endpoint list, data source).

### `GET /v1/seq/vehicle_positions`

Returns cached vehicle positions parsed from the Translink GTFS-realtime
feed as JSON:

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

## Architecture

- `src/index.ts` — Hono app with CORS middleware, route handlers for
  `GET /` and `GET /v1/seq/vehicle_positions`, and `@hono/node-server`
  bootstrap. Starts the background updater on import.
- `src/updater.ts` — Background fetch loop. Polls
  `https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions`
  every 30 seconds and writes the raw protobuf to
  `data/SEQ_VehiclePositions.pb`.
- `src/positions.ts` — Reads and decodes the cached protobuf using
  `gtfs-realtime-bindings` (loaded via `createRequire` for CJS interop).
  Extracts vehicle ID, route, trip, lat, lon, and bearing.

## Structure

```text
apps/api
├── src/
│   ├── index.ts           # Hono app + server bootstrap
│   ├── updater.ts         # Background Translink fetch loop
│   └── positions.ts       # GTFS-realtime protobuf parsing
├── data/                  # Runtime cache (gitignored, Docker volume)
├── Dockerfile             # Multi-stage Node build
├── tsconfig.json          # NodeNext, strict
└── package.json
```

## Runtime Data

The background updater fetches from Translink every 30 seconds and writes
`data/SEQ_VehiclePositions.pb`. The `data/` directory is gitignored and
mounted as a Docker named volume (`translink-api-data`) in
`docker-compose.yml`.

## Docker

Build context is `apps/api`. The image uses a two-stage build:

1. **Builder**: installs deps, runs `tsc` to emit `dist/`.
2. **Runner**: installs production-only deps, copies `dist/`, creates
   a non-root user, exposes port 8000, and includes a health check
   (`GET /` every 30s).

```bash
node dist/index.js
```
