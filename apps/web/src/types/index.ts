import type { LineString, MultiLineString } from "geojson";

export type TransitMode = "bus" | "rail" | "ferry" | "tram";

export type VehicleStopStatus = "INCOMING_AT" | "STOPPED_AT" | "IN_TRANSIT_TO";

export interface Vehicle {
    id: string;
    vehicle: string;
    label: string | null;
    route: string;
    routeLongName: string | null;
    mode: TransitMode;
    color: string;
    textColor: string;
    trip: string | null;
    directionId: number | null;
    headsign: string | null;
    lat: number;
    lon: number;
    bearing: number | null;
    speedKmh: number | null;
    status: VehicleStopStatus;
    statusCode: number;
    delaySec: number | null;
    updatedAt: number;
}

export interface VehicleStopCall {
    stopId: string;
    stopCode: string | null;
    stopName: string;
    platformCode: string | null;
    lat: number;
    lon: number;
    stopSequence: number;
    scheduledTime: string | null;
    scheduledUnix: number | null;
    predictedUnix: number | null;
    delaySec: number | null;
    status: "passed" | "current" | "upcoming" | "skipped";
}

export interface ServiceAlert {
    id: string;
    cause: string;
    effect: string;
    header: string;
    description: string;
    url: string | null;
    activePeriods: Array<{ start: number | null; end: number | null }>;
    routeIds: string[];
    routeShortNames: string[];
    stopIds: string[];
    tripIds: string[];
}

export interface VehicleDetail {
    vehicle: Vehicle & {
        routeId: string | null;
        stopId: string | null;
        stopName: string | null;
        stopCode: string | null;
        stopSequence: number | null;
        nextArrivalUnix: number | null;
    };
    shape: LineString | null;
    stops: VehicleStopCall[];
    routeDirections: Array<{
        directionId: number;
        routeShortName: string;
        headsigns: string[];
        activeVehicleCount: number;
    }>;
    alerts: ServiceAlert[];
}

export interface RouteDirectionInfo {
    directionId: number;
    routeShortName: string;
    label: string;
    headsigns: string[];
    activeVehicleCount: number;
    shape: LineString | MultiLineString | null;
    stops: Array<{
        stopId: string;
        code: string | null;
        name: string;
        platformCode: string | null;
        lat: number;
        lon: number;
        sequence: number;
    }>;
    vehicles: Vehicle[];
}

export interface RouteDetail {
    shortName: string;
    longName: string;
    mode: TransitMode;
    type: number;
    color: string;
    textColor: string;
    url: string | null;
    pairedShortName: string | null;
    activeVehicleCount: number;
    directions: RouteDirectionInfo[];
    alerts: ServiceAlert[];
}

export interface RouteSummary {
    shortName: string;
    longName: string;
    mode: TransitMode;
    color: string;
    textColor: string;
    url: string | null;
    headsigns: string[];
    activeVehicles: number;
    activeByDirection: {
        0: number;
        1: number;
    };
}

export interface StopDeparture {
    tripId: string;
    routeShortName: string;
    routeLongName: string | null;
    mode: TransitMode;
    color: string;
    textColor: string;
    headsign: string | null;
    directionId: number | null;
    scheduledUnix: number | null;
    predictedUnix: number;
    delaySec: number | null;
    vehicleId: string | null;
    vehicleLabel: string | null;
    platformCode: string | null;
    stopId: string;
}

export interface StopDetail {
    stop: {
        stopId: string;
        code: string | null;
        name: string;
        lat: number;
        lon: number;
        zoneId: string | null;
        platformCode: string | null;
        parentStation: string | null;
        locationType: number;
        url: string | null;
    };
    platforms: Array<{
        stopId: string;
        code: string | null;
        name: string;
        platformCode: string | null;
    }>;
    departures: StopDeparture[];
    alerts: ServiceAlert[];
}

export type SyncRouteDictTuple = [
    shortName: string,
    longName: string,
    modeCode: number,
    color: string,
    textColor: string,
];

export type SyncVehicleTuple = [
    id: string,
    label: string,
    routeIdx: number,
    directionId: number,
    headsignIdx: number,
    latE5: number,
    lonE5: number,
    bearing: number,
    speedKmh: number,
    statusCode: number,
    delaySec: number | null,
    ageSec: number,
];

export type SyncMovedTuple = [
    id: string,
    dLatE5: number,
    dLonE5: number,
    bearing: number,
    speedKmh: number,
    statusCode: number,
    delaySec: number | null,
    ageSec: number,
];

export interface SyncFullResponse {
    mode: "full";
    epoch: string;
    seq: number;
    serverTime: number;
    totalCount: number;
    routes: SyncRouteDictTuple[];
    headsigns: string[];
    vehicles: SyncVehicleTuple[];
}

export interface SyncDeltaResponse {
    mode: "delta";
    epoch: string;
    seq: number;
    baseSeq: number;
    serverTime: number;
    totalCount: number;
    routesOffset: number;
    routesAdded: SyncRouteDictTuple[];
    headsignsOffset: number;
    headsignsAdded: string[];
    added: SyncVehicleTuple[];
    updated: SyncVehicleTuple[];
    moved: SyncMovedTuple[];
    removed: string[];
}

export type SyncResponse = SyncFullResponse | SyncDeltaResponse;

export interface SyncTelemetry {
    seq: number;
    lastSyncMode: "full" | "delta" | "not-modified";
    lastWireBytes: number;
    lastRawBytes: number;
    sessionWireBytes: number;
    pollCount: number;
}
