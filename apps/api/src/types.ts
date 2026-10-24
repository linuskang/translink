export interface GeoJsonLineString {
    type: "LineString";
    coordinates: [number, number][];
}

export interface GeoJsonMultiLineString {
    type: "MultiLineString";
    coordinates: [number, number][][];
}

export type TransitMode = "bus" | "rail" | "ferry" | "tram";

export type VehicleStopStatus = "INCOMING_AT" | "STOPPED_AT" | "IN_TRANSIT_TO";

export interface GtfsFeedInfo {
    publisherName: string;
    publisherUrl: string;
    lang: string;
    startDate: string;
    endDate: string;
    etag: string | null;
    lastModified: string | null;
    indexedAt: string;
    counts: {
        routes: number;
        stops: number;
        trips: number;
        shapes: number;
    };
}

export interface GtfsRoute {
    routeId: string;
    shortName: string;
    longName: string;
    desc: string | null;
    type: number;
    mode: TransitMode;
    color: string;
    textColor: string;
    url: string | null;
}

export interface GtfsStop {
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
}

export interface GtfsTrip {
    tripId: string;
    routeId: string;
    serviceId: string;
    headsign: string | null;
    directionId: number | null;
    shapeId: string | null;
}

export type CompactTripStopTuple = [
    stopId: string,
    stopSequence: number,
    arrivalSec: number,
    departureSec: number,
];

export interface VehiclePosition {
    id: string;
    vehicle: string | null;
    label: string | null;
    route: string | null;
    routeId: string | null;
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
    stopId: string | null;
    stopName: string | null;
    stopCode: string | null;
    stopSequence: number | null;
    delaySec: number | null;
    nextArrivalUnix: number | null;
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

export interface RouteDirectionInfo {
    directionId: number;
    routeShortName: string;
    label: string;
    headsigns: string[];
    activeVehicleCount: number;
    shape: GeoJsonLineString | GeoJsonMultiLineString | null;
    stops: Array<{
        stopId: string;
        code: string | null;
        name: string;
        platformCode: string | null;
        lat: number;
        lon: number;
        sequence: number;
    }>;
    vehicles: VehiclePosition[];
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

export interface VehicleDetail {
    vehicle: VehiclePosition;
    shape: GeoJsonLineString | null;
    stops: VehicleStopCall[];
    routeDirections: Array<{
        directionId: number;
        routeShortName: string;
        headsigns: string[];
        activeVehicleCount: number;
    }>;
    alerts: ServiceAlert[];
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

/**
 * Compact Sync Wire Protocol:
 * modeCode: 0 = tram, 1 = rail, 2 = bus, 3 = ferry
 */
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
