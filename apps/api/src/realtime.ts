import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { transit_realtime } from "gtfs-realtime-bindings";

import {
    buildPrecompressedJson,
    type PrecompressedPayload,
} from "./compression.js";
import {
    computeForwardBearing,
    currentBrisbaneServiceDate,
    defaultColorForMode,
    distanceMeters,
    formatGtfsSeconds,
    serviceDateSecToUnix,
    staticGtfs,
} from "./staticGtfs.js";
import type {
    GeoJsonLineString,
    GeoJsonMultiLineString,
    RouteDetail,
    RouteDirectionInfo,
    ServiceAlert,
    StopDeparture,
    SyncDeltaResponse,
    SyncFullResponse,
    SyncMovedTuple,
    SyncRouteDictTuple,
    SyncVehicleTuple,
    TransitMode,
    VehicleDetail,
    VehiclePosition,
    VehicleStopCall,
    VehicleStopStatus,
} from "./types.js";

const require = createRequire(import.meta.url);
const gtfs =
    require("gtfs-realtime-bindings") as typeof import("gtfs-realtime-bindings");
const { FeedMessage } = gtfs.transit_realtime;

const DATA_DIR = join(process.cwd(), "data");
export const VP_FILE = join(DATA_DIR, "SEQ_VehiclePositions.pb");
export const TU_FILE = join(DATA_DIR, "SEQ_TripUpdates.pb");
export const ALERTS_FILE = join(DATA_DIR, "SEQ_Alerts.pb");

const VP_URL =
    "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions";
const TU_URL =
    "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates";
const ALERTS_URL =
    "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/Alerts";

const MAX_SYNC_HISTORY = 16;

const CAUSE_NAMES: Record<number, string> = {
    1: "UNKNOWN_CAUSE",
    2: "OTHER_CAUSE",
    3: "TECHNICAL_PROBLEM",
    4: "STRIKE",
    5: "DEMONSTRATION",
    6: "ACCIDENT",
    7: "HOLIDAY",
    8: "WEATHER",
    9: "MAINTENANCE",
    10: "CONSTRUCTION",
    11: "POLICE_ACTIVITY",
    12: "MEDICAL_EMERGENCY",
};

const EFFECT_NAMES: Record<number, string> = {
    1: "NO_SERVICE",
    2: "REDUCED_SERVICE",
    3: "SIGNIFICANT_DELAYS",
    4: "DETOUR",
    5: "ADDITIONAL_SERVICE",
    6: "MODIFIED_SERVICE",
    7: "OTHER_EFFECT",
    8: "UNKNOWN_EFFECT",
    9: "STOP_MOVED",
    10: "NO_EFFECT",
    11: "ACCESSIBILITY_ISSUE",
};

function toNumber(
    val: number | { toNumber?: () => number } | null | undefined
): number | null {
    if (val === null || val === undefined) return null;
    if (typeof val === "number") return Number.isFinite(val) ? val : null;
    if (typeof val === "object" && typeof val.toNumber === "function") {
        return val.toNumber();
    }
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
}

function hasOwnField<T extends object>(
    obj: T | null | undefined,
    key: keyof T
): boolean {
    return Boolean(obj && Object.prototype.hasOwnProperty.call(obj, key));
}

function sanitizeDelay(
    delaySec: number | null,
    stopSequence?: number | null
): number | null {
    if (delaySec === null || !Number.isFinite(delaySec)) return null;
    if (Math.abs(delaySec) > 7200) return null;
    if ((stopSequence === 1 || stopSequence === null) && delaySec < -120) {
        return null;
    }
    if (delaySec < -600) return null;
    return delaySec;
}

