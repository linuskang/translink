import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { respondCompressedJson, respondPrecompressed } from "./compression.js";
import { realtimeEngine } from "./realtime.js";
import { staticGtfs } from "./staticGtfs.js";
import { startBackgroundUpdates } from "./updater.js";

const app = new Hono();

app.use(
    "*",
    cors({
        origin: "*",
        exposeHeaders: ["ETag", "X-Raw-Bytes", "Content-Length"],
    })
);

startBackgroundUpdates();

app.get("/", (c) => {
    const summary = realtimeEngine.getStatusSummary();
    return respondCompressedJson(
        c,
        {
            service: "SEQ Transit Live API",
            description:
                "South East Queensland GTFS-Realtime & GTFS-Static transit API",
            version: "2.0.0",
            status: summary.healthy ? "operational" : "starting",
            update_interval: "30 seconds",
            endpoints: {
                "GET /": "Service metadata and live feed overview",
                "GET /v1/health":
                    "Health status, feed timestamps, entity counts, and wire payload stats",
                "GET /v1/seq/vehicle_positions":
                    "Enriched active vehicle positions (?route=&mode=&direction=&bbox=)",
                "GET /v1/seq/vehicles/sync":
                    "Low-bandwidth dictionary + delta vehicle sync (?since=<seq>&epoch=<epoch>)",
                "GET /v1/seq/vehicles/:id":
                    "Single vehicle live telemetry, trip stop predictions, route shape, and alerts",
                "GET /v1/seq/routes":
                    "Search and list SEQ transit routes (?q=&mode=&active_only=true)",
                "GET /v1/seq/routes/:routeKey":
                    "Route details, all travel directions, GeoJSON shapes, stops, active vehicles, and alerts",
                "GET /v1/seq/stops":
                    "Search stops by query or coordinates (?q=&lat=&lon=&radius=)",
                "GET /v1/seq/stops/:stopId":
                    "Stop details, child platforms, live upcoming departures, and alerts",
                "GET /v1/seq/alerts":
                    "Active Translink SEQ service alerts (?route=&stop=&mode=)",
            },
            data_sources: {
                vehicle_positions:
                    "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions",
                trip_updates:
                    "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates",
                service_alerts:
                    "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/Alerts",
                static_schedule:
                    "https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip",
            },
            summary,
        },
        { cacheControl: "public, max-age=5" }
    );
});

app.get("/v1/health", (c) => {
    const summary = realtimeEngine.getStatusSummary();
    return respondCompressedJson(c, summary, {
        cacheControl: "no-store",
    });
});

app.get("/v1/seq/vehicle_positions", (c) => {
    const route = c.req.query("route");
    const mode = c.req.query("mode");
    const direction = c.req.query("direction");
    const bbox = c.req.query("bbox");

    const hasFilters = Boolean(
        route || mode || (direction !== undefined && direction !== "") || bbox
    );

    if (!hasFilters) {
        const pre = realtimeEngine.getPrecompressedAllVehicles();
        if (pre) {
            return respondPrecompressed(
                c,
                pre,
                "public, max-age=5, stale-while-revalidate=15"
            );
        }
    }

    const vehicles = realtimeEngine.getFilteredVehicles({
        route,
        mode,
        direction,
        bbox,
    });
    const status = realtimeEngine.getStatusSummary();
    return respondCompressedJson(
        c,
        {
            seq: status.realtime.seq,
            updatedAt: status.realtime.vehiclePositionsTimestamp,
            count: vehicles.length,
            vehicles,
        },
        {
            etag: `vp-f-${status.realtime.seq}-${route ?? ""}-${mode ?? ""}-${direction ?? ""}-${bbox ?? ""}-${vehicles.length}`,
            cacheControl: "public, max-age=5, stale-while-revalidate=15",
        }
    );
});

app.get("/v1/seq/vehicles/sync", (c) => {
    const sinceParam = c.req.query("since");
    const epochParam = c.req.query("epoch");
    const since =
        sinceParam !== undefined && sinceParam !== ""
            ? Number(sinceParam)
            : undefined;

    const result = realtimeEngine.getSyncPayload({
        since,
        epoch: epochParam,
    });

    if (!result) {
        return c.json(
            {
                mode: "full",
                epoch: "init",
                seq: 0,
                serverTime: Math.floor(Date.now() / 1000),
                totalCount: 0,
                routes: [],
                headsigns: [""],
                vehicles: [],
            },
            200
        );
    }

    if (result.status === 304) {
        return new Response(null, {
            status: 304,
            headers: {
                ETag: result.etag,
                "Cache-Control": "no-cache",
                Vary: "Accept-Encoding",
            },
        });
    }

    return respondPrecompressed(c, result.payload, "no-cache");
});

