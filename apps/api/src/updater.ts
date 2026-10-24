import { setTimeout as delay } from "node:timers/promises";

import { realtimeEngine, VP_FILE } from "./realtime.js";
import { staticGtfs } from "./staticGtfs.js";

const UPDATE_INTERVAL_MS = 30_000;

export async function getDataFile(): Promise<string> {
    return VP_FILE;
}

export async function fetchAndSaveVehiclePositions(): Promise<boolean> {
    return realtimeEngine.pollAllFeeds();
}

async function startUpdateLoop(): Promise<void> {
    console.log(
        `Starting SEQ GTFS realtime updates (every ${UPDATE_INTERVAL_MS / 1000}s)...`
    );
    await realtimeEngine.rebuildFromDisk();
    await realtimeEngine.pollAllFeeds();

    for (;;) {
        await delay(UPDATE_INTERVAL_MS);
        await realtimeEngine.pollAllFeeds();
    }
}

let started = false;

export function startBackgroundUpdates(): void {
    if (started) return;
    started = true;
    void staticGtfs.initialize();
    void startUpdateLoop();
}
