import type { Feature, FeatureCollection, Point } from "geojson";
import type { Vehicle } from "@/types";

export function vehiclesToGeoJSON(
    vehicles: Vehicle[],
    interpolated?: Map<string, [number, number]>
): FeatureCollection<Point> {
    const features: Feature<Point>[] = vehicles
        .filter((v) => v.lat && v.lon)
        .map((v) => ({
            type: "Feature" as const,
            geometry: {
                type: "Point" as const,
                coordinates: interpolated?.get(v.vehicle) ?? [v.lon, v.lat],
            },
            properties: {
                id: v.vehicle,
                route: v.route,
                trip: v.trip,
                vehicle: v.vehicle,
                bearing: v.bearing ?? 0,
            },
        }));

    return { type: "FeatureCollection", features };
}
