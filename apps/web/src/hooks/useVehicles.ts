"use client";

import { useQuery } from "@tanstack/react-query";
import type { Vehicle } from "@/types";

async function fetchVehicles(): Promise<Vehicle[]> {
    const res = await fetch("/api/vehicles");
    if (!res.ok) throw new Error(`vehicles: ${res.status}`);
    const data: { vehicles?: Vehicle[] } = await res.json();
    return data.vehicles ?? [];
}

export function useVehicles() {
    return useQuery<Vehicle[]>({
        queryKey: ["vehicles"],
        queryFn: fetchVehicles,
        refetchInterval: 30_000,
        staleTime: Infinity,
    });
}
