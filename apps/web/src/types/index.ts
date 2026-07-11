export interface Vehicle {
    vehicle: string;
    route: string;
    trip: string;
    lat: number;
    lon: number;
    bearing: number | null;
}

export interface SelectedVehicle {
    route: string;
    trip: string;
    vehicle: string;
    bearing: number;
    lngLat: [number, number];
}
