import { useQuery } from "@tanstack/react-query";
import type { VehicleEntity } from "@/types";

async function fetchVehiclesData(): Promise<VehicleEntity[]> {
  const res = await fetch("/api/vehicles");
  if (!res.ok) throw new Error(`vehicles: ${res.status}`);
  const data: { vehicles?: Array<{ vehicle: string; route: string; trip: string; lat: number; lon: number; bearing: number | null }> } =
    await res.json();

  return (data.vehicles ?? []).map((v) => ({
    id: v.vehicle,
    vehicle: {
      position: {
        latitude: v.lat,
        longitude: v.lon,
        bearing: v.bearing ?? undefined,
      },
      vehicle: { id: v.vehicle, label: v.vehicle },
      trip: { route_id: v.route, trip_id: v.trip },
    },
  }));
}

export function useVehicles() {
  return useQuery<VehicleEntity[]>({
    queryKey: ["vehicles"],
    queryFn: fetchVehiclesData,
    refetchInterval: 30_000,
    staleTime: Infinity,
  });
}
