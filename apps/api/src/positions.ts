import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { transit_realtime } from "gtfs-realtime-bindings";

import { getDataFile } from "./updater.js";

const require = createRequire(import.meta.url);
const gtfs =
    require("gtfs-realtime-bindings") as typeof import("gtfs-realtime-bindings");
const { FeedMessage } = gtfs.transit_realtime;

export interface VehiclePosition {
    vehicle: string | null;
    route: string | null;
    trip: string | null;
    lat: number;
    lon: number;
    bearing: number | null;
}

export async function loadFeed(
    file: string
): Promise<transit_realtime.FeedMessage> {
    const bytes = await readFile(file);
    return FeedMessage.decode(new Uint8Array(bytes));
}

export async function extractVehiclePositions(
    file: string
): Promise<VehiclePosition[]> {
    const feed = await loadFeed(file);
    const vehicles: VehiclePosition[] = [];

    for (const entity of feed.entity ?? []) {
        const v = entity.vehicle;
        if (!v) continue;

        const pos = v.position;
        const routeId = v.trip?.routeId ?? "";
        const routeShort = routeId ? routeId.split("-")[0] : null;

        vehicles.push({
            vehicle: v.vehicle?.id ?? null,
            route: routeShort,
            trip: v.trip?.tripId ?? null,
            lat: pos?.latitude ?? 0,
            lon: pos?.longitude ?? 0,
            bearing: pos?.bearing ?? null,
        });
    }

    return vehicles;
}

export async function getSeqVehiclePositions(): Promise<VehiclePosition[]> {
    const file = await getDataFile();
    return extractVehiclePositions(file);
}