function fnv1aHex(str: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function modeToCode(mode: TransitMode): number {
    switch (mode) {
        case "tram":
            return 0;
        case "rail":
            return 1;
        case "bus":
            return 2;
        case "ferry":
            return 3;
    }
}

function statusToEnum(code: number): VehicleStopStatus {
    switch (code) {
        case 0:
            return "INCOMING_AT";
        case 1:
            return "STOPPED_AT";
        case 2:
        default:
            return "IN_TRANSIT_TO";
    }
}

function inferModeFromRouteShort(shortName: string): TransitMode {
    const s = shortName.toUpperCase();
    if (s === "L1" || s === "GLKN") return "tram";
    if (/^F\d+$/i.test(s) || s === "SMBI") return "ferry";
    if (/^[A-Z]{4}$/.test(s)) return "rail";
    return "bus";
}

interface ParsedStopTimeUpdate {
    stopSequence: number | null;
    stopId: string | null;
    arrivalUnix: number | null;
    arrivalDelay: number | null;
    departureUnix: number | null;
    departureDelay: number | null;
    skipped: boolean;
}

interface ParsedTripUpdate {
    tripId: string;
    routeId: string | null;
    startDate: string | null;
    startTime: string | null;
    delaySec: number | null;
    stops: ParsedStopTimeUpdate[];
}

interface VehicleMotionState {
    lat: number;
    lon: number;
    timestamp: number;
    bearing: number | null;
    speedKmh: number | null;
}

interface SyncSnapshotEntry {
    seq: number;
    serverTime: number;
    routesLen: number;
    headsignsLen: number;
    byId: Map<string, SyncVehicleTuple>;
    fullCompressed: PrecompressedPayload;
    deltaCache: Map<string, PrecompressedPayload>;
}

class RealtimeTransitEngine {
    private feedEtags = new Map<string, string>();
    private vpTimestamp = 0;
    private tuTimestamp = 0;
    private alertsTimestamp = 0;
    private lastFetchUnix = 0;

    private vehicles: VehiclePosition[] = [];
    private vehiclesById = new Map<string, VehiclePosition>();
    private vehiclesByRawId = new Map<string, VehiclePosition>();
    private shortIdCollisionGuard = new Map<string, string>();

    private tripUpdates = new Map<string, ParsedTripUpdate>();
    private departuresByStop = new Map<string, StopDeparture[]>();
    private alerts: ServiceAlert[] = [];
    private motionByVehicle = new Map<string, VehicleMotionState>();

    // Append-only dictionaries for compact delta sync
    private syncEpoch = Date.now().toString(36);
    private routeDict: SyncRouteDictTuple[] = [];
    private routeDictIndex = new Map<string, number>();
    private headsignDict: string[] = [""];
    private headsignDictIndex = new Map<string, number>([["", 0]]);
    private syncHistory: SyncSnapshotEntry[] = [];
    private vehiclesListCompressed: PrecompressedPayload | null = null;

    constructor() {
        staticGtfs.onUpdated(() => {
            // Reset dictionary epoch so enriched route colors/names/headsigns propagate cleanly
            this.resetSyncEpoch();
            void this.rebuildFromDisk();
        });
    }

    private resetSyncEpoch(): void {
        this.syncEpoch = Date.now().toString(36);
        this.routeDict = [];
        this.routeDictIndex.clear();
        this.headsignDict = [""];
        this.headsignDictIndex = new Map([["", 0]]);
        this.syncHistory = [];
    }

    private makeShortVehicleId(rawId: string): string {
        const base = fnv1aHex(rawId);
        const existingRaw = this.shortIdCollisionGuard.get(base);
        if (!existingRaw || existingRaw === rawId) {
            this.shortIdCollisionGuard.set(base, rawId);
            return base;
        }
        const suffix = rawId.slice(-4).replace(/[^a-zA-Z0-9]/g, "");
        const alt = `${base}${suffix}`;
        this.shortIdCollisionGuard.set(alt, rawId);
        return alt;
    }

    private internRoute(
        shortName: string,
        longName: string,
        mode: TransitMode,
        color: string,
        textColor: string
    ): number {
        const key = `${shortName}|${longName}|${mode}|${color}|${textColor}`;
        const existing = this.routeDictIndex.get(key);
        if (existing !== undefined) return existing;
        const idx = this.routeDict.length;
        this.routeDict.push([
            shortName,
            longName,
            modeToCode(mode),
            color,
            textColor,
        ]);
        this.routeDictIndex.set(key, idx);
        return idx;
    }

    private internHeadsign(headsign: string | null): number {
        const str = headsign ?? "";
        const existing = this.headsignDictIndex.get(str);
        if (existing !== undefined) return existing;
        const idx = this.headsignDict.length;
        this.headsignDict.push(str);
        this.headsignDictIndex.set(str, idx);
        return idx;
    }

    private async fetchFeedToFile(
        url: string,
        outPath: string
    ): Promise<boolean> {
        try {
            const headers: Record<string, string> = {};
            const prevEtag = this.feedEtags.get(url);
            if (prevEtag && existsSync(outPath)) {
                headers["If-None-Match"] = prevEtag;
            }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);
            const res = await fetch(url, {
                headers,
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (res.status === 304) {
                return false;
            }
            if (!res.ok) {
                console.error(`✗ Feed ${url} returned HTTP ${res.status}`);
                return false;
            }
            const etag = res.headers.get("etag");
            if (etag) this.feedEtags.set(url, etag);

            const buf = new Uint8Array(await res.arrayBuffer());
            await mkdir(DATA_DIR, { recursive: true });
            await writeFile(outPath, buf);
            return true;
        } catch (err) {
            console.error(`✗ Error fetching ${url}:`, err);
            return false;
        }
    }

    public async pollAllFeeds(): Promise<boolean> {
        await mkdir(DATA_DIR, { recursive: true });
        const [vpUpdated, tuUpdated, alertsUpdated] = await Promise.all([
            this.fetchFeedToFile(VP_URL, VP_FILE),
            this.fetchFeedToFile(TU_URL, TU_FILE),
            this.fetchFeedToFile(ALERTS_URL, ALERTS_FILE),
        ]);

        this.lastFetchUnix = Math.floor(Date.now() / 1000);

        if (
            vpUpdated ||
            tuUpdated ||
            alertsUpdated ||
            this.vehicles.length === 0
        ) {
            await this.rebuildFromDisk();
            return true;
        }
        return false;
    }

    private async decodePbSafe(
        path: string
    ): Promise<transit_realtime.FeedMessage | null> {
        if (!existsSync(path)) return null;
        try {
            const bytes = await readFile(path);
            return FeedMessage.decode(new Uint8Array(bytes));
        } catch (err) {
            console.error(`✗ Failed decoding ${path}:`, err);
            return null;
        }
    }

    public async rebuildFromDisk(): Promise<void> {
        const [vpFeed, tuFeed, alertsFeed] = await Promise.all([
            this.decodePbSafe(VP_FILE),
            this.decodePbSafe(TU_FILE),
            this.decodePbSafe(ALERTS_FILE),
        ]);

        const nowUnix = Math.floor(Date.now() / 1000);

        // 1. Parse TripUpdates
        const tripUpdates = new Map<string, ParsedTripUpdate>();
        if (tuFeed) {
            this.tuTimestamp = toNumber(tuFeed.header?.timestamp) ?? nowUnix;
            for (const entity of tuFeed.entity ?? []) {
                const tu = entity.tripUpdate;
                if (!tu?.trip?.tripId) continue;

                const tripId = tu.trip.tripId;
                const stops: ParsedStopTimeUpdate[] = [];
                for (const stu of tu.stopTimeUpdate ?? []) {
                    const skipped = stu.scheduleRelationship === 1;
                    stops.push({
                        stopSequence: hasOwnField(stu, "stopSequence")
                            ? (stu.stopSequence ?? null)
                            : null,
                        stopId: hasOwnField(stu, "stopId")
                            ? (stu.stopId ?? null)
                            : null,
                        arrivalUnix: hasOwnField(stu.arrival, "time")
                            ? toNumber(stu.arrival?.time)
                            : null,
                        arrivalDelay: hasOwnField(stu.arrival, "delay")
                            ? (stu.arrival?.delay ?? null)
                            : null,
                        departureUnix: hasOwnField(stu.departure, "time")
                            ? toNumber(stu.departure?.time)
                            : null,
                        departureDelay: hasOwnField(stu.departure, "delay")
                            ? (stu.departure?.delay ?? null)
                            : null,
                        skipped,
                    });
                }

                let delaySec: number | null = hasOwnField(tu, "delay")
                    ? (tu.delay ?? null)
                    : null;
                if (delaySec === null && stops.length > 0) {
                    // Find stop closest to now
                    let chosen = stops[0];
                    for (const s of stops) {
                        const t = s.arrivalUnix ?? s.departureUnix ?? 0;
                        if (t >= nowUnix - 60) {
                            chosen = s;
                            break;
                        }
                    }
                    delaySec =
                        chosen.arrivalDelay ?? chosen.departureDelay ?? null;
                }

                tripUpdates.set(tripId, {
                    tripId,
                    routeId: tu.trip.routeId ?? null,
                    startDate: tu.trip.startDate ?? null,
                    startTime: tu.trip.startTime ?? null,
                    delaySec,
                    stops,
                });
            }
        }
        this.tripUpdates = tripUpdates;

        // 2. Parse Alerts
        const parsedAlerts: ServiceAlert[] = [];
        if (alertsFeed) {
            this.alertsTimestamp =
                toNumber(alertsFeed.header?.timestamp) ?? nowUnix;
            for (const entity of alertsFeed.entity ?? []) {
                const al = entity.alert;
                if (!al) continue;

                const activePeriods = (al.activePeriod ?? []).map((p) => ({
                    start: toNumber(p.start),
                    end: toNumber(p.end),
                }));

                // Include alerts currently active or starting within 6h
                const isRelevant =
                    activePeriods.length === 0 ||
                    activePeriods.some((p) => {
                        const started =
                            p.start === null || p.start <= nowUnix + 6 * 3600;
                        const notEnded =
                            p.end === null || p.end >= nowUnix - 1800;
                        return started && notEnded;
                    });
                if (!isRelevant) continue;

                const routeIds = new Set<string>();
                const routeShortNames = new Set<string>();
                const stopIds = new Set<string>();
                const tripIds = new Set<string>();

                for (const ie of al.informedEntity ?? []) {
                    if (ie.routeId) {
                        routeIds.add(ie.routeId);
                        const route = staticGtfs.getRouteById(ie.routeId);
                        routeShortNames.add(
                            route?.shortName ?? ie.routeId.split("-")[0]
                        );
                    }
                    if (ie.stopId) stopIds.add(ie.stopId);
                    if (ie.trip?.tripId) tripIds.add(ie.trip.tripId);
                }

                const header =
                    al.headerText?.translation?.[0]?.text?.trim() ??
                    "Service alert";
                const description =
                    al.descriptionText?.translation?.[0]?.text?.trim() ?? "";
                const url = al.url?.translation?.[0]?.text?.trim() || null;

                parsedAlerts.push({
                    id: entity.id || fnv1aHex(header),
                    cause: CAUSE_NAMES[al.cause ?? 1] ?? "OTHER_CAUSE",
                    effect: EFFECT_NAMES[al.effect ?? 8] ?? "OTHER_EFFECT",
                    header,
                    description,
                    url,
                    activePeriods,
                    routeIds: [...routeIds],
                    routeShortNames: [...routeShortNames],
                    stopIds: [...stopIds],
                    tripIds: [...tripIds],
                });
            }
        }
        this.alerts = parsedAlerts;

        // 3. Parse & enrich VehiclePositions
        if (!vpFeed) return;

        const feedSeq = toNumber(vpFeed.header?.timestamp) ?? nowUnix;
        this.vpTimestamp = feedSeq;

        const vehicles: VehiclePosition[] = [];
        const byId = new Map<string, VehiclePosition>();
        const byRawId = new Map<string, VehiclePosition>();
        const activeTripVehicle = new Map<
            string,
            { id: string; label: string | null }
        >();
        const nextMotion = new Map<string, VehicleMotionState>();

        for (const entity of vpFeed.entity ?? []) {
            const v = entity.vehicle;
            if (!v?.position) continue;

            const lat = v.position.latitude ?? 0;
            const lon = v.position.longitude ?? 0;
            if (
                !lat ||
                !lon ||
                !Number.isFinite(lat) ||
                !Number.isFinite(lon)
            ) {
                continue;
            }

            const rawVehicleId =
                v.vehicle?.id ||
                entity.id ||
                `${lat.toFixed(5)}_${lon.toFixed(5)}`;
            const shortId = this.makeShortVehicleId(rawVehicleId);
            const label = v.vehicle?.label?.trim() || null;

            const tripId = v.trip?.tripId ?? null;
            const rawRouteId = v.trip?.routeId ?? null;
            const staticTrip = staticGtfs.getTrip(tripId);
            const routeId = rawRouteId ?? staticTrip?.routeId ?? null;
            const staticRoute = staticGtfs.getRouteById(routeId);
            const tu = tripId ? tripUpdates.get(tripId) : undefined;

            const routeShort =
                staticRoute?.shortName ??
                (routeId ? routeId.split("-")[0] : null);
            const mode: TransitMode =
                staticRoute?.mode ??
                (routeShort ? inferModeFromRouteShort(routeShort) : "bus");
            const fallbackColors = defaultColorForMode(mode);
            const color = staticRoute?.color ?? fallbackColors.color;
            const textColor =
                staticRoute?.textColor ?? fallbackColors.textColor;
            const routeLongName = staticRoute?.longName ?? null;

            const directionId = hasOwnField(v.trip, "directionId")
                ? Number(v.trip!.directionId)
                : (staticTrip?.directionId ?? null);

            // Headsign from static trip, or fallback to last stop of TripUpdate
            let headsign = staticTrip?.headsign ?? null;
            if (!headsign && tu && tu.stops.length > 0) {
                const lastStu = tu.stops[tu.stops.length - 1];
                const destStop = staticGtfs.getStopById(lastStu.stopId);
                if (destStop) {
                    headsign = destStop.name;
                }
            }

            const stopId = v.stopId ?? null;
            const staticStop = staticGtfs.getStopById(stopId);
            const stopSequence = hasOwnField(v, "currentStopSequence")
                ? (v.currentStopSequence ?? null)
                : null;
            const statusCode =
                hasOwnField(v, "currentStatus") &&
                (v.currentStatus === 0 ||
                    v.currentStatus === 1 ||
                    v.currentStatus === 2)
                    ? v.currentStatus
                    : 2;

            // Live delay & next arrival at current/next stop
            let delaySec: number | null = tu?.delaySec ?? null;
            let nextArrivalUnix: number | null = null;
            if (tu && tu.stops.length > 0) {
                const matchingStu =
                    tu.stops.find(
                        (s) =>
                            (stopId && s.stopId === stopId) ||
                            (stopSequence !== null &&
                                s.stopSequence === stopSequence)
                    ) ??
                    tu.stops.find(
                        (s) =>
                            (s.arrivalUnix ?? s.departureUnix ?? 0) >=
                            nowUnix - 30
                    );
                if (matchingStu) {
                    delaySec =
                        matchingStu.arrivalDelay ??
                        matchingStu.departureDelay ??
                        delaySec;
                    nextArrivalUnix =
                        matchingStu.arrivalUnix ??
                        matchingStu.departureUnix ??
                        null;
                }
            }

            const updatedAt = toNumber(v.timestamp) ?? feedSeq;

            delaySec = sanitizeDelay(delaySec, stopSequence);

            // Compute bearing & speed
            let bearing: number | null = hasOwnField(v.position, "bearing")
                ? Math.round(v.position.bearing!)
                : null;
            let speedKmh: number | null = hasOwnField(v.position, "speed")
                ? Math.round(v.position.speed! * 3.6)
                : null;

            const prev = this.motionByVehicle.get(shortId);
            if (prev) {
                const dt = updatedAt - prev.timestamp;
                const dist = distanceMeters(prev.lat, prev.lon, lat, lon);
                if (dt >= 4 && dt <= 240) {
                    if (dist >= 16) {
                        if (bearing === null) {
                            bearing = computeForwardBearing(
                                prev.lat,
                                prev.lon,
                                lat,
                                lon
                            );
                        }
                        if (speedKmh === null) {
                            const rawKmh = (dist / dt) * 3.6;
                            if (rawKmh <= 135) {
                                speedKmh = Math.round(rawKmh);
                            }
                        }
                    } else if (dist < 6) {
                        if (speedKmh === null) speedKmh = 0;
                        if (bearing === null) bearing = prev.bearing;
                    } else if (bearing === null) {
                        bearing = prev.bearing;
                    }
                } else if (dt === 0) {
                    if (bearing === null) bearing = prev.bearing;
                    if (speedKmh === null) speedKmh = prev.speedKmh;
                }
            }

            // Shape tangent fallback for immediate accurate direction on first load or stopped vehicles
            if (bearing === null && staticTrip?.shapeId) {
                bearing = staticGtfs.computeShapeBearingAt(
                    staticTrip.shapeId,
                    lat,
                    lon
                );
            }
            if (bearing === null && staticStop && statusCode !== 1) {
                const dStop = distanceMeters(
                    lat,
                    lon,
                    staticStop.lat,
                    staticStop.lon
                );
                if (dStop >= 20 && dStop <= 3000) {
                    bearing = computeForwardBearing(
                        lat,
                        lon,
                        staticStop.lat,
                        staticStop.lon
                    );
                }
            }

            nextMotion.set(shortId, {
                lat,
                lon,
                timestamp: updatedAt,
                bearing,
                speedKmh,
            });

            const enriched: VehiclePosition = {
                id: shortId,
                vehicle: rawVehicleId,
                label,
                route: routeShort,
                routeId,
                routeLongName,
                mode,
                color,
                textColor,
                trip: tripId,
                directionId,
                headsign,
                lat: Math.round(lat * 1e6) / 1e6,
                lon: Math.round(lon * 1e6) / 1e6,
                bearing,
                speedKmh,
                status: statusToEnum(statusCode),
                statusCode,
                stopId,
                stopName: staticStop?.name ?? null,
                stopCode: staticStop?.code ?? null,
                stopSequence,
                delaySec,
                nextArrivalUnix,
                updatedAt,
            };

            vehicles.push(enriched);
            byId.set(shortId, enriched);
            byRawId.set(rawVehicleId, enriched);
            if (tripId) {
                activeTripVehicle.set(tripId, { id: shortId, label });
            }
        }

        this.motionByVehicle = nextMotion;
        this.vehicles = vehicles;
        this.vehiclesById = byId;
        this.vehiclesByRawId = byRawId;

        // 4. Build upcoming stop departures index (next 90 mins) for fast /stops/:stopId
        const departuresByStop = new Map<string, StopDeparture[]>();
        const horizonUnix = nowUnix + 90 * 60;
        for (const tu of tripUpdates.values()) {
            const staticTrip = staticGtfs.getTrip(tu.tripId);
            const rId = tu.routeId ?? staticTrip?.routeId ?? null;
            const route = staticGtfs.getRouteById(rId);
            const routeShort =
                route?.shortName ?? (rId ? rId.split("-")[0] : "?");
            const mode = route?.mode ?? inferModeFromRouteShort(routeShort);
            const fallback = defaultColorForMode(mode);
            const veh = activeTripVehicle.get(tu.tripId);

            let headsign = staticTrip?.headsign ?? null;
            if (!headsign && tu.stops.length > 0) {
                const lastStop = staticGtfs.getStopById(
                    tu.stops[tu.stops.length - 1].stopId
                );
                headsign = lastStop?.name ?? null;
            }

            for (const stu of tu.stops) {
                if (stu.skipped || !stu.stopId) continue;
                const pred = stu.departureUnix ?? stu.arrivalUnix;
                if (!pred || pred < nowUnix - 60 || pred > horizonUnix) {
                    continue;
                }
                const rawDelay =
                    stu.departureDelay ?? stu.arrivalDelay ?? tu.delaySec;
                const delay = sanitizeDelay(rawDelay, stu.stopSequence);
                const schedUnix = rawDelay !== null ? pred - rawDelay : null;
                const stopInfo = staticGtfs.getStopById(stu.stopId);

                let list = departuresByStop.get(stu.stopId);
                if (!list) {
                    list = [];
                    departuresByStop.set(stu.stopId, list);
                }
                list.push({
                    tripId: tu.tripId,
                    routeShortName: routeShort,
                    routeLongName: route?.longName ?? null,
                    mode,
                    color: route?.color ?? fallback.color,
                    textColor: route?.textColor ?? fallback.textColor,
                    headsign,
                    directionId: staticTrip?.directionId ?? null,
                    scheduledUnix: schedUnix,
                    predictedUnix: pred,
                    delaySec: delay,
                    vehicleId: veh?.id ?? null,
                    vehicleLabel: veh?.label ?? null,
                    platformCode: stopInfo?.platformCode ?? null,
                    stopId: stu.stopId,
                });
            }
        }
        this.departuresByStop = departuresByStop;

        // 5. Build precompressed legacy/full vehicle_positions + compact sync snapshot
        this.vehiclesListCompressed = buildPrecompressedJson(
            {
                seq: feedSeq,
                updatedAt: feedSeq,
                count: vehicles.length,
                vehicles,
            },
            `vp-${this.syncEpoch}-${feedSeq}-${vehicles.length}`
        );

        this.recordSyncSnapshot(feedSeq, nowUnix, vehicles);
    }

    private recordSyncSnapshot(
        seq: number,
        serverTime: number,
        vehicles: VehiclePosition[]
    ): void {
        // Avoid duplicate snapshot if feed header timestamp did not advance and count matches
        const latest = this.syncHistory[this.syncHistory.length - 1];
        if (
            latest &&
            latest.seq === seq &&
            latest.byId.size === vehicles.length
        ) {
            return;
        }
        const effectiveSeq = latest && seq <= latest.seq ? latest.seq + 1 : seq;

        const tupleById = new Map<string, SyncVehicleTuple>();
        const tuples: SyncVehicleTuple[] = [];

        for (const v of vehicles) {
            const routeIdx = this.internRoute(
                v.route ?? "?",
                v.routeLongName ?? "",
                v.mode,
                v.color,
                v.textColor
            );
            const headsignIdx = this.internHeadsign(v.headsign);
            const latE5 = Math.round(v.lat * 1e5);
            const lonE5 = Math.round(v.lon * 1e5);
            const bearing = v.bearing ?? -1;
            const speedKmh = v.speedKmh ?? -1;
            const dir = v.directionId ?? -1;
            const ageSec = Math.max(
                0,
                Math.min(999, effectiveSeq - v.updatedAt)
            );

            const tuple: SyncVehicleTuple = [
                v.id,
                v.label ?? "",
                routeIdx,
                dir,
                headsignIdx,
                latE5,
                lonE5,
                bearing,
                speedKmh,
                v.statusCode,
                v.delaySec,
                ageSec,
            ];
            tupleById.set(v.id, tuple);
            tuples.push(tuple);
        }

        const fullPayload: SyncFullResponse = {
            mode: "full",
            epoch: this.syncEpoch,
            seq: effectiveSeq,
            serverTime,
            totalCount: tuples.length,
            routes: [...this.routeDict],
            headsigns: [...this.headsignDict],
            vehicles: tuples,
        };

        const fullCompressed = buildPrecompressedJson(
            fullPayload,
            `sync-full-${this.syncEpoch}-${effectiveSeq}`
        );

        this.syncHistory.push({
            seq: effectiveSeq,
            serverTime,
            routesLen: this.routeDict.length,
            headsignsLen: this.headsignDict.length,
            byId: tupleById,
            fullCompressed,
            deltaCache: new Map(),
        });

        while (this.syncHistory.length > MAX_SYNC_HISTORY) {
            this.syncHistory.shift();
        }
    }

    public getStatusSummary() {
        const nowUnix = Math.floor(Date.now() / 1000);
        const byMode: Record<TransitMode, number> = {
            bus: 0,
            rail: 0,
            ferry: 0,
            tram: 0,
        };
        for (const v of this.vehicles) {
            byMode[v.mode]++;
        }

        const latestSync = this.syncHistory[this.syncHistory.length - 1];
        return {
            healthy: this.vehicles.length > 0 || this.lastFetchUnix > 0,
            realtime: {
                seq: latestSync?.seq ?? this.vpTimestamp,
                vehiclePositionsTimestamp: this.vpTimestamp || null,
                vehiclePositionsAgeSec: this.vpTimestamp
                    ? Math.max(0, nowUnix - this.vpTimestamp)
                    : null,
                tripUpdatesTimestamp: this.tuTimestamp || null,
                alertsTimestamp: this.alertsTimestamp || null,
                lastPollUnix: this.lastFetchUnix || null,
                counts: {
                    vehicles: this.vehicles.length,
                    byMode,
                    tripUpdates: this.tripUpdates.size,
                    activeAlerts: this.alerts.length,
                },
                wireBytes: latestSync
                    ? {
                          fullRawBytes:
                              latestSync.fullCompressed.raw.byteLength,
                          fullBrotliBytes:
                              latestSync.fullCompressed.br.byteLength,
                          fullGzipBytes:
                              latestSync.fullCompressed.gzip.byteLength,
                      }
                    : null,
            },
            staticGtfs: {
                ready: staticGtfs.isReady(),
                feed: staticGtfs.getFeedInfo(),
            },
        };
    }

    public getPrecompressedAllVehicles(): PrecompressedPayload | null {
        return this.vehiclesListCompressed;
    }

    public getFilteredVehicles(filters: {
        route?: string;
        mode?: string;
        direction?: string;
        bbox?: string;
    }): VehiclePosition[] {
        let result = this.vehicles;

        if (filters.mode) {
            const m = filters.mode.toLowerCase();
            result = result.filter((v) => v.mode === m);
        }
        if (filters.route) {
            const q = filters.route.trim().toLowerCase();
            result = result.filter(
                (v) =>
                    v.route?.toLowerCase() === q ||
                    v.routeId?.toLowerCase() === q
            );
        }
        if (filters.direction !== undefined && filters.direction !== "") {
            const d = Number(filters.direction);
            if (!Number.isNaN(d)) {
                result = result.filter((v) => v.directionId === d);
            }
        }
        if (filters.bbox) {
            const parts = filters.bbox.split(",").map(Number);
            if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
                const [minLon, minLat, maxLon, maxLat] = parts;
                result = result.filter(
                    (v) =>
                        v.lon >= minLon &&
                        v.lon <= maxLon &&
                        v.lat >= minLat &&
                        v.lat <= maxLat
                );
            }
        }

        return result;
    }

    public getSyncPayload(params: {
        since?: number;
        epoch?: string;
    }):
        | { status: 304; etag: string }
        | { status: 200; payload: PrecompressedPayload }
        | null {
        const current = this.syncHistory[this.syncHistory.length - 1];
        if (!current) return null;

        if (
            params.epoch &&
            params.epoch === this.syncEpoch &&
            typeof params.since === "number" &&
            Number.isFinite(params.since)
        ) {
            if (params.since === current.seq) {
                return {
                    status: 304,
                    etag: `"sync-${this.syncEpoch}-${current.seq}"`,
                };
            }

            const base = this.syncHistory.find((s) => s.seq === params.since);
            if (base) {
                const cacheKey = `${base.seq}`;
                let deltaCompressed = current.deltaCache.get(cacheKey);
                if (!deltaCompressed) {
                    const delta = this.computeDelta(base, current);
                    deltaCompressed = buildPrecompressedJson(
                        delta,
                        `sync-delta-${this.syncEpoch}-${base.seq}-${current.seq}`
                    );
                    current.deltaCache.set(cacheKey, deltaCompressed);
                }
                // Only send delta if smaller than full snapshot
                if (
                    deltaCompressed.br.byteLength <
                    current.fullCompressed.br.byteLength
                ) {
                    return { status: 200, payload: deltaCompressed };
                }
            }
        }

        return { status: 200, payload: current.fullCompressed };
    }

    private computeDelta(
        base: SyncSnapshotEntry,
        current: SyncSnapshotEntry
    ): SyncDeltaResponse {
        const added: SyncVehicleTuple[] = [];
        const updated: SyncVehicleTuple[] = [];
        const moved: SyncMovedTuple[] = [];
        const removed: string[] = [];

        for (const [id, cur] of current.byId.entries()) {
            const prev = base.byId.get(id);
            if (!prev) {
                added.push(cur);
                continue;
            }
            // Tuple indices:
            // [0:id, 1:label, 2:routeIdx, 3:dir, 4:headsignIdx, 5:latE5, 6:lonE5, 7:bearing, 8:speedKmh, 9:statusCode, 10:delaySec, 11:ageSec]
            if (
                prev[1] !== cur[1] ||
                prev[2] !== cur[2] ||
                prev[3] !== cur[3] ||
                prev[4] !== cur[4]
            ) {
                updated.push(cur);
                continue;
            }

            const dLatE5 = cur[5] - prev[5];
            const dLonE5 = cur[6] - prev[6];
            if (
                dLatE5 !== 0 ||
                dLonE5 !== 0 ||
                prev[7] !== cur[7] ||
                prev[8] !== cur[8] ||
                prev[9] !== cur[9] ||
                prev[10] !== cur[10]
            ) {
                moved.push([
                    id,
                    dLatE5,
                    dLonE5,
                    cur[7],
                    cur[8],
                    cur[9],
                    cur[10],
                    cur[11],
                ]);
            }
        }

        for (const id of base.byId.keys()) {
            if (!current.byId.has(id)) {
                removed.push(id);
            }
        }

        return {
            mode: "delta",
            epoch: this.syncEpoch,
            seq: current.seq,
            baseSeq: base.seq,
            serverTime: current.serverTime,
            totalCount: current.byId.size,
            routesOffset: base.routesLen,
            routesAdded: this.routeDict.slice(
                base.routesLen,
                current.routesLen
            ),
            headsignsOffset: base.headsignsLen,
            headsignsAdded: this.headsignDict.slice(
                base.headsignsLen,
                current.headsignsLen
            ),
            added,
            updated,
            moved,
            removed,
        };
    }

    public getVehicleById(idOrRaw: string): VehiclePosition | null {
        return (
            this.vehiclesById.get(idOrRaw) ??
            this.vehiclesByRawId.get(idOrRaw) ??
            null
        );
    }

    public getVehicleDetail(idOrRaw: string): VehicleDetail | null {
        const vehicle = this.getVehicleById(idOrRaw);
        if (!vehicle) return null;

        const staticTrip = staticGtfs.getTrip(vehicle.trip);
        const tu = vehicle.trip
            ? this.tripUpdates.get(vehicle.trip)
            : undefined;

        // Shape polyline
        let shape: GeoJsonLineString | null = null;
        if (staticTrip?.shapeId) {
            shape = staticGtfs.getShapeLineString(staticTrip.shapeId, 750);
        }

        // Ordered stop calls combining static stop_times + realtime TripUpdates
        const staticStops = staticGtfs.getTripStops(vehicle.trip);
        const serviceDate =
            tu?.startDate || currentBrisbaneServiceDate(vehicle.updatedAt);

        const stuBySeq = new Map<number, ParsedStopTimeUpdate>();
        const stuByStopId = new Map<string, ParsedStopTimeUpdate>();
        for (const s of tu?.stops ?? []) {
            if (s.stopSequence !== null) stuBySeq.set(s.stopSequence, s);
            if (s.stopId) stuByStopId.set(s.stopId, s);
        }

        const nowUnix = Math.floor(Date.now() / 1000);
        const stopCalls: VehicleStopCall[] = [];

        if (staticStops.length > 0) {
            let foundCurrent = false;
            const curSeq = vehicle.stopSequence;

            for (const [stopId, seq, arrSec, depSec] of staticStops) {
                const stopInfo = staticGtfs.getStopById(stopId);
                if (!stopInfo) continue;

                const stu = stuBySeq.get(seq) ?? stuByStopId.get(stopId);
                const schedSec = arrSec >= 0 ? arrSec : depSec;
                const scheduledTime = formatGtfsSeconds(schedSec);
                const scheduledUnix = serviceDateSecToUnix(
                    serviceDate,
                    schedSec
                );

                const rawDelay =
                    stu?.arrivalDelay ??
                    stu?.departureDelay ??
                    vehicle.delaySec ??
                    null;
                const delaySec = sanitizeDelay(rawDelay, seq);
                const predictedUnix =
                    stu?.arrivalUnix ??
                    stu?.departureUnix ??
                    (scheduledUnix !== null && delaySec !== null
                        ? scheduledUnix + delaySec
                        : scheduledUnix);

                let status: VehicleStopCall["status"] = "upcoming";
                if (stu?.skipped) {
                    status = "skipped";
                } else if (curSeq !== null) {
                    if (seq < curSeq) {
                        status = "passed";
                    } else if (seq === curSeq) {
                        status = "current";
                        foundCurrent = true;
                    } else {
                        status = "upcoming";
                    }
                } else if (
                    vehicle.stopId &&
                    stopId === vehicle.stopId &&
                    !foundCurrent
                ) {
                    status = "current";
                    foundCurrent = true;
                } else if (
                    predictedUnix !== null &&
                    predictedUnix < nowUnix - 45
                ) {
                    status = "passed";
                } else if (!foundCurrent) {
                    status = "current";
                    foundCurrent = true;
                }

                stopCalls.push({
                    stopId,
                    stopCode: stopInfo.code,
                    stopName: stopInfo.name,
                    platformCode: stopInfo.platformCode,
                    lat: stopInfo.lat,
                    lon: stopInfo.lon,
                    stopSequence: seq,
                    scheduledTime,
                    scheduledUnix,
                    predictedUnix,
                    delaySec,
                    status,
                });
            }
        } else if (tu && tu.stops.length > 0) {
            // Fallback for unscheduled / added trips using TripUpdates stops directly
            let foundCurrent = false;
            for (let i = 0; i < tu.stops.length; i++) {
                const stu = tu.stops[i];
                if (!stu.stopId) continue;
                const stopInfo = staticGtfs.getStopById(stu.stopId);
                if (!stopInfo) continue;
                const pred = stu.arrivalUnix ?? stu.departureUnix ?? null;
                const rawDelay =
                    stu.arrivalDelay ?? stu.departureDelay ?? tu.delaySec;
                const delay = sanitizeDelay(
                    rawDelay,
                    stu.stopSequence ?? i + 1
                );
                const schedUnix =
                    pred !== null && rawDelay !== null ? pred - rawDelay : null;

                let status: VehicleStopCall["status"] = "upcoming";
                if (stu.skipped) {
                    status = "skipped";
                } else if (vehicle.stopId === stu.stopId && !foundCurrent) {
                    status = "current";
                    foundCurrent = true;
                } else if (pred !== null && pred < nowUnix - 45) {
                    status = "passed";
                } else if (!foundCurrent) {
                    status = "current";
                    foundCurrent = true;
                }

                stopCalls.push({
                    stopId: stu.stopId,
                    stopCode: stopInfo.code,
                    stopName: stopInfo.name,
                    platformCode: stopInfo.platformCode,
                    lat: stopInfo.lat,
                    lon: stopInfo.lon,
                    stopSequence: stu.stopSequence ?? i + 1,
                    scheduledTime: null,
                    scheduledUnix: schedUnix,
                    predictedUnix: pred,
                    delaySec: delay,
                    status,
                });
            }
        }

        // If shape was missing (added trip), synthesize a clean stop-to-stop polyline
        if (!shape && stopCalls.length >= 2) {
            shape = {
                type: "LineString",
                coordinates: stopCalls.map((s) => [s.lon, s.lat]),
            };
        }

        // Summarize directions for this vehicle's route (including QR paired reverse route)
        const routeDirections: VehicleDetail["routeDirections"] = [];
        if (vehicle.route) {
            const detail = this.getRouteDetail(vehicle.route);
            if (detail) {
                for (const d of detail.directions) {
                    routeDirections.push({
                        directionId: d.directionId,
                        routeShortName: d.routeShortName,
                        headsigns: d.headsigns,
                        activeVehicleCount: d.activeVehicleCount,
                    });
                }
            }
        }

        const alerts = this.getAlerts({
            route: vehicle.route ?? undefined,
            tripId: vehicle.trip ?? undefined,
        });

        return {
            vehicle,
            shape,
            stops: stopCalls,
            routeDirections,
            alerts,
        };
    }

    public getRoutesSummary(options: {
        q?: string;
        mode?: string;
        activeOnly?: boolean;
        limit?: number;
    }) {
        const activeCounts = new Map<
            string,
            { total: number; dir0: number; dir1: number }
        >();
        for (const v of this.vehicles) {
            if (!v.route) continue;
            const key = v.route.toUpperCase();
            let c = activeCounts.get(key);
            if (!c) {
                c = { total: 0, dir0: 0, dir1: 0 };
                activeCounts.set(key, c);
            }
            c.total++;
            if (v.directionId === 0) c.dir0++;
            else if (v.directionId === 1) c.dir1++;
        }

        const query = options.q?.trim().toLowerCase() ?? "";
        const modeFilter = options.mode?.trim().toLowerCase() ?? "";
        const limit = Math.min(Math.max(options.limit ?? 100, 1), 600);

        let routes = staticGtfs.getAllUniqueRoutes();
        // If static GTFS hasn't finished indexing yet, synthesize from active vehicles
        if (routes.length === 0) {
            const seen = new Map<string, VehiclePosition>();
            for (const v of this.vehicles) {
                if (v.route && !seen.has(v.route.toUpperCase())) {
                    seen.set(v.route.toUpperCase(), v);
                }
            }
            routes = [...seen.values()].map((v) => ({
                routeId: v.routeId ?? v.route!,
                shortName: v.route!,
                longName: v.routeLongName ?? v.headsign ?? v.route!,
                desc: null,
                type:
                    v.mode === "tram"
                        ? 0
                        : v.mode === "rail"
                          ? 2
                          : v.mode === "ferry"
                            ? 4
                            : 3,
                mode: v.mode,
                color: v.color,
                textColor: v.textColor,
                url: null,
            }));
        }

        const items = [];
        for (const r of routes) {
            const counts = activeCounts.get(r.shortName.toUpperCase()) ?? {
                total: 0,
                dir0: 0,
                dir1: 0,
            };
            if (options.activeOnly && counts.total === 0) continue;
            if (modeFilter && r.mode !== modeFilter) continue;

            const dirRecords = staticGtfs.getRouteDirectionRecords(r.shortName);
            const headsigns = [
                ...new Set(dirRecords.flatMap((d) => d.headsigns)),
            ];

            if (query) {
                const matches =
                    r.shortName.toLowerCase().includes(query) ||
                    r.longName.toLowerCase().includes(query) ||
                    headsigns.some((h) => h.toLowerCase().includes(query));
                if (!matches) continue;
            }

            items.push({
                shortName: r.shortName,
                longName: r.longName,
                mode: r.mode,
                color: r.color,
                textColor: r.textColor,
                url: r.url,
                headsigns: headsigns.slice(0, 4),
                activeVehicles: counts.total,
                activeByDirection: {
                    0: counts.dir0,
                    1: counts.dir1,
                },
            });
        }

        items.sort((a, b) => {
            if (query) {
                const aExact = a.shortName.toLowerCase() === query ? 1 : 0;
                const bExact = b.shortName.toLowerCase() === query ? 1 : 0;
                if (aExact !== bExact) return bExact - aExact;
                const aStarts = a.shortName.toLowerCase().startsWith(query)
                    ? 1
                    : 0;
                const bStarts = b.shortName.toLowerCase().startsWith(query)
                    ? 1
                    : 0;
                if (aStarts !== bStarts) return bStarts - aStarts;
            }
            if (b.activeVehicles !== a.activeVehicles) {
                return b.activeVehicles - a.activeVehicles;
            }
            return a.shortName.localeCompare(b.shortName, undefined, {
                numeric: true,
            });
        });

        return items.slice(0, limit);
    }

    public getRouteDetail(routeKey: string): RouteDetail | null {
        const clean = decodeURIComponent(routeKey).trim();
        if (!clean) return null;

        const directRoute =
            staticGtfs.getPrimaryRouteByShortName(clean) ??
            staticGtfs.getRouteById(clean);

        // Fallback if static GTFS still indexing on cold start
        const matchingActive = this.vehicles.filter(
            (v) =>
                v.route?.toUpperCase() === clean.toUpperCase() ||
                v.routeId?.toUpperCase() === clean.toUpperCase()
        );

        if (!directRoute && matchingActive.length === 0) {
            return null;
        }

        const shortName =
            directRoute?.shortName ??
            matchingActive[0]?.route ??
            clean.split("-")[0];
        const mode =
            directRoute?.mode ??
            matchingActive[0]?.mode ??
            inferModeFromRouteShort(shortName);
        const fallback = defaultColorForMode(mode);
        const pairedShortName = staticGtfs.findPairedRailShortName(shortName);

        const targetShortNames = [shortName];
        if (
            pairedShortName &&
            pairedShortName.toUpperCase() !== shortName.toUpperCase()
        ) {
            targetShortNames.push(pairedShortName);
        }

        const directions: RouteDirectionInfo[] = [];

        for (const sName of targetShortNames) {
            const dirRecords = staticGtfs
                .getRouteDirectionRecords(sName)
                .sort((a, b) => a.directionId - b.directionId);

            const activeForShort = this.vehicles.filter(
                (v) => v.route?.toUpperCase() === sName.toUpperCase()
            );

            if (dirRecords.length > 0) {
                for (const rec of dirRecords) {
                    const dirVehicles = activeForShort.filter(
                        (v) =>
                            v.directionId === rec.directionId ||
                            (dirRecords.length === 1 && v.directionId === null)
                    );

                    // Build canonical shape (primary shape, or MultiLineString if major branches)
                    let shape:
                        GeoJsonLineString | GeoJsonMultiLineString | null =
                        null;
                    if (rec.primaryShapeId) {
                        shape = staticGtfs.getShapeLineString(
                            rec.primaryShapeId,
                            650
                        );
                    }

                    // Ordered stops from sampleTripId
                    const stopsList: RouteDirectionInfo["stops"] = [];
                    if (rec.sampleTripId) {
                        const tupleStops = staticGtfs.getTripStops(
                            rec.sampleTripId
                        );
                        for (const [stopId, seq] of tupleStops) {
                            const s = staticGtfs.getStopById(stopId);
                            if (!s) continue;
                            stopsList.push({
                                stopId: s.stopId,
                                code: s.code,
                                name: s.name,
                                platformCode: s.platformCode,
                                lat: s.lat,
                                lon: s.lon,
                                sequence: seq,
                            });
                        }
                    }

                    const liveHeadsigns = [
                        ...new Set(
                            dirVehicles
                                .map((v) => v.headsign)
                                .filter((h): h is string => Boolean(h))
                        ),
                    ];
                    const mergedHeadsigns = [
                        ...new Set([...rec.headsigns, ...liveHeadsigns]),
                    ];
                    const label =
                        mergedHeadsigns[0] ??
                        (rec.directionId === 0 ? "Inbound" : "Outbound");

                    directions.push({
                        directionId: rec.directionId,
                        routeShortName: sName,
                        label,
                        headsigns: mergedHeadsigns,
                        activeVehicleCount: dirVehicles.length,
                        shape,
                        stops: stopsList,
                        vehicles: dirVehicles,
                    });
                }
            } else if (activeForShort.length > 0) {
                // Group active vehicles by directionId if static DB isn't loaded yet
                for (const dirId of [0, 1]) {
                    const dv = activeForShort.filter(
                        (v) => (v.directionId ?? 0) === dirId
                    );
                    if (dv.length === 0) continue;
                    const hs = [
                        ...new Set(
                            dv
                                .map((v) => v.headsign)
                                .filter((h): h is string => Boolean(h))
                        ),
                    ];
                    directions.push({
                        directionId: dirId,
                        routeShortName: sName,
                        label:
                            hs[0] ??
                            (dirId === 0 ? "Direction 0" : "Direction 1"),
                        headsigns: hs,
                        activeVehicleCount: dv.length,
                        shape: null,
                        stops: [],
                        vehicles: dv,
                    });
                }
            }
        }

        directions.sort((a, b) => a.directionId - b.directionId);

        const alerts = [
            ...new Map(
                targetShortNames
                    .flatMap((s) => this.getAlerts({ route: s }))
                    .map((a) => [a.id, a])
            ).values(),
        ];

        const activeVehicleCount = directions.reduce(
            (sum, d) => sum + d.activeVehicleCount,
            0
        );

        return {
            shortName,
            longName:
                directRoute?.longName ??
                matchingActive[0]?.routeLongName ??
                shortName,
            mode,
            type:
                directRoute?.type ??
                (mode === "tram"
                    ? 0
                    : mode === "rail"
                      ? 2
                      : mode === "ferry"
                        ? 4
                        : 3),
            color:
                directRoute?.color ??
                matchingActive[0]?.color ??
                fallback.color,
            textColor:
                directRoute?.textColor ??
                matchingActive[0]?.textColor ??
                fallback.textColor,
            url: directRoute?.url ?? null,
            pairedShortName,
            activeVehicleCount,
            directions,
            alerts,
        };
    }

    public getStopDetail(stopId: string) {
        const stop = staticGtfs.getStopById(stopId);
        if (!stop) return null;

        const childPlatforms = staticGtfs.getChildStops(stop.stopId);
        const targetStopIds =
            childPlatforms.length > 0
                ? [stop.stopId, ...childPlatforms.map((c) => c.stopId)]
                : [stop.stopId];

        const departures: StopDeparture[] = [];
        for (const sid of targetStopIds) {
            const deps = this.departuresByStop.get(sid);
            if (deps) departures.push(...deps);
        }
        departures.sort((a, b) => a.predictedUnix - b.predictedUnix);

        const alerts = [
            ...new Map(
                targetStopIds
                    .flatMap((sid) => this.getAlerts({ stopId: sid }))
                    .map((a) => [a.id, a])
            ).values(),
        ];

        return {
            stop,
            platforms: childPlatforms,
            departures: departures.slice(0, 40),
            alerts,
        };
    }

    public getAlerts(filters?: {
        route?: string;
        stopId?: string;
        tripId?: string;
        mode?: string;
    }): ServiceAlert[] {
        let list = this.alerts;
        if (filters?.route) {
            const r = filters.route.trim().toUpperCase();
            list = list.filter(
                (a) =>
                    a.routeShortNames.some((s) => s.toUpperCase() === r) ||
                    a.routeIds.some((id) => id.toUpperCase() === r)
            );
        }
        if (filters?.stopId) {
            const s = filters.stopId.trim();
            list = list.filter((a) => a.stopIds.includes(s));
        }
        if (filters?.tripId) {
            const t = filters.tripId.trim();
            list = list.filter((a) => a.tripIds.includes(t));
        }
        if (filters?.mode) {
            const m = filters.mode.trim().toLowerCase();
            list = list.filter((a) =>
                a.routeIds.some(
                    (rid) => staticGtfs.getRouteById(rid)?.mode === m
                )
            );
        }
        return list;
    }
}

export const realtimeEngine = new RealtimeTransitEngine();
