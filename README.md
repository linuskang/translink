# Translink SEQ Live

Real-time South East Queensland (SEQ) transit map, Progressive Web App (PWA), and GTFS Static + Realtime API organized as a Turborepo monorepo.

## Apps

| App | Path       | Stack                                                          | Port |
| --- | ---------- | -------------------------------------------------------------- | ---- |
| Web | `apps/web` | Next.js 16, React 19, MapLibre GL, TanStack Query, PWA         | 3000 |
| API | `apps/api` | TypeScript, Hono 4, Node 22 (`node:sqlite`, `node:zlib`), GTFS | 8000 |

- **`@translink/api`**: Indexes Translink's static GTFS schedule (`SEQ_GTFS.zip` — routes, official colors, headsigns, stop sequences, and `shapes.txt` polylines) into a local SQLite index (`node:sqlite`) and merges all three 30-second GTFS-Realtime feeds (`VehiclePositions`, `TripUpdates`, `Alerts`), computing live vehicle bearings and speeds while serving pre-compressed Brotli/Gzip incremental delta syncs.
- **`@translink/web`**: Installable mobile/desktop PWA rendering 100% of active buses, trains, ferries, and trams with GPU-rotated directional markers, route polylines, Inbound/Outbound direction switching, live stop arrival predictions, and low-data delta polling (~9 KB per 30s poll).

## Prerequisites

- **Node.js** 22.5+ (uses built-in `node:sqlite`)
- **npm** 10+
- **Docker** (optional, for container builds / production)

## Quick Start

```bash
# Install dependencies
npm install

# Optional: copy .example.env to .env.local (works out of the box without keys)
cp .example.env .env.local

# Start both apps in dev mode
npm run dev
```

Default URLs:

- Web: <http://localhost:3000>
- API: <http://localhost:8000>

## Environment Variables

Create `.env.local` in the repo root (see `.example.env`):

| Variable                   | Scope             | Required | Description                                                                                                     |
| -------------------------- | ----------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_MAPTILER_KEY` | Web (public)      | No       | MapTiler API key for vector `dataviz-dark` tiles. Falls back automatically to CARTO Dark Matter `@2x` if unset. |
| `TRANSIT_API_URL`          | Web (server only) | No       | Upstream API origin (`http://localhost:8000` by default, or derived automatically from `VEHICLE_API_URL`).      |
| `VEHICLE_API_URL`          | Web (server only) | No       | Legacy-compatible vehicle URL (`http://localhost:8000/v1/seq/vehicle_positions` by default).                    |
| `PORT`                     | API               | No       | API server port (`8000` by default).                                                                            |

## Mobile Data Optimization

All active SEQ vehicles (~650–1,000+ at peak) remain loaded simultaneously on the map without dropping or viewport-culling vehicles:

1. **Dictionary + Quantized Tuple Encoding**: Route metadata (`[shortName, longName, modeCode, color, textColor]`) and trip headsigns are interned into append-only dictionaries instead of repeating strings per vehicle. Coordinates use `1e5`-scaled integer tuples (~1.1 m precision).
2. **30-Second Incremental Delta Sync (`GET /v1/seq/vehicles/sync?since=<seq>&epoch=<epoch>`)**: Subsequent polls transmit only coordinate deltas (`[id, dLatE5, dLonE5, bearing, speedKmh, statusCode, delaySec, ageSec]`) plus newly added or removed vehicles.
3. **Pre-Compressed Brotli (`br`) & `ETag` (`304 Not Modified`)**:
    - Initial full snapshot (~670 vehicles): **~20–22 KB** over the wire (Brotli) vs ~180+ KB uncompressed verbose JSON.
    - 30-second delta update: **~8–9.5 KB** over the wire (Brotli).
    - Unchanged feed tick: **`304 Not Modified` (`0 B` body)**.
4. **Visibility-Aware Polling & Tile Caching**: Background tabs / locked phone screens pause polling automatically (`document.visibilityState`) and catch up immediately on wake; the PWA service worker (`public/sw.js`) caches app shell assets and basemap tiles.

## API Reference

| Endpoint                        | Description                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /`                         | Service metadata, endpoint directory, and feed health summary.                                         |
| `GET /v1/health`                | Realtime feed ages, active counts by mode, static GTFS feed validity dates, and wire-byte telemetry.   |
| `GET /v1/seq/vehicles/sync`     | Compact full snapshot or incremental delta (`?since=<seq>&epoch=<epoch>`), `ETag` + Brotli/Gzip.       |
| `GET /v1/seq/vehicle_positions` | Enriched JSON vehicle list (`?route=`, `?mode=`, `?direction=`, `?bbox=`).                             |
| `GET /v1/seq/vehicles/:id`      | Single vehicle telemetry, exact trip GeoJSON `LineString` shape, stop ETA sequence, and route alerts.  |
| `GET /v1/seq/routes`            | Searchable GTFS route catalog (`?q=`, `?mode=`, `?activeOnly=1`) with active counts per direction.     |
| `GET /v1/seq/routes/:routeKey`  | Full route details with **both directions** (`directionId` `0` & `1`, shapes, stops, active vehicles). |
| `GET /v1/seq/stops`             | Stop search by name, stop code, ID, or proximity (`?q=`, `?lat=&lon=&radius=`).                        |
| `GET /v1/seq/stops/:stopId`     | Stop & child station platforms with live predicted departures for the next 90 minutes.                 |
| `GET /v1/seq/alerts`            | Active GTFS-Realtime service alerts filtered by `?route=`, `?stopId=`, `?tripId=`, or `?mode=`.        |

## Scripts

Run from the repo root:

| Command                | Description                         |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Start both apps in dev mode (Turbo) |
| `npm run build`        | Build all apps (Turbo)              |
| `npm run lint`         | Lint all apps (Turbo)               |
| `npm run format`       | Format all files with Prettier      |
| `npm run format:check` | Check formatting without writing    |

## Docker

```bash
docker compose config
docker compose up --build
```

- **API (`apps/api/Dockerfile`)**: Multi-stage `node:22-alpine` build with `translink-api-data` volume storing `seq_gtfs.sqlite`, `SEQ_GTFS.zip`, and cached `.pb` realtime feeds, plus `/v1/health` container healthcheck.
- **Web (`apps/web/Dockerfile`)**: Multi-stage Next.js standalone runner including `public/` PWA icons and service worker (`sw.js`).

## License

CC BY-NC 4.0 — see `package.json`.
