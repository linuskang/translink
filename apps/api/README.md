# `@translink/api`

High-throughput TypeScript + Hono transit engine combining Translink's **SEQ GTFS Static** schedule (`SEQ_GTFS.zip`) with all three **SEQ GTFS-Realtime** protobuf feeds (`VehiclePositions`, `TripUpdates`, `Alerts`).

## Stack

- **Hono 4** + `@hono/node-server`
- **`gtfs-realtime-bindings`** (GTFS-Realtime protobuf decoding)
- **Node 22 built-ins**:
    - `node:sqlite` (`DatabaseSync`) for persistent indexed GTFS static storage (`data/seq_gtfs.sqlite`)
    - `node:zlib` (`createInflateRaw`, `brotliCompressSync`, `gzipSync`) for zero-dependency streaming ZIP extraction and HTTP payload pre-compression

## Commands

Run from the repo root:

```bash
npm --workspace @translink/api run dev      # tsx watch --disable-warning=ExperimentalWarning src/index.ts
npm --workspace @translink/api run build    # tsc -> dist/
npm --workspace @translink/api run start    # node --disable-warning=ExperimentalWarning dist/index.js
npm --workspace @translink/api run lint     # tsc --noEmit
```

## Architecture

- [`src/index.ts`](./src/index.ts) — Hono HTTP server, CORS, `ETag` / Brotli / Gzip response negotiation, and REST endpoints under `/v1/`.
- [`src/staticGtfs.ts`](./src/staticGtfs.ts) — Conditional `ETag` / `If-Modified-Since` downloader for `https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip`. Streams `routes.txt`, `stops.txt`, `trips.txt`, `shapes.txt`, `stop_times.txt`, and `feed_info.txt` into `data/seq_gtfs.sqlite` (packed `Float32Array` shape blobs, canonical direction shapes/headsigns, QR 4-letter reverse rail route pairing such as `BNFG` <-> `FGBN`, and polyline tangent bearing projection).
- [`src/zip.ts`](./src/zip.ts) — Zero-dependency ZIP Central Directory parser, `InflateRaw` entry streamer, and RFC-4180 CSV line parser.
- [`src/realtime.ts`](./src/realtime.ts) — Polls `VehiclePositions`, `TripUpdates`, and `Alerts` every 30s with upstream `ETag` support. Enriches every vehicle with static route colors/names, direction IDs, trip headsigns, stop names/codes/platforms, sanitized live arrival delays, and computed bearings + speeds (from consecutive GPS motion and `shapes.txt` polyline tangents). Maintains a 16-snapshot ring buffer for compact delta synchronization.
- [`src/compression.ts`](./src/compression.ts) — Pre-computes Brotli (`br`) and Gzip buffers + weak/strong `ETag` headers once per 30s tick so client polls require zero per-request serialization or compression work.
- [`src/updater.ts`](./src/updater.ts) — Coordinates immediate startup hydration from cached SQLite + protobuf files, 30s realtime polling, and 6-hour static GTFS freshness checks.
- [`src/types.ts`](./src/types.ts) — TypeScript definitions for static GTFS, enriched realtime entities, and the compact tuple / delta sync protocol.

## Endpoints

### `GET /v1/health`

Feed timestamps, age in seconds, active vehicle counts by transit mode (`bus`, `rail`, `ferry`, `tram`), static GTFS validity window, and compressed snapshot byte metrics.

### `GET /v1/seq/vehicles/sync`

Low-bandwidth synchronization endpoint keeping 100% of active vehicles loaded on clients:

- Full snapshot (`mode: "full"`): append-only `routes` and `headsigns` dictionaries + compact 12-element tuples (~20–22 KB Brotli for ~670 vehicles).
- Incremental delta (`?since=<seq>&epoch=<epoch>`, `mode: "delta"`): dictionary slices + `added`, `updated`, `moved`, and `removed` vehicle deltas (~8–9.5 KB Brotli per 30s tick), or `304 Not Modified` (`0 B`) when unchanged.

### `GET /v1/seq/vehicle_positions`

Enriched JSON array of active vehicles. Supports optional filters: `?route=130`, `?mode=bus|rail|ferry|tram`, `?direction=0|1`, and `?bbox=minLon,minLat,maxLon,maxLat`.

### `GET /v1/seq/vehicles/:id`

Full live detail for a single vehicle (by compact `id` or raw GTFS vehicle ID), including its trip GeoJSON `LineString` shape, ordered stop calls with scheduled vs live predicted arrival times, both route directions, and active service alerts.

### `GET /v1/seq/routes` & `GET /v1/seq/routes/:routeKey`

- `GET /v1/seq/routes`: Searchable route directory (`?q=`, `?mode=`, `?activeOnly=1`, `?limit=`).
- `GET /v1/seq/routes/:routeKey`: Detailed route view returning official Translink colors, timetable URL, paired QR rail reverse code (if applicable), active alerts, and **each direction (`directionId` `0` and `1`)** with headsigns, canonical GeoJSON shape, ordered stops, and active vehicles.

### `GET /v1/seq/stops` & `GET /v1/seq/stops/:stopId`

- `GET /v1/seq/stops`: Search stops by text (`?q=Cultural Centre`) or geographic radius (`?lat=-27.47&lon=153.02&radius=600`).
- `GET /v1/seq/stops/:stopId`: Station/stop metadata, child platforms, active stop alerts, and live predicted departures for the next 90 minutes.

### `GET /v1/seq/alerts`

Active GTFS-Realtime service alerts filtered by `?route=`, `?stopId=`, `?tripId=`, or `?mode=`.
