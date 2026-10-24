"use client";

import { useQuery } from "@tanstack/react-query";
import type {
    RouteDetail,
    RouteSummary,
    StopDetail,
    VehicleDetail,
} from "@/types";

export function useVehicleDetail(vehicleId: string | null) {
    return useQuery<VehicleDetail>({
        queryKey: ["vehicle-detail", vehicleId],
        queryFn: async () => {
            const res = await fetch(
                `/api/vehicles/${encodeURIComponent(vehicleId!)}`
            );
            if (!res.ok) {
                throw new Error(`Vehicle detail error: ${res.status}`);
            }
            return (await res.json()) as VehicleDetail;
        },
        enabled: Boolean(vehicleId),
        refetchInterval: 20_000,
        refetchIntervalInBackground: false,
        staleTime: 10_000,
    });
}

export function useRouteDetail(routeKey: string | null) {
    return useQuery<RouteDetail>({
        queryKey: ["route-detail", routeKey?.toUpperCase() ?? null],
        queryFn: async () => {
            const res = await fetch(
                `/api/routes/${encodeURIComponent(routeKey!)}`
            );
            if (!res.ok) {
                throw new Error(`Route detail error: ${res.status}`);
            }
            return (await res.json()) as RouteDetail;
        },
        enabled: Boolean(routeKey),
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        staleTime: 20_000,
    });
}

export function useStopDetail(stopId: string | null) {
    return useQuery<StopDetail>({
        queryKey: ["stop-detail", stopId],
        queryFn: async () => {
            const res = await fetch(
                `/api/stops/${encodeURIComponent(stopId!)}`
            );
            if (!res.ok) {
                throw new Error(`Stop detail error: ${res.status}`);
            }
            return (await res.json()) as StopDetail;
        },
        enabled: Boolean(stopId),
        refetchInterval: 20_000,
        refetchIntervalInBackground: false,
        staleTime: 10_000,
    });
}

export function useRouteSearch(query: string) {
    const trimmed = query.trim();
    return useQuery<RouteSummary[]>({
        queryKey: ["route-search", trimmed.toLowerCase()],
        queryFn: async () => {
            const params = new URLSearchParams({
                q: trimmed,
                limit: "12",
            });
            const res = await fetch(`/api/routes?${params.toString()}`);
            if (!res.ok) return [];
            const data = (await res.json()) as { routes?: RouteSummary[] };
            return data.routes ?? [];
        },
        enabled: trimmed.length >= 1,
        staleTime: 30_000,
    });
}
