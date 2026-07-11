"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, IControl, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";

import { useVehicles } from "@/hooks/useVehicles";
import { vehiclesToGeoJSON } from "@/lib/geo";
import type { Vehicle } from "@/types";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
const SEQ_CENTER: [number, number] = [153.0251, -27.4698];
const EMPTY_GEOJSON: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: [],
};
const POSITION_TRANSITION_MS = 5_000;

type Position = [longitude: number, latitude: number];

function lerp(start: number, end: number, progress: number) {
    return start + (end - start) * progress;
}

function createMapStyle(): StyleSpecification {
    return {
        version: 8,
        sources: {
            basemap: {
                type: "raster",
                tiles: [
                    `https://api.maptiler.com/maps/openstreetmap-dark/{z}/{x}/{y}@2x.png?key=${MAPTILER_KEY}`,
                ],
                tileSize: 512,
                attribution:
                    '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
            },
        },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
    };
}

function createControl(element: HTMLElement): IControl {
    return {
        onAdd() {
            return element;
        },
        onRemove() {
            element.remove();
        },
    };
}

export default function MapCanvas() {
    const containerRef = useRef<HTMLDivElement>(null);
    const vehiclesRef = useRef<Vehicle[]>([]);
    const routeRef = useRef("");
    const refreshMapRef = useRef(() => {});
    const statusRef = useRef<HTMLDivElement | null>(null);
    const startPositionsRef = useRef<Map<string, Position>>(new Map());
    const targetPositionsRef = useRef<Map<string, Position>>(new Map());
    const renderedPositionsRef = useRef<Map<string, Position>>(new Map());
    const transitionStartedRef = useRef(0);
    const { data: vehicles = [], dataUpdatedAt, isError } = useVehicles();

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !MAPTILER_KEY) return;

        const map = new maplibregl.Map({
            container,
            style: createMapStyle(),
            center: SEQ_CENTER,
            zoom: 11,
            attributionControl: { compact: true },
        });
        const resizeObserver = new ResizeObserver(() => map.resize());
        let animationFrame = 0;
        let lastRender = 0;

        const status = document.createElement("div");
        status.className = "maplibregl-ctrl map-status-control";
        status.textContent = "Loading vehicles...";
        statusRef.current = status;

        const search = document.createElement("input");
        search.className = "maplibregl-ctrl map-search-control";
        search.type = "search";
        search.inputMode = "numeric";
        search.placeholder = "Bus number";
        search.ariaLabel = "Search bus number";
        search.addEventListener("input", () => {
            routeRef.current = search.value.trim().toLowerCase();
            refreshMapRef.current();
        });

        map.addControl(createControl(status), "top-left");
        map.addControl(createControl(search), "top-right");
        map.addControl(
            new maplibregl.NavigationControl({ showCompass: false }),
            "bottom-right"
        );
        map.addControl(
            new maplibregl.GeolocateControl({
                positionOptions: { enableHighAccuracy: true },
                trackUserLocation: true,
            }),
            "bottom-right"
        );
        map.addControl(new maplibregl.ScaleControl(), "bottom-left");

        resizeObserver.observe(container);
        map.on("load", () => {
            map.resize();
            map.addSource("vehicles", { type: "geojson", data: EMPTY_GEOJSON });
            map.addLayer({
                id: "vehicles",
                type: "circle",
                source: "vehicles",
                paint: {
                    "circle-radius": 5,
                    "circle-color": "#bc1fe4",
                    "circle-stroke-width": 1.5,
                    "circle-stroke-color": "#fff",
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
                    "text-offset": [0, 1.25],
                    "text-anchor": "top",
                },
                paint: {
                    "text-color": "#fff",
                    "text-halo-color": "#111",
                    "text-halo-width": 1,
                },
            });

            function renderVehicles(now: number) {
                const progress = Math.min(
                    1,
                    (now - transitionStartedRef.current) /
                        POSITION_TRANSITION_MS
                );
                const rendered = new Map<string, Position>();
                const animated = vehiclesRef.current.map((vehicle) => {
                    const target = targetPositionsRef.current.get(
                        vehicle.vehicle
                    ) ?? [vehicle.lon, vehicle.lat];
                    const start =
                        startPositionsRef.current.get(vehicle.vehicle) ??
                        target;
                    const position: Position = [
                        lerp(start[0], target[0], progress),
                        lerp(start[1], target[1], progress),
                    ];
                    rendered.set(vehicle.vehicle, position);
                    return {
                        ...vehicle,
                        lon: position[0],
                        lat: position[1],
                    };
                });
                renderedPositionsRef.current = rendered;

                const query = routeRef.current;
                const filtered = query
                    ? animated.filter((vehicle) =>
                          vehicle.route.toLowerCase().includes(query)
                      )
                    : animated;

                (map.getSource("vehicles") as GeoJSONSource).setData(
                    vehiclesToGeoJSON(filtered)
                );
            }

            function animate(now: number) {
                animationFrame = requestAnimationFrame(animate);
                if (now - lastRender < 50) return;
                lastRender = now;
                renderVehicles(now);
            }

            refreshMapRef.current = () => {
                renderVehicles(performance.now());
            };
            refreshMapRef.current();
            animationFrame = requestAnimationFrame(animate);
        });
        map.on("error", (event) =>
            console.error("MapLibre error:", event.error)
        );

        return () => {
            resizeObserver.disconnect();
            cancelAnimationFrame(animationFrame);
            refreshMapRef.current = () => {};
            statusRef.current = null;
            map.remove();
        };
    }, []);

    useEffect(() => {
        const starts = new Map(renderedPositionsRef.current);
        const targets = new Map<string, Position>();
        for (const vehicle of vehicles) {
            const target: Position = [vehicle.lon, vehicle.lat];
            targets.set(vehicle.vehicle, target);
            if (!starts.has(vehicle.vehicle)) {
                starts.set(vehicle.vehicle, target);
            }
        }

        startPositionsRef.current = starts;
        targetPositionsRef.current = targets;
        transitionStartedRef.current = performance.now();
        vehiclesRef.current = vehicles;
        refreshMapRef.current();

        function updateStatus() {
            if (!statusRef.current) return;
            if (isError) {
                statusRef.current.textContent = "Vehicles unavailable";
                return;
            }

            const remaining = dataUpdatedAt
                ? Math.max(
                      0,
                      Math.ceil((30_000 - (Date.now() - dataUpdatedAt)) / 1000)
                  )
                : 0;
            statusRef.current.textContent = `${vehicles.length} vehicles · refresh in ${remaining}s`;
        }

        updateStatus();
        const interval = window.setInterval(updateStatus, 1000);
        return () => window.clearInterval(interval);
    }, [dataUpdatedAt, isError, vehicles]);

    if (!MAPTILER_KEY) {
        return (
            <div className="grid h-screen place-items-center bg-black px-6 text-center">
                <p className="text-sm text-white/60">
                    Add NEXT_PUBLIC_MAPTILER_KEY to .env.local and restart the
                    dev server.
                </p>
            </div>
        );
    }

    return (
        <main className="map-shell bg-black">
            <div id="map" ref={containerRef} className="map-container" />
        </main>
    );
}
