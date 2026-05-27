export interface VehiclePosition {
  latitude: number;
  longitude: number;
  bearing?: number;
  speed?: number;
}

export interface VehicleEntity {
  id: string;
  vehicle?: {
    position?: VehiclePosition;
    vehicle?: { id?: string; label?: string };
    trip?: {
      route_id?: string;
      trip_id?: string;
    };
  };
}

export interface SelectedFeature {
  properties: Record<string, unknown>;
  lngLat: [number, number];
}
