"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
    SyncResponse,
    SyncRouteDictTuple,
    SyncTelemetry,
    SyncVehicleTuple,
    TransitMode,
    Vehicle,
    VehicleStopStatus,
} from "@/types";

function codeToMode(code: number): TransitMode {
    switch (code) {
        case 0:
            return "tram";
        case 1:
            return "rail";
        case 3:
            return "ferry";
        case 2:
        default:
            return "bus";
    }
}

function codeToStatus(code: number): VehicleStopStatus {
    switch (code) {
        case 0:
            return "INCOMING_AT";
        case 1:
            return "STOPPED_AT";
        default:
            return "IN_TRANSIT_TO";
    }
}

interface SyncClientState {
    epoch: string;
    seq: number;
    etag: string | null;
    routes: SyncRouteDictTuple[];
    headsigns: string[];
    tuples: Map<string, SyncVehicleTuple>;
    vehicles: Vehicle[];
    telemetry: SyncTelemetry;
}

function materializeVehicles(
    tuples: Map<string, SyncVehicleTuple>,
    routes: SyncRouteDictTuple[],
    headsigns: string[],
    seq: number
): Vehicle[] {
    const out: Vehicle[] = [];
    for (const t of tuples.values()) {
        const routeEntry = routes[t[2]];
        const shortName = routeEntry?.[0] ?? "?";
        const longName = routeEntry?.[1] || null;
        const mode = codeToMode(routeEntry?.[2] ?? 2);
        const color = routeEntry?.[3] ?? "E463A4";
        const textColor = routeEntry?.[4] ?? "1D1D1D";
        const headsign = headsigns[t[4]] || null;

        out.push({
            id: t[0],
            vehicle: t[0],
            label: t[1] || null,
            route: shortName,
            routeLongName: longName,
            mode,
            color,
            textColor,
            trip: null,
            directionId: t[3] === -1 ? null : t[3],
            headsign,
            lat: t[5] / 1e5,
            lon: t[6] / 1e5,
            bearing: t[7] === -1 ? null : t[7],
            speedKmh: t[8] === -1 ? null : t[8],
            status: codeToStatus(t[9]),
            statusCode: t[9],
            delaySec: t[10],
            updatedAt: seq - t[11],
        });
    }
    return out;
}

const INITIAL_TELEMETRY: SyncTelemetry = {
    seq: 0,
    lastSyncMode: "full",
    lastWireBytes: 0,
    lastRawBytes: 0,
    sessionWireBytes: 0,
    pollCount: 0,
};

