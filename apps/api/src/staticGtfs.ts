import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import type {
    CompactTripStopTuple,
    GeoJsonLineString,
    GtfsFeedInfo,
    GtfsRoute,
    GtfsStop,
    GtfsTrip,
    TransitMode,
} from "./types.js";
import { readZipDirectory, streamZipCsv } from "./zip.js";

const STATIC_GTFS_URL = "https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip";
const STATIC_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const BRISBANE_UTC_OFFSET_SEC = 10 * 3600; // Australia/Brisbane is UTC+10 year-round

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "seq_gtfs.sqlite");

export function routeTypeToMode(routeType: number): TransitMode {
    switch (routeType) {
        case 0:
            return "tram";
        case 2:
            return "rail";
        case 4:
            return "ferry";
        default:
            return "bus";
    }
}

export function defaultColorForMode(mode: TransitMode): {
    color: string;
    textColor: string;
} {
    switch (mode) {
        case "rail":
            return { color: "27855A", textColor: "FFFFFF" };
        case "ferry":
            return { color: "61C5C9", textColor: "1D1D1D" };
        case "tram":
            return { color: "FFC425", textColor: "1D1D1D" };
        case "bus":
        default:
            return { color: "E463A4", textColor: "1D1D1D" };
    }
}

export function parseGtfsTimeToSeconds(raw: string): number {
    if (!raw) return -1;
    const parts = raw.trim().split(":");
    if (parts.length < 2) return -1;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = parts.length > 2 ? Number(parts[2]) : 0;
    if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) return -1;
    return h * 3600 + m * 60 + s;
}

export function formatGtfsSeconds(sec: number): string | null {
    if (sec < 0) return null;
    const norm = sec % 86400;
    const hh = String(Math.floor(norm / 3600)).padStart(2, "0");
    const mm = String(Math.floor((norm % 3600) / 60)).padStart(2, "0");
    return `${hh}:${mm}`;
}

export function serviceDateSecToUnix(
    yyyymmdd: string,
    secondsSinceMidnight: number
): number | null {
    if (!yyyymmdd || yyyymmdd.length !== 8 || secondsSinceMidnight < 0) {
        return null;
    }
    const year = Number(yyyymmdd.slice(0, 4));
    const month = Number(yyyymmdd.slice(4, 6));
    const day = Number(yyyymmdd.slice(6, 8));
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
        return null;
    }
    const utcMidnightMs = Date.UTC(year, month - 1, day, 0, 0, 0);
    const brisbaneMidnightUnix =
        Math.floor(utcMidnightMs / 1000) - BRISBANE_UTC_OFFSET_SEC;
    return brisbaneMidnightUnix + secondsSinceMidnight;
}

