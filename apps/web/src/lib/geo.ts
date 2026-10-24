import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    Point,
} from "geojson";
import type { RouteDirectionInfo, Vehicle, VehicleStopCall } from "@/types";

export interface VehicleGeoOptions {
    selectedVehicleId?: string | null;
    highlightedRoutes?: Set<string> | null;
    highlightedDirectionId?: number | null;
    showBothDirections?: boolean;
}

export function normalizeHex(
    hex: string | null | undefined,
    fallback = "E463A4"
): string {
    const cleaned = (hex ?? fallback).replace(/^#/, "").toUpperCase();
    return /^[0-9A-F]{6}$/.test(cleaned) ? cleaned : fallback;
}

export function vehiclesToGeoJSON(
    vehicles: Vehicle[],
    options?: VehicleGeoOptions
): FeatureCollection<Point> {
    const selectedId = options?.selectedVehicleId ?? null;
    const routeSet = options?.highlightedRoutes ?? null;
    const hasRouteFocus = Boolean(routeSet && routeSet.size > 0);
    const dirFilter = options?.highlightedDirectionId ?? null;
    const bothDirs = options?.showBothDirections ?? false;

    const features: Feature<Point>[] = [];

    for (const v of vehicles) {
        if (!v.lat || !v.lon) continue;

        const hex = normalizeHex(v.color);
        const hasBearing = v.bearing !== null && Number.isFinite(v.bearing);
        const isSelected = selectedId === v.id;
        const onFocusedRoute = hasRouteFocus
            ? routeSet!.has(v.route.toUpperCase())
            : false;
        const matchesDir =
            bothDirs ||
            dirFilter === null ||
            v.directionId === null ||
            v.directionId === dirFilter;

        const isHighlighted = isSelected || (onFocusedRoute && matchesDir);
        const isDimmed = hasRouteFocus && !isHighlighted;

        features.push({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [v.lon, v.lat],
            },
            properties: {
                id: v.id,
                route: v.route,
                label: v.label ?? "",
                mode: v.mode,
                color: `#${hex}`,
                textColor: `#${normalizeHex(v.textColor, "1D1D1D")}`,
                icon: hasBearing ? `dir-${hex}` : `dot-${hex}`,
                bearing: v.bearing ?? 0,
                hasBearing: hasBearing ? 1 : 0,
                directionId: v.directionId ?? -1,
                headsign: v.headsign ?? "",
                selected: isSelected ? 1 : 0,
                highlighted: isHighlighted ? 1 : 0,
                dimmed: isDimmed ? 1 : 0,
                sortKey: isSelected ? 3 : isHighlighted ? 2 : 1,
            },
        });
    }

    return { type: "FeatureCollection", features };
}

export function buildRouteLinesGeoJSON(params: {
    primaryShape: LineString | MultiLineString | null;
    secondaryShape?: LineString | MultiLineString | null;
    color: string;
}): FeatureCollection<LineString | MultiLineString> {
    const features: Feature<LineString | MultiLineString>[] = [];
    const hex = `#${normalizeHex(params.color)}`;

    if (params.secondaryShape) {
        features.push({
            type: "Feature",
            geometry: params.secondaryShape,
            properties: {
                role: "secondary",
                color: hex,
            },
        });
    }

    if (params.primaryShape) {
        features.push({
            type: "Feature",
            geometry: params.primaryShape,
            properties: {
                role: "primary",
                color: hex,
            },
        });
    }

    return { type: "FeatureCollection", features };
}

export function buildStopsGeoJSON(params: {
    tripStops?: VehicleStopCall[];
    directionStops?: RouteDirectionInfo["stops"];
    selectedStopId?: string | null;
}): FeatureCollection<Point> {
    const features: Feature<Point>[] = [];

    if (params.tripStops && params.tripStops.length > 0) {
        for (const s of params.tripStops) {
            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [s.lon, s.lat] },
                properties: {
                    stopId: s.stopId,
                    name: s.stopName,
                    code: s.stopCode ?? "",
                    sequence: s.stopSequence,
                    status: s.status,
                    selected: params.selectedStopId === s.stopId ? 1 : 0,
                },
            });
        }
        return { type: "FeatureCollection", features };
    }

    if (params.directionStops && params.directionStops.length > 0) {
        for (const s of params.directionStops) {
            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [s.lon, s.lat] },
                properties: {
                    stopId: s.stopId,
                    name: s.name,
                    code: s.code ?? "",
                    sequence: s.sequence,
                    status: "upcoming",
                    selected: params.selectedStopId === s.stopId ? 1 : 0,
                },
            });
        }
    }

    return { type: "FeatureCollection", features };
}

export function computeGeometryBounds(
    geometries: Array<LineString | MultiLineString | null | undefined>
): [[number, number], [number, number]] | null {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    let count = 0;

    for (const geom of geometries) {
        if (!geom) continue;
        if (geom.type === "LineString") {
            for (const [lon, lat] of geom.coordinates) {
                if (lon < minLon) minLon = lon;
                if (lat < minLat) minLat = lat;
                if (lon > maxLon) maxLon = lon;
                if (lat > maxLat) maxLat = lat;
                count++;
            }
        } else if (geom.type === "MultiLineString") {
            for (const line of geom.coordinates) {
                for (const [lon, lat] of line) {
                    if (lon < minLon) minLon = lon;
                    if (lat < minLat) minLat = lat;
                    if (lon > maxLon) maxLon = lon;
                    if (lat > maxLat) maxLat = lat;
                    count++;
                }
            }
        }
    }

    if (count < 2) return null;
    return [
        [minLon, minLat],
        [maxLon, maxLat],
    ];
}

export function compassLabel(bearing: number | null): string | null {
    if (bearing === null || !Number.isFinite(bearing)) return null;
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const idx = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
    return `${dirs[idx]} ${Math.round(bearing)}°`;
}

export function formatDelay(delaySec: number | null): {
    label: string;
    tone: "ontime" | "late" | "early" | "neutral";
} {
    if (delaySec === null || !Number.isFinite(delaySec)) {
        return { label: "Scheduled", tone: "neutral" };
    }
    if (Math.abs(delaySec) < 60) {
        return { label: "On time", tone: "ontime" };
    }
    const mins = Math.round(Math.abs(delaySec) / 60);
    if (delaySec > 0) {
        return {
            label: `${mins}m late`,
            tone: mins >= 6 ? "late" : "late",
        };
    }
    return { label: `${mins}m early`, tone: "early" };
}

export function formatBytes(bytes: number): string {
    if (bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatBrisbaneTime(unixSec: number | null): string | null {
    if (!unixSec) return null;
    return new Date(unixSec * 1000).toLocaleTimeString("en-AU", {
        timeZone: "Australia/Brisbane",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

export function formatRelativeEta(
    unixSec: number | null,
    nowUnix: number
): string | null {
    if (!unixSec) return null;
    const diffSec = unixSec - nowUnix;
    if (diffSec <= -45) return "Passed";
    if (diffSec < 45) return "Due";
    const mins = Math.round(diffSec / 60);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