export function useVehicles() {
    const queryClient = useQueryClient();
    const stateRef = useRef<SyncClientState>({
        epoch: "",
        seq: 0,
        etag: null,
        routes: [],
        headsigns: [""],
        tuples: new Map(),
        vehicles: [],
        telemetry: INITIAL_TELEMETRY,
    });
    const [telemetry, setTelemetry] =
        useState<SyncTelemetry>(INITIAL_TELEMETRY);

    const query = useQuery<Vehicle[]>({
        queryKey: ["vehicles-sync"],
        queryFn: async () => {
            const st = stateRef.current;

            const fetchSync = async (
                forceFull: boolean
            ): Promise<Vehicle[]> => {
                const params = new URLSearchParams();
                if (!forceFull && st.epoch && st.seq > 0) {
                    params.set("since", String(st.seq));
                    params.set("epoch", st.epoch);
                }

                const qs = params.toString();
                const url = qs
                    ? `/api/vehicles/sync?${qs}`
                    : "/api/vehicles/sync";

                const headers: Record<string, string> = {};
                if (!forceFull && st.etag) {
                    headers["If-None-Match"] = st.etag;
                }

                const res = await fetch(url, { headers, cache: "no-store" });
                if (res.status === 304) {
                    const nextTel: SyncTelemetry = {
                        ...st.telemetry,
                        lastSyncMode: "not-modified",
                        lastWireBytes: 0,
                        lastRawBytes: 0,
                        pollCount: st.telemetry.pollCount + 1,
                    };
                    st.telemetry = nextTel;
                    setTelemetry(nextTel);
                    return st.vehicles;
                }

                if (!res.ok) {
                    throw new Error(`Sync error: HTTP ${res.status}`);
                }

                const contentLength = Number(
                    res.headers.get("content-length") ?? 0
                );
                const rawBytesHeader = Number(
                    res.headers.get("x-raw-bytes") ?? 0
                );
                const etag = res.headers.get("etag");
                const payload = (await res.json()) as SyncResponse;
                const wireBytes =
                    contentLength > 0
                        ? contentLength
                        : rawBytesHeader > 0
                          ? Math.round(rawBytesHeader * 0.25)
                          : 0;

                if (payload.mode === "full") {
                    const nextTuples = new Map<string, SyncVehicleTuple>();
                    for (const t of payload.vehicles) {
                        nextTuples.set(t[0], t);
                    }
                    const materialized = materializeVehicles(
                        nextTuples,
                        payload.routes,
                        payload.headsigns,
                        payload.seq
                    );
                    const nextTel: SyncTelemetry = {
                        seq: payload.seq,
                        lastSyncMode: "full",
                        lastWireBytes: wireBytes,
                        lastRawBytes: rawBytesHeader,
                        sessionWireBytes:
                            st.telemetry.sessionWireBytes + wireBytes,
                        pollCount: st.telemetry.pollCount + 1,
                    };

                    st.epoch = payload.epoch;
                    st.seq = payload.seq;
                    st.etag = etag;
                    st.routes = payload.routes;
                    st.headsigns = payload.headsigns;
                    st.tuples = nextTuples;
                    st.vehicles = materialized;
                    st.telemetry = nextTel;
                    setTelemetry(nextTel);
                    return materialized;
                }

                // Delta mode
                if (payload.epoch !== st.epoch || payload.baseSeq !== st.seq) {
                    return fetchSync(true);
                }

                if (payload.routesAdded.length > 0) {
                    const nextRoutes = st.routes.slice(0, payload.routesOffset);
                    nextRoutes.push(...payload.routesAdded);
                    st.routes = nextRoutes;
                }
                if (payload.headsignsAdded.length > 0) {
                    const nextHeadsigns = st.headsigns.slice(
                        0,
                        payload.headsignsOffset
                    );
                    nextHeadsigns.push(...payload.headsignsAdded);
                    st.headsigns = nextHeadsigns;
                }

                const nextTuples = new Map(st.tuples);
                for (const id of payload.removed) {
                    nextTuples.delete(id);
                }
                for (const t of payload.added) {
                    nextTuples.set(t[0], t);
                }
                for (const t of payload.updated) {
                    nextTuples.set(t[0], t);
                }
                for (const m of payload.moved) {
                    const prev = nextTuples.get(m[0]);
                    if (!prev) continue;
                    nextTuples.set(m[0], [
                        prev[0],
                        prev[1],
                        prev[2],
                        prev[3],
                        prev[4],
                        prev[5] + m[1],
                        prev[6] + m[2],
                        m[3],
                        m[4],
                        m[5],
                        m[6],
                        m[7],
                    ]);
                }

                // Invariant check: guarantee 100% of active vehicles match server count
                if (nextTuples.size !== payload.totalCount) {
                    return fetchSync(true);
                }

                const materialized = materializeVehicles(
                    nextTuples,
                    st.routes,
                    st.headsigns,
                    payload.seq
                );
                const nextTel: SyncTelemetry = {
                    seq: payload.seq,
                    lastSyncMode: "delta",
                    lastWireBytes: wireBytes,
                    lastRawBytes: rawBytesHeader,
                    sessionWireBytes: st.telemetry.sessionWireBytes + wireBytes,
                    pollCount: st.telemetry.pollCount + 1,
                };

                st.seq = payload.seq;
                st.etag = etag;
                st.tuples = nextTuples;
                st.vehicles = materialized;
                st.telemetry = nextTel;
                setTelemetry(nextTel);
                return materialized;
            };

            return fetchSync(false);
        },
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        staleTime: 25_000,
    });

    // Immediately sync when user unlocks phone / returns to app tab
    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === "visible") {
                void queryClient.invalidateQueries({
                    queryKey: ["vehicles-sync"],
                });
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () =>
            document.removeEventListener("visibilitychange", onVisibility);
    }, [queryClient]);

    return {
        ...query,
        telemetry,
    };
}
