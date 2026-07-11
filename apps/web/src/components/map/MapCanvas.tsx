"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { Search, X } from "lucide-react";

import { useVehicles } from "@/hooks/useVehicles";
import { vehiclesToGeoJSON } from "@/lib/geo";
import { InfoPanel } from "./InfoPanel";
import type { SelectedVehicle } from "@/types";

setWorkerUrl("/maplibre-gl-csp-worker.js");

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
const STYLE_URL = `https://api.maptiler.com/maps/openstreetmap-dark/style.json?key=${MAPTILER_KEY}`;
const SEQ_CENTER: [number, number] = [153.0251, -27.4698];
const EMPTY_FC: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: [],
};
const ANIMATION_MS = 30_000;

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

// Check if the inline style from NEXT_PUBLIC_MAPTILER_KEY was already set
// So instead, we handle errors gracefully

type VehiclePos = { lng: number; lat: number };

export default function MapCanvas() {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState<string | null>(null);

    const prevPos = useRef<Map<string, VehiclePos>>(new Map());
    const currPos = useRef<Map<string, VehiclePos>>(new Map());
    const vehiclesRef = useRef<
        {
            vehicle: string;
            lat: number;
            lon: number;
            route: string;
            trip: string;
            bearing: number | null;
        }[]
    >([]);
    const lastFetch = useRef(0);
    const rafId = useRef(0);

    const [selected, setSelected] = useState<SelectedVehicle | null>(null);
    const [search, setSearch] = useState("");
    const searchRef = useRef("");

    const { data: vehicles } = useVehicles();

    useEffect(() => {
        if (!containerRef.current) return;
        let mounted = true;
        const container = containerRef.current;

        fetch(STYLE_URL)
            .then(async (r) => {
                if (!r.ok) {
                    const text = await r.text();
                    throw new Error(
                        text || `Style request failed: ${r.status}`
                    );
                }
                return r.json();
            })
            .then((style: StyleSpecification) => {
                if (!mounted || !container.isConnected) return;
                if (!style.projection) style.projection = { type: "mercator" };

                const map = new maplibregl.Map({
                    container,
                    style,
                    center: SEQ_CENTER,
                    zoom: 11,
                    attributionControl: { compact: true },
                });

                mapRef.current = map;

                map.on("load", () => {
                    if (!mounted) return;

                    map.addSource("vehicles", {
                        type: "geojson",
                        data: EMPTY_FC,
                    });

                    map.addLayer({
                        id: "vehicles",
                        type: "circle",
                        source: "vehicles",
                        paint: {
                            "circle-radius": 6,
                            "circle-color": "#f97316",
                            "circle-stroke-width": 1.5,
                            "circle-stroke-color": "#ffffff",
                            "circle-opacity": 0.9,
                        },
                    });

                    map.addLayer({
                        id: "vehicle-labels",
                        type: "symbol",
                        source: "vehicles",
                        layout: {
                            "text-field": ["get", "route"],
                            "text-size": 10,
                            "text-offset": [0, 1.4],
                            "text-anchor": "top",
                        },
                        paint: {
                            "text-color": "#ffffff",
                            "text-halo-color": "#000000",
                            "text-halo-width": 1,
                        },
                    });

                    map.on("click", "vehicles", (e) => {
                        const f = e.features?.[0];
                        if (!f) return;
                        const p = f.properties as Record<string, unknown>;
                        setSelected({
                            route: String(p.route ?? ""),
                            trip: String(p.trip ?? ""),
                            vehicle: String(p.vehicle ?? ""),
                            bearing: Number(p.bearing ?? 0),
                            lngLat: [e.lngLat.lng, e.lngLat.lat],
                        });
                    });

                    map.on("mouseenter", "vehicles", () => {
                        map.getCanvas().style.cursor = "pointer";
                    });
                    map.on("mouseleave", "vehicles", () => {
                        map.getCanvas().style.cursor = "";
                    });

                    setMapReady(true);
                });
            })
            .catch((e) => {
                console.error("Map style fetch failed:", e);
                setMapError(
                    MAPTILER_KEY
                        ? "Failed to load map tiles. Check your MapTiler key."
                        : "NEXT_PUBLIC_MAPTILER_KEY is not set. Add it to .env.local."
                );
            });

        return () => {
            mounted = false;
            cancelAnimationFrame(rafId.current);
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
            setMapReady(false);
        };
    }, []);

    useEffect(() => {
        searchRef.current = search;
    }, [search]);

    useEffect(() => {
        if (!vehicles) return;
        vehiclesRef.current = vehicles;

        prevPos.current = new Map(currPos.current);
        currPos.current.clear();

        for (const v of vehicles) {
            if (!v.lat || !v.lon) continue;
            currPos.current.set(v.vehicle, { lng: v.lon, lat: v.lat });
        }

        lastFetch.current = Date.now();
    }, [vehicles]);

    useEffect(() => {
        if (!mapReady) return;

        function tick() {
            rafId.current = requestAnimationFrame(tick);

            const map = mapRef.current;
            if (!map || !vehiclesRef.current.length) return;

            const t = Math.min(
                1,
                (Date.now() - lastFetch.current) / ANIMATION_MS
            );
            const interpolated = new Map<string, [number, number]>();

            currPos.current.forEach((curr, id) => {
                const prev = prevPos.current.get(id);
                if (prev) {
                    interpolated.set(id, [
                        lerp(prev.lng, curr.lng, t),
                        lerp(prev.lat, curr.lat, t),
                    ]);
                } else {
                    interpolated.set(id, [curr.lng, curr.lat]);
                }
            });

            const fc = vehiclesToGeoJSON(vehiclesRef.current, interpolated);

            const q = searchRef.current.trim().toLowerCase();
            if (q) {
                fc.features = fc.features.filter(
                    (f) =>
                        f.properties?.vehicle?.toLowerCase().includes(q) ||
                        f.properties?.route?.toLowerCase().includes(q)
                );
            }

            (map.getSource("vehicles") as GeoJSONSource | undefined)?.setData(
                fc
            );
        }

        rafId.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId.current);
    }, [mapReady]);

    if (mapError) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-black px-8 text-center">
                <div className="max-w-md space-y-2">
                    <p className="text-lg font-medium text-white">
                        Map failed to load
                    </p>
                    <p className="text-sm text-white/50">{mapError}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-black">
            <div ref={containerRef} className="absolute inset-0" />

            {vehicles && (
                <div className="pointer-events-none absolute top-4 left-4 z-20">
                    <span className="rounded-md bg-black/60 px-2.5 py-1 text-xs font-medium text-white/70 backdrop-blur-md">
                        {vehicles.length} vehicles
                    </span>
                </div>
            )}

            <div className="absolute top-4 right-4 z-20 w-56">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 size-4 text-white/30" />
                    <input
                        type="text"
                        placeholder="Search route or vehicle..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-black/60 py-2 pl-9 pr-8 text-sm text-white placeholder-white/30 backdrop-blur-md outline-none focus:border-white/25"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch("")}
                            className="absolute right-2.5 top-2.5 text-white/30 hover:text-white/60"
                        >
                            <X className="size-4" />
                        </button>
                    )}
                </div>
            </div>

            <InfoPanel vehicle={selected} onClose={() => setSelected(null)} />
        </div>
    );
}
