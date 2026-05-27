export interface BubblerWaypoint {
  id: string | number;
  name: string;
  lat: number;
  lon: number;
  type?: string;
  description?: string;
  tags?: Record<string, string>;
  [key: string]: unknown;
}

export interface VehiclePositionResponse {
  entity: VehicleEntity[];
  header?: {
    timestamp?: number;
    gtfsRealtimeVersion?: string;
  };
}

export interface VehicleEntity {
  id: string;
  vehicle: {
    position: {
      latitude: number;
      longitude: number;
      bearing?: number;
      speed?: number;
    };
    trip?: {
      tripId?: string;
      routeId?: string;
      directionId?: number;
    };
    vehicle?: {
      id?: string;
      label?: string;
    };
    currentStatus?: string;
    timestamp?: number;
  };
}