app.get("/v1/seq/vehicles/:id", (c) => {
    const id = c.req.param("id");
    const detail = realtimeEngine.getVehicleDetail(id);
    if (!detail) {
        return c.json({ error: "Vehicle not found or no longer active" }, 404);
    }
    return respondCompressedJson(c, detail, {
        etag: `veh-${id}-${detail.vehicle.updatedAt}-${staticGtfs.isReady() ? 1 : 0}`,
        cacheControl: "public, max-age=5, stale-while-revalidate=10",
    });
});

app.get("/v1/seq/routes", (c) => {
    const q = c.req.query("q");
    const mode = c.req.query("mode");
    const activeOnly = c.req.query("active_only") === "true";
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 150;

    const routes = realtimeEngine.getRoutesSummary({
        q,
        mode,
        activeOnly,
        limit,
    });
    const seq = realtimeEngine.getStatusSummary().realtime.seq;
    return respondCompressedJson(
        c,
        { count: routes.length, routes },
        {
            etag: `routes-${seq}-${q ?? ""}-${mode ?? ""}-${activeOnly}-${limit}-${staticGtfs.isReady() ? 1 : 0}`,
            cacheControl: "public, max-age=15, stale-while-revalidate=30",
        }
    );
});

app.get("/v1/seq/routes/:routeKey", (c) => {
    const routeKey = c.req.param("routeKey");
    const detail = realtimeEngine.getRouteDetail(routeKey);
    if (!detail) {
        return c.json({ error: "Route not found" }, 404);
    }
    const seq = realtimeEngine.getStatusSummary().realtime.seq;
    return respondCompressedJson(c, detail, {
        etag: `route-${detail.shortName}-${seq}-${staticGtfs.isReady() ? 1 : 0}`,
        cacheControl: "public, max-age=10, stale-while-revalidate=20",
    });
});

app.get("/v1/seq/stops", (c) => {
    const q = c.req.query("q");
    const lat = c.req.query("lat") ? Number(c.req.query("lat")) : undefined;
    const lon = c.req.query("lon") ? Number(c.req.query("lon")) : undefined;
    const radiusMeters = c.req.query("radius")
        ? Number(c.req.query("radius"))
        : undefined;
    const limit = c.req.query("limit")
        ? Number(c.req.query("limit"))
        : undefined;

    const stops = staticGtfs.searchStops({
        q,
        lat,
        lon,
        radiusMeters,
        limit,
    });
    return respondCompressedJson(
        c,
        { count: stops.length, stops },
        {
            cacheControl: "public, max-age=60, stale-while-revalidate=300",
        }
    );
});

app.get("/v1/seq/stops/:stopId", (c) => {
    const stopId = c.req.param("stopId");
    const detail = realtimeEngine.getStopDetail(stopId);
    if (!detail) {
        return c.json({ error: "Stop not found" }, 404);
    }
    const seq = realtimeEngine.getStatusSummary().realtime.seq;
    return respondCompressedJson(c, detail, {
        etag: `stop-${stopId}-${seq}`,
        cacheControl: "public, max-age=10, stale-while-revalidate=20",
    });
});

app.get("/v1/seq/alerts", (c) => {
    const route = c.req.query("route");
    const stopId = c.req.query("stop");
    const mode = c.req.query("mode");
    const alerts = realtimeEngine.getAlerts({ route, stopId, mode });
    const seq = realtimeEngine.getStatusSummary().realtime.seq;
    return respondCompressedJson(
        c,
        { count: alerts.length, alerts },
        {
            etag: `alerts-${seq}-${route ?? ""}-${stopId ?? ""}-${mode ?? ""}`,
            cacheControl: "public, max-age=15, stale-while-revalidate=30",
        }
    );
});

const port = Number(process.env.PORT ?? 8000);

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`SEQ Transit API listening on http://localhost:${info.port}`);
});
