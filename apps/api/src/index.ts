import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { startBackgroundUpdates } from "./updater.js";
import { getSeqVehiclePositions } from "./positions.js";

const app = new Hono();

app.use("*", cors());

startBackgroundUpdates();

app.get("/", (c) =>
    c.json({
        service: "Transit Live API",
        description:
            "Real-time Brisbane Transit (SEQ) vehicle position tracking",
        version: "1.0.0",
        status: "operational",
        endpoints: {
            "GET /": "Service information",
            "GET /v1/seq/vehicle_positions":
                "Get all active vehicle positions for SEQ",
        },
        update_interval: "30 seconds",
        data_source:
            "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions",
    })
);

app.get("/v1/seq/vehicle_positions", async (c) =>
    c.json({ vehicles: await getSeqVehiclePositions() })
);

const port = Number(process.env.PORT ?? 8000);

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Translink API listening on http://localhost:${info.port}`);
});
