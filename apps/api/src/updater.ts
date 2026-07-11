import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const TRANSLINK_API_URL =
    "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions";
const UPDATE_INTERVAL_MS = 30_000;

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "SEQ_VehiclePositions.pb");

export async function getDataFile(): Promise<string> {
    await mkdir(DATA_DIR, { recursive: true });
    return DATA_FILE;
}

export async function fetchAndSaveVehiclePositions(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(TRANSLINK_API_URL, {
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            console.error(`✗ API returned status ${res.status}`);
            return false;
        }

        const buf = new Uint8Array(await res.arrayBuffer());
        const file = await getDataFile();
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, buf);

        console.log(`✓ Updated vehicle positions (${buf.byteLength} bytes)`);
        return true;
    } catch (err) {
        console.error("✗ Error fetching vehicle positions:", err);
        return false;
    }
}

async function startUpdateLoop(): Promise<void> {
    console.log(
        `Starting vehicle position updates (every ${UPDATE_INTERVAL_MS / 1000}s)...`
    );
    await fetchAndSaveVehiclePositions();
    for (;;) {
        await delay(UPDATE_INTERVAL_MS);
        await fetchAndSaveVehiclePositions();
    }
}

let started = false;

export function startBackgroundUpdates(): void {
    if (started) return;
    started = true;
    void startUpdateLoop();
    console.log("Background update loop started");
}
