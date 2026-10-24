import { realtimeEngine } from "./realtime.js";
import type { VehiclePosition } from "./types.js";

export type { VehiclePosition };

export async function getSeqVehiclePositions(): Promise<VehiclePosition[]> {
    return realtimeEngine.getFilteredVehicles({});
}
