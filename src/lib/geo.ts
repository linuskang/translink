import type { Feature, FeatureCollection, Point } from "geojson";
import type { VehicleEntity } from "@/types";

export function normalizeVehicles(
  entities: VehicleEntity[],
  interpolated?: Map<string, [number, number]>
): FeatureCollection {
  const features: Feature<Point>[] = entities
    .map((entity) => {
      const pos = entity.vehicle?.position;
      if (!pos?.latitude || !pos?.longitude) return null;

      const coords: [number, number] = interpolated?.get(entity.id) ?? [
        pos.longitude,
        pos.latitude,
      ];

      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coords },
        properties: {
          id: entity.id,
          label: entity.vehicle?.vehicle?.label ?? entity.id,
          route_id: entity.vehicle?.trip?.route_id ?? "",
          trip_id: entity.vehicle?.trip?.trip_id ?? "",
          bearing: pos.bearing ?? 0,
          speed: pos.speed ?? 0,
        },
      };
    })
    .filter(Boolean) as Feature<Point>[];

  return { type: "FeatureCollection", features };
}