export function currentBrisbaneServiceDate(nowUnixSec?: number): string {
    const unix = nowUnixSec ?? Math.floor(Date.now() / 1000);
    const bris = new Date((unix + BRISBANE_UTC_OFFSET_SEC) * 1000);
    const y = bris.getUTCFullYear();
    const m = String(bris.getUTCMonth() + 1).padStart(2, "0");
    const d = String(bris.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`;
}

export function computeForwardBearing(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const toRad = Math.PI / 180;
    const phi1 = lat1 * toRad;
    const phi2 = lat2 * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const y = Math.sin(dLon) * Math.cos(phi2);
    const x =
        Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
    const deg = (Math.atan2(y, x) * 180) / Math.PI;
    return Math.round((deg + 360) % 360);
}

export function distanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6_371_000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * toRad) *
            Math.cos(lat2 * toRad) *
            Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface RouteDirectionRecord {
    routeShortName: string;
    routeType: number;
    directionId: number;
    headsigns: string[];
    primaryShapeId: string | null;
    shapeIds: string[];
    sampleTripId: string | null;
}

class StaticGtfsStore {
    private db: DatabaseSync | null = null;
    private stmtGetTrip: StatementSync | null = null;
    private stmtGetTripStops: StatementSync | null = null;
    private stmtGetShape: StatementSync | null = null;

    private feedInfo: GtfsFeedInfo | null = null;
    private routesById = new Map<string, GtfsRoute>();
    private routesByShortKey = new Map<string, GtfsRoute[]>();
    private stopsById = new Map<string, GtfsStop>();
    private childStopsByParent = new Map<string, GtfsStop[]>();
    private directionsByShortName = new Map<string, RouteDirectionRecord[]>();

    private tripCache = new Map<string, GtfsTrip | null>();
    private shapeCache = new Map<string, Float32Array | null>();
    private syncing = false;
    private listeners: Array<() => void> = [];

    public onUpdated(listener: () => void): void {
        this.listeners.push(listener);
    }

    public isReady(): boolean {
        return this.db !== null && this.routesById.size > 0;
    }

    public getFeedInfo(): GtfsFeedInfo | null {
        return this.feedInfo;
    }

    public getRouteById(routeId: string | null | undefined): GtfsRoute | null {
        if (!routeId) return null;
        const direct = this.routesById.get(routeId);
        if (direct) return direct;
        const short = routeId.split("-")[0];
        return this.getPrimaryRouteByShortName(short);
    }

    public getRoutesByShortName(shortName: string): GtfsRoute[] {
        return this.routesByShortKey.get(shortName.trim().toUpperCase()) ?? [];
    }

    public getPrimaryRouteByShortName(shortName: string): GtfsRoute | null {
        const list = this.getRoutesByShortName(shortName);
        if (list.length === 0) return null;
        return list[list.length - 1];
    }

    public getAllUniqueRoutes(): GtfsRoute[] {
        const result: GtfsRoute[] = [];
        for (const list of this.routesByShortKey.values()) {
            if (list.length > 0) {
                result.push(list[list.length - 1]);
            }
        }
        return result;
    }

    public findPairedRailShortName(shortName: string): string | null {
        const upper = shortName.trim().toUpperCase();
        if (upper.length !== 4 || !/^[A-Z]{4}$/.test(upper)) return null;
        const a = upper.slice(0, 2);
        const b = upper.slice(2, 4);
        if (a === b) return null;
        const reversed = `${b}${a}`;
        const candidate = this.getPrimaryRouteByShortName(reversed);
        if (candidate && candidate.type === 2) {
            return candidate.shortName;
        }
        return null;
    }

    public getStopById(stopId: string | null | undefined): GtfsStop | null {
        if (!stopId) return null;
        return this.stopsById.get(stopId) ?? null;
    }

    public getChildStops(parentStopId: string): GtfsStop[] {
        return this.childStopsByParent.get(parentStopId) ?? [];
    }

    public searchStops(options: {
        q?: string;
        lat?: number;
        lon?: number;
        radiusMeters?: number;
        limit?: number;
    }): GtfsStop[] {
        const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
        const query = options.q?.trim().toLowerCase() ?? "";
        const hasCoords =
            typeof options.lat === "number" &&
            typeof options.lon === "number" &&
            Number.isFinite(options.lat) &&
            Number.isFinite(options.lon);
        const radius = Math.min(
            Math.max(options.radiusMeters ?? 800, 50),
            10_000
        );

        if (hasCoords) {
            const centerLat = options.lat!;
            const centerLon = options.lon!;
            const dLatMax = radius / 111_000;
            const dLonMax =
                radius /
                (111_000 *
                    Math.max(0.2, Math.cos((centerLat * Math.PI) / 180)));

            const scored: Array<{ stop: GtfsStop; dist: number }> = [];
            for (const stop of this.stopsById.values()) {
                if (stop.locationType === 1) continue;
                if (
                    Math.abs(stop.lat - centerLat) > dLatMax ||
                    Math.abs(stop.lon - centerLon) > dLonMax
                ) {
                    continue;
                }
                if (
                    query &&
                    !stop.name.toLowerCase().includes(query) &&
                    !(stop.code && stop.code.toLowerCase().includes(query))
                ) {
                    continue;
                }
                const dist = distanceMeters(
                    centerLat,
                    centerLon,
                    stop.lat,
                    stop.lon
                );
                if (dist <= radius) {
                    scored.push({ stop, dist });
                }
            }
            scored.sort((a, b) => a.dist - b.dist);
            return scored.slice(0, limit).map((s) => s.stop);
        }

        if (!query) {
            return [];
        }

        const exact: GtfsStop[] = [];
        const partial: GtfsStop[] = [];
        for (const stop of this.stopsById.values()) {
            const codeMatch = stop.code?.toLowerCase() === query;
            const idMatch = stop.stopId.toLowerCase() === query;
            if (codeMatch || idMatch) {
                exact.push(stop);
                continue;
            }
            if (
                stop.name.toLowerCase().includes(query) ||
                stop.code?.toLowerCase().includes(query)
            ) {
                partial.push(stop);
                if (exact.length + partial.length >= limit * 3) break;
            }
        }
        return [...exact, ...partial].slice(0, limit);
    }

    public getTrip(tripId: string | null | undefined): GtfsTrip | null {
        if (!tripId || !this.stmtGetTrip) return null;
        if (this.tripCache.has(tripId)) {
            return this.tripCache.get(tripId) ?? null;
        }
        const row = this.stmtGetTrip.get(tripId) as
            | {
                  trip_id: string;
                  route_id: string;
                  service_id: string;
                  headsign: string | null;
                  direction_id: number | null;
                  shape_id: string | null;
              }
            | undefined;

        const parsed: GtfsTrip | null = row
            ? {
                  tripId: row.trip_id,
                  routeId: row.route_id,
                  serviceId: row.service_id,
                  headsign: row.headsign || null,
                  directionId:
                      row.direction_id === null ||
                      row.direction_id === undefined
                          ? null
                          : Number(row.direction_id),
                  shapeId: row.shape_id || null,
              }
            : null;

        if (this.tripCache.size > 6000) {
            this.tripCache.clear();
        }
        this.tripCache.set(tripId, parsed);
        return parsed;
    }

    public getTripStops(
        tripId: string | null | undefined
    ): CompactTripStopTuple[] {
        if (!tripId || !this.stmtGetTripStops) return [];
        const row = this.stmtGetTripStops.get(tripId) as
            { stops_json: string } | undefined;
        if (!row?.stops_json) return [];
        try {
            return JSON.parse(row.stops_json) as CompactTripStopTuple[];
        } catch {
            return [];
        }
    }

    public getShapeFloatCoords(
        shapeId: string | null | undefined
    ): Float32Array | null {
        if (!shapeId || !this.stmtGetShape) return null;
        if (this.shapeCache.has(shapeId)) {
            return this.shapeCache.get(shapeId) ?? null;
        }
        const row = this.stmtGetShape.get(shapeId) as
            { coords: Uint8Array } | undefined;
        if (!row?.coords || row.coords.byteLength < 16) {
            this.shapeCache.set(shapeId, null);
            return null;
        }
        const aligned = new Uint8Array(row.coords.byteLength);
        aligned.set(row.coords);
        const floats = new Float32Array(
            aligned.buffer,
            aligned.byteOffset,
            aligned.byteLength / 4
        );
        if (this.shapeCache.size > 512) {
            this.shapeCache.clear();
        }
        this.shapeCache.set(shapeId, floats);
        return floats;
    }

    public getShapeLineString(
        shapeId: string | null | undefined,
        maxPoints = 600
    ): GeoJsonLineString | null {
        const floats = this.getShapeFloatCoords(shapeId);
        if (!floats || floats.length < 4) return null;

        const pointCount = floats.length / 2;
        const coordinates: [number, number][] = [];

        if (pointCount <= maxPoints) {
            for (let i = 0; i < floats.length; i += 2) {
                coordinates.push([
                    Math.round(floats[i] * 1e5) / 1e5,
                    Math.round(floats[i + 1] * 1e5) / 1e5,
                ]);
            }
        } else {
            const step = (pointCount - 1) / (maxPoints - 1);
            for (let k = 0; k < maxPoints - 1; k++) {
                const idx = Math.floor(k * step) * 2;
                coordinates.push([
                    Math.round(floats[idx] * 1e5) / 1e5,
                    Math.round(floats[idx + 1] * 1e5) / 1e5,
                ]);
            }
            const last = (pointCount - 1) * 2;
            coordinates.push([
                Math.round(floats[last] * 1e5) / 1e5,
                Math.round(floats[last + 1] * 1e5) / 1e5,
            ]);
        }

        return {
            type: "LineString",
            coordinates,
        };
    }

    public computeShapeBearingAt(
        shapeId: string | null | undefined,
        lat: number,
        lon: number
    ): number | null {
        const floats = this.getShapeFloatCoords(shapeId);
        if (!floats || floats.length < 4) return null;

        const cosLat = Math.cos((lat * Math.PI) / 180);
        let bestDistSq = Infinity;
        let bestSegIdx = -1;

        for (let i = 0; i <= floats.length - 4; i += 2) {
            const lon1 = floats[i];
            const lat1 = floats[i + 1];
            const lon2 = floats[i + 2];
            const lat2 = floats[i + 3];

            const dx = (lon2 - lon1) * cosLat;
            const dy = lat2 - lat1;
            const segLenSq = dx * dx + dy * dy;
            if (segLenSq < 1e-12) continue;

            const px = (lon - lon1) * cosLat;
            const py = lat - lat1;
            const t = Math.max(0, Math.min(1, (px * dx + py * dy) / segLenSq));
            const projX = t * dx;
            const projY = t * dy;
            const distSq = (px - projX) ** 2 + (py - projY) ** 2;

            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestSegIdx = i;
            }
        }

        if (bestSegIdx === -1 || bestDistSq > 0.0045 * 0.0045) {
            return null;
        }

        const lon1 = floats[bestSegIdx];
        const lat1 = floats[bestSegIdx + 1];
        const lon2 = floats[bestSegIdx + 2];
        const lat2 = floats[bestSegIdx + 3];
        return computeForwardBearing(lat1, lon1, lat2, lon2);
    }

    public getRouteDirectionRecords(shortName: string): RouteDirectionRecord[] {
        return (
            this.directionsByShortName.get(shortName.trim().toUpperCase()) ?? []
        );
    }

    public async initialize(): Promise<void> {
        await mkdir(DATA_DIR, { recursive: true });
        if (existsSync(DB_PATH)) {
            try {
                this.openDatabase(DB_PATH);
                console.log(
                    `✓ Loaded cached SEQ static GTFS (${this.routesById.size} routes, ${this.stopsById.size} stops)`
                );
            } catch (err) {
                console.warn(
                    "Cached static GTFS DB unreadable, rebuilding:",
                    err
                );
                this.closeDatabase();
            }
        }

        void this.refreshLoop();
    }

    private async refreshLoop(): Promise<void> {
        await this.syncIfUpdated();
        setInterval(() => {
            void this.syncIfUpdated();
        }, STATIC_CHECK_INTERVAL_MS).unref();
    }

    public async syncIfUpdated(): Promise<boolean> {
        if (this.syncing) return false;
        this.syncing = true;
        const zipTmp = join(DATA_DIR, "SEQ_GTFS.download.zip");
        const dbTmp = join(DATA_DIR, "seq_gtfs.sqlite.tmp");

        try {
            const headers: Record<string, string> = {};
            if (this.isReady() && this.feedInfo?.etag) {
                headers["If-None-Match"] = this.feedInfo.etag;
            } else if (this.isReady() && this.feedInfo?.lastModified) {
                headers["If-Modified-Since"] = this.feedInfo.lastModified;
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60_000);
            const res = await fetch(STATIC_GTFS_URL, {
                headers,
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (res.status === 304) {
                console.log("✓ Static GTFS schedule is up to date (304)");
                return false;
            }
            if (!res.ok || !res.body) {
                console.error(
                    `✗ Failed to fetch static GTFS: HTTP ${res.status}`
                );
                return false;
            }

            const remoteEtag = res.headers.get("etag");
            const remoteLastModified = res.headers.get("last-modified");
            if (
                this.isReady() &&
                remoteEtag &&
                this.feedInfo?.etag === remoteEtag
            ) {
                await res.body.cancel();
                return false;
            }

            console.log("↓ Downloading Translink SEQ_GTFS.zip...");
            const startMs = Date.now();
            await rm(zipTmp, { force: true });
            await pipeline(
                Readable.fromWeb(
                    res.body as import("node:stream/web").ReadableStream
                ),
                createWriteStream(zipTmp)
            );
            console.log(
                `✓ Downloaded SEQ_GTFS.zip in ${((Date.now() - startMs) / 1000).toFixed(1)}s. Indexing SQLite...`
            );

            const idxStart = Date.now();
            await rm(dbTmp, { force: true });
            await this.buildSqliteFromZip(
                zipTmp,
                dbTmp,
                remoteEtag,
                remoteLastModified
            );

            this.closeDatabase();
            await rename(dbTmp, DB_PATH);
            await rm(zipTmp, { force: true });

            this.openDatabase(DB_PATH);
            console.log(
                `✓ Indexed SEQ static GTFS in ${((Date.now() - idxStart) / 1000).toFixed(1)}s (${this.feedInfo?.counts.routes} routes, ${this.feedInfo?.counts.stops} stops, ${this.feedInfo?.counts.trips} trips, ${this.feedInfo?.counts.shapes} shapes)`
            );
            for (const listener of this.listeners) {
                try {
                    listener();
                } catch (e) {
                    console.error("Static GTFS listener error:", e);
                }
            }
            return true;
        } catch (err) {
            console.error("✗ Error syncing static GTFS:", err);
            await rm(zipTmp, { force: true }).catch(() => {});
            await rm(dbTmp, { force: true }).catch(() => {});
            return false;
        } finally {
            this.syncing = false;
        }
    }

    private closeDatabase(): void {
        this.stmtGetTrip = null;
        this.stmtGetTripStops = null;
        this.stmtGetShape = null;
        this.tripCache.clear();
        this.shapeCache.clear();
        if (this.db) {
            try {
                this.db.close();
            } catch {
                // ignore
            }
            this.db = null;
        }
    }

    private openDatabase(path: string): void {
        const db = new DatabaseSync(path, { readOnly: true });

        const metaRows = db
            .prepare("SELECT key, value FROM meta")
            .all() as Array<{
            key: string;
            value: string;
        }>;
        const meta = new Map(metaRows.map((r) => [r.key, r.value]));

        const routeRows = db
            .prepare(
                "SELECT route_id, short_name, long_name, desc, route_type, color, text_color, url FROM routes"
            )
            .all() as Array<{
            route_id: string;
            short_name: string;
            long_name: string;
            desc: string | null;
            route_type: number;
            color: string;
            text_color: string;
            url: string | null;
        }>;

        const routesById = new Map<string, GtfsRoute>();
        const routesByShortKey = new Map<string, GtfsRoute[]>();
        for (const r of routeRows) {
            const mode = routeTypeToMode(r.route_type);
            const fallback = defaultColorForMode(mode);
            const route: GtfsRoute = {
                routeId: r.route_id,
                shortName: r.short_name,
                longName: r.long_name,
                desc: r.desc || null,
                type: r.route_type,
                mode,
                color: (r.color || fallback.color)
                    .replace(/^#/, "")
                    .toUpperCase(),
                textColor: (r.text_color || fallback.textColor)
                    .replace(/^#/, "")
                    .toUpperCase(),
                url: r.url || null,
            };
            routesById.set(route.routeId, route);
            const key = route.shortName.toUpperCase();
            let group = routesByShortKey.get(key);
            if (!group) {
                group = [];
                routesByShortKey.set(key, group);
            }
            group.push(route);
        }

        const stopRows = db
            .prepare(
                "SELECT stop_id, code, name, lat, lon, zone_id, platform_code, parent_station, location_type, url FROM stops"
            )
            .all() as Array<{
            stop_id: string;
            code: string | null;
            name: string;
            lat: number;
            lon: number;
            zone_id: string | null;
            platform_code: string | null;
            parent_station: string | null;
            location_type: number;
            url: string | null;
        }>;

        const stopsById = new Map<string, GtfsStop>();
        const childStopsByParent = new Map<string, GtfsStop[]>();
        for (const s of stopRows) {
            const stop: GtfsStop = {
                stopId: s.stop_id,
                code: s.code || null,
                name: s.name,
                lat: s.lat,
                lon: s.lon,
                zoneId: s.zone_id || null,
                platformCode: s.platform_code || null,
                parentStation: s.parent_station || null,
                locationType: s.location_type ?? 0,
                url: s.url || null,
            };
            stopsById.set(stop.stopId, stop);
            if (stop.parentStation) {
                let list = childStopsByParent.get(stop.parentStation);
                if (!list) {
                    list = [];
                    childStopsByParent.set(stop.parentStation, list);
                }
                list.push(stop);
            }
        }

        const dirRows = db
            .prepare(
                "SELECT route_short_name, route_type, direction_id, headsigns_json, primary_shape_id, shape_ids_json, sample_trip_id FROM route_directions"
            )
            .all() as Array<{
            route_short_name: string;
            route_type: number;
            direction_id: number;
            headsigns_json: string;
            primary_shape_id: string | null;
            shape_ids_json: string;
            sample_trip_id: string | null;
        }>;

        const directionsByShortName = new Map<string, RouteDirectionRecord[]>();
        for (const d of dirRows) {
            const key = d.route_short_name.toUpperCase();
            let list = directionsByShortName.get(key);
            if (!list) {
                list = [];
                directionsByShortName.set(key, list);
            }
            list.push({
                routeShortName: d.route_short_name,
                routeType: d.route_type,
                directionId: d.direction_id,
                headsigns: JSON.parse(d.headsigns_json) as string[],
                primaryShapeId: d.primary_shape_id,
                shapeIds: JSON.parse(d.shape_ids_json) as string[],
                sampleTripId: d.sample_trip_id,
            });
        }

        this.db = db;
        this.stmtGetTrip = db.prepare(
            "SELECT trip_id, route_id, service_id, headsign, direction_id, shape_id FROM trips WHERE trip_id = ?"
        );
        this.stmtGetTripStops = db.prepare(
            "SELECT stops_json FROM trip_stops WHERE trip_id = ?"
        );
        this.stmtGetShape = db.prepare(
            "SELECT coords FROM shapes WHERE shape_id = ?"
        );

        this.routesById = routesById;
        this.routesByShortKey = routesByShortKey;
        this.stopsById = stopsById;
        this.childStopsByParent = childStopsByParent;
        this.directionsByShortName = directionsByShortName;
        this.tripCache.clear();
        this.shapeCache.clear();

        this.feedInfo = {
            publisherName: meta.get("publisherName") ?? "Translink",
            publisherUrl:
                meta.get("publisherUrl") ?? "https://translink.com.au/",
            lang: meta.get("lang") ?? "en",
            startDate: meta.get("startDate") ?? "",
            endDate: meta.get("endDate") ?? "",
            etag: meta.get("etag") || null,
            lastModified: meta.get("lastModified") || null,
            indexedAt: meta.get("indexedAt") ?? new Date().toISOString(),
            counts: {
                routes: Number(meta.get("routesCount") ?? routesById.size),
                stops: Number(meta.get("stopsCount") ?? stopsById.size),
                trips: Number(meta.get("tripsCount") ?? 0),
                shapes: Number(meta.get("shapesCount") ?? 0),
            },
        };
    }

    private async buildSqliteFromZip(
        zipPath: string,
        dbOutPath: string,
        etag: string | null,
        lastModified: string | null
    ): Promise<void> {
        const entries = await readZipDirectory(zipPath);
        const db = new DatabaseSync(dbOutPath);

        try {
            db.exec(`
                PRAGMA journal_mode = OFF;
                PRAGMA synchronous = OFF;
                PRAGMA temp_store = MEMORY;
                PRAGMA cache_size = -64000;

                CREATE TABLE meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE routes (
                    route_id TEXT PRIMARY KEY,
                    short_name TEXT NOT NULL,
                    long_name TEXT NOT NULL,
                    desc TEXT,
                    route_type INTEGER NOT NULL,
                    color TEXT,
                    text_color TEXT,
                    url TEXT
                );

                CREATE TABLE stops (
                    stop_id TEXT PRIMARY KEY,
                    code TEXT,
                    name TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    zone_id TEXT,
                    platform_code TEXT,
                    parent_station TEXT,
                    location_type INTEGER NOT NULL,
                    url TEXT
                );

                CREATE TABLE trips (
                    trip_id TEXT PRIMARY KEY,
                    route_id TEXT NOT NULL,
                    service_id TEXT NOT NULL,
                    headsign TEXT,
                    direction_id INTEGER,
                    shape_id TEXT
                );

                CREATE TABLE shapes (
                    shape_id TEXT PRIMARY KEY,
                    coords BLOB NOT NULL
                );

                CREATE TABLE trip_stops (
                    trip_id TEXT PRIMARY KEY,
                    stops_json TEXT NOT NULL
                );

                CREATE TABLE route_directions (
                    route_short_name TEXT NOT NULL,
                    route_type INTEGER NOT NULL,
                    direction_id INTEGER NOT NULL,
                    headsigns_json TEXT NOT NULL,
                    primary_shape_id TEXT,
                    shape_ids_json TEXT NOT NULL,
                    sample_trip_id TEXT,
                    PRIMARY KEY (route_short_name, route_type, direction_id)
                );
            `);

            // 1. feed_info.txt
            const feedMeta: Record<string, string> = {
                publisherName: "Translink",
                publisherUrl: "https://translink.com.au/",
                lang: "en",
                startDate: "",
                endDate: "",
            };
            await streamZipCsv(zipPath, entries, "feed_info.txt", (cols, h) => {
                feedMeta.publisherName =
                    cols[h.get("feed_publisher_name") ?? -1] ?? "Translink";
                feedMeta.publisherUrl =
                    cols[h.get("feed_publisher_url") ?? -1] ??
                    "https://translink.com.au/";
                feedMeta.lang = cols[h.get("feed_lang") ?? -1] ?? "en";
                feedMeta.startDate =
                    cols[h.get("feed_start_date") ?? -1]?.trim() ?? "";
                feedMeta.endDate =
                    cols[h.get("feed_end_date") ?? -1]?.trim() ?? "";
            });

            // 2. routes.txt
            let routesCount = 0;
            const routeMetaById = new Map<
                string,
                { shortName: string; type: number }
            >();
            const insertRoute = db.prepare(
                "INSERT OR REPLACE INTO routes (route_id, short_name, long_name, desc, route_type, color, text_color, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            );
            db.exec("BEGIN");
            await streamZipCsv(zipPath, entries, "routes.txt", (cols, h) => {
                const routeId = cols[h.get("route_id") ?? -1]?.trim();
                if (!routeId) return;
                const shortName =
                    cols[h.get("route_short_name") ?? -1]?.trim() ||
                    routeId.split("-")[0];
                const longName =
                    cols[h.get("route_long_name") ?? -1]?.trim() || shortName;
                const desc = cols[h.get("route_desc") ?? -1]?.trim() || null;
                const routeType = Number(
                    cols[h.get("route_type") ?? -1]?.trim() ?? 3
                );
                const color = cols[h.get("route_color") ?? -1]?.trim() || null;
                const textColor =
                    cols[h.get("route_text_color") ?? -1]?.trim() || null;
                const url = cols[h.get("route_url") ?? -1]?.trim() || null;

                insertRoute.run(
                    routeId,
                    shortName,
                    longName,
                    desc,
                    routeType,
                    color,
                    textColor,
                    url
                );
                routeMetaById.set(routeId, { shortName, type: routeType });
                routesCount++;
            });
            db.exec("COMMIT");

            // 3. stops.txt
            let stopsCount = 0;
            const insertStop = db.prepare(
                "INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, zone_id, platform_code, parent_station, location_type, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            db.exec("BEGIN");
            await streamZipCsv(zipPath, entries, "stops.txt", (cols, h) => {
                const stopId = cols[h.get("stop_id") ?? -1]?.trim();
                if (!stopId) return;
                const lat = Number(cols[h.get("stop_lat") ?? -1]?.trim());
                const lon = Number(cols[h.get("stop_lon") ?? -1]?.trim());
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
                const code = cols[h.get("stop_code") ?? -1]?.trim() || null;
                const name = cols[h.get("stop_name") ?? -1]?.trim() || stopId;
                const zoneId = cols[h.get("zone_id") ?? -1]?.trim() || null;
                const platformCode =
                    cols[h.get("platform_code") ?? -1]?.trim() || null;
                const parentStation =
                    cols[h.get("parent_station") ?? -1]?.trim() || null;
                const locationType = Number(
                    cols[h.get("location_type") ?? -1]?.trim() || 0
                );
                const url = cols[h.get("stop_url") ?? -1]?.trim() || null;

                insertStop.run(
                    stopId,
                    code,
                    name,
                    lat,
                    lon,
                    zoneId,
                    platformCode,
                    parentStation,
                    locationType,
                    url
                );
                stopsCount++;
            });
            db.exec("COMMIT");

            // 4. trips.txt
            let tripsCount = 0;
            const dirAgg = new Map<
                string,
                {
                    shortName: string;
                    routeType: number;
                    directionId: number;
                    headsignCounts: Map<string, number>;
                    shapeCounts: Map<string, number>;
                    tripByShape: Map<string, string>;
                }
            >();

            const insertTrip = db.prepare(
                "INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction_id, shape_id) VALUES (?, ?, ?, ?, ?, ?)"
            );
            db.exec("BEGIN");
            await streamZipCsv(zipPath, entries, "trips.txt", (cols, h) => {
                const tripId = cols[h.get("trip_id") ?? -1]?.trim();
                const routeId = cols[h.get("route_id") ?? -1]?.trim();
                if (!tripId || !routeId) return;
                const serviceId = cols[h.get("service_id") ?? -1]?.trim() || "";
                const headsign =
                    cols[h.get("trip_headsign") ?? -1]?.trim() || null;
                const dirRaw = cols[h.get("direction_id") ?? -1]?.trim();
                const directionId =
                    dirRaw === "" || dirRaw === undefined ? 0 : Number(dirRaw);
                const shapeId = cols[h.get("shape_id") ?? -1]?.trim() || null;

                insertTrip.run(
                    tripId,
                    routeId,
                    serviceId,
                    headsign,
                    directionId,
                    shapeId
                );
                tripsCount++;

                const rMeta = routeMetaById.get(routeId) ?? {
                    shortName: routeId.split("-")[0],
                    type: 3,
                };
                const aggKey = `${rMeta.shortName.toUpperCase()}|${rMeta.type}|${directionId}`;
                let bucket = dirAgg.get(aggKey);
                if (!bucket) {
                    bucket = {
                        shortName: rMeta.shortName,
                        routeType: rMeta.type,
                        directionId,
                        headsignCounts: new Map(),
                        shapeCounts: new Map(),
                        tripByShape: new Map(),
                    };
                    dirAgg.set(aggKey, bucket);
                }
                if (headsign) {
                    bucket.headsignCounts.set(
                        headsign,
                        (bucket.headsignCounts.get(headsign) ?? 0) + 1
                    );
                }
                if (shapeId) {
                    bucket.shapeCounts.set(
                        shapeId,
                        (bucket.shapeCounts.get(shapeId) ?? 0) + 1
                    );
                    bucket.tripByShape.set(shapeId, tripId);
                }
            });
            db.exec("COMMIT");

            const insertDir = db.prepare(
                "INSERT OR REPLACE INTO route_directions (route_short_name, route_type, direction_id, headsigns_json, primary_shape_id, shape_ids_json, sample_trip_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
            );
            db.exec("BEGIN");
            for (const b of dirAgg.values()) {
                const topHeadsigns = [...b.headsignCounts.entries()]
                    .sort((a, c) => c[1] - a[1])
                    .slice(0, 4)
                    .map(([hs]) => hs);
                const topShapes = [...b.shapeCounts.entries()]
                    .sort((a, c) => c[1] - a[1])
                    .slice(0, 4)
                    .map(([sid]) => sid);
                const primaryShape = topShapes[0] ?? null;
                const sampleTripId = primaryShape
                    ? (b.tripByShape.get(primaryShape) ?? null)
                    : null;

                insertDir.run(
                    b.shortName,
                    b.routeType,
                    b.directionId,
                    JSON.stringify(topHeadsigns),
                    primaryShape,
                    JSON.stringify(topShapes),
                    sampleTripId
                );
            }
            db.exec("COMMIT");

            // 5. shapes.txt
            let shapesCount = 0;
            const insertShape = db.prepare(
                "INSERT OR REPLACE INTO shapes (shape_id, coords) VALUES (?, ?)"
            );
            let curShapeId = "";
            let curPts: Array<{ seq: number; lon: number; lat: number }> = [];

            const flushShape = () => {
                if (!curShapeId || curPts.length === 0) return;
                curPts.sort((a, b) => a.seq - b.seq);
                const floats = new Float32Array(curPts.length * 2);
                for (let i = 0; i < curPts.length; i++) {
                    floats[i * 2] = curPts[i].lon;
                    floats[i * 2 + 1] = curPts[i].lat;
                }
                insertShape.run(
                    curShapeId,
                    new Uint8Array(
                        floats.buffer,
                        floats.byteOffset,
                        floats.byteLength
                    )
                );
                shapesCount++;
            };

            db.exec("BEGIN");
            await streamZipCsv(zipPath, entries, "shapes.txt", (cols, h) => {
                const sid = cols[h.get("shape_id") ?? 0];
                if (!sid) return;
                const lat = Number(cols[h.get("shape_pt_lat") ?? 1]);
                const lon = Number(cols[h.get("shape_pt_lon") ?? 2]);
                const seq = Number(cols[h.get("shape_pt_sequence") ?? 3]);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

                if (sid !== curShapeId) {
                    flushShape();
                    curShapeId = sid;
                    curPts = [];
                }
                curPts.push({ seq, lon, lat });
            });
            flushShape();
            db.exec("COMMIT");

            // 6. stop_times.txt
            const insertTripStops = db.prepare(
                "INSERT OR REPLACE INTO trip_stops (trip_id, stops_json) VALUES (?, ?)"
            );
            const selectExistingStops = db.prepare(
                "SELECT stops_json FROM trip_stops WHERE trip_id = ?"
            );
            const seenTripIds = new Set<string>();
            let curTripId = "";
            let curStops: CompactTripStopTuple[] = [];
            let batchCount = 0;

            const flushTripStops = () => {
                if (!curTripId || curStops.length === 0) return;
                if (seenTripIds.has(curTripId)) {
                    const existing = selectExistingStops.get(curTripId) as
                        { stops_json: string } | undefined;
                    if (existing?.stops_json) {
                        const prev = JSON.parse(
                            existing.stops_json
                        ) as CompactTripStopTuple[];
                        curStops = [...prev, ...curStops];
                    }
                } else {
                    seenTripIds.add(curTripId);
                }
                curStops.sort((a, b) => a[1] - b[1]);
                insertTripStops.run(curTripId, JSON.stringify(curStops));
                batchCount++;
                if (batchCount >= 25_000) {
                    db.exec("COMMIT; BEGIN");
                    batchCount = 0;
                }
            };

            db.exec("BEGIN");
            await streamZipCsv(
                zipPath,
                entries,
                "stop_times.txt",
                (cols, h) => {
                    const tid = cols[h.get("trip_id") ?? 0];
                    if (!tid) return;
                    const arrSec = parseGtfsTimeToSeconds(
                        cols[h.get("arrival_time") ?? 1] ?? ""
                    );
                    const depSec = parseGtfsTimeToSeconds(
                        cols[h.get("departure_time") ?? 2] ?? ""
                    );
                    const stopId = cols[h.get("stop_id") ?? 3]?.trim() ?? "";
                    const seq = Number(cols[h.get("stop_sequence") ?? 4] ?? 0);
                    if (!stopId) return;

                    if (tid !== curTripId) {
                        flushTripStops();
                        curTripId = tid;
                        curStops = [];
                    }
                    curStops.push([stopId, seq, arrSec, depSec]);
                }
            );
            flushTripStops();
            db.exec("COMMIT");

            // 7. Write metadata
            const insertMeta = db.prepare(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"
            );
            const metaEntries: Record<string, string> = {
                ...feedMeta,
                etag: etag ?? "",
                lastModified: lastModified ?? "",
                indexedAt: new Date().toISOString(),
                routesCount: String(routesCount),
                stopsCount: String(stopsCount),
                tripsCount: String(tripsCount),
                shapesCount: String(shapesCount),
            };
            db.exec("BEGIN");
            for (const [k, v] of Object.entries(metaEntries)) {
                insertMeta.run(k, v);
            }
            db.exec("COMMIT");
        } finally {
            db.close();
        }
    }
}

export const staticGtfs = new StaticGtfsStore();
