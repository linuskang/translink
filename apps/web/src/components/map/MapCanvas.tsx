"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, IControl, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";

import { useVehicles } from "@/hooks/useVehicles";
import { vehiclesToGeoJSON } from "@/lib/geo";
import type { Vehicle } from "@/types";

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

function createMapStyle(maptilerKey: string): StyleSpecification {
    return {
        version: 8,
        sources: {
            basemap: {
                type: "raster",
                tiles: [
                    `https://api.maptiler.com/maps/openstreetmap-dark/{z}/{x}/{y}@2x.png?key=${encodeURIComponent(maptilerKey)}`,
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
    const [maptilerKey, setMaptilerKey] = useState<string | null>(null);
    const [configError, setConfigError] = useState<string | null>(null);
    const vehiclesRef = useRef<Vehicle[]>([]);
    const routeRef = useRef("");
    const refreshMapRef = useRef(() => {});
    const refreshStatusRef = useRef(() => {});
    const dataUpdatedAtRef = useRef(0);
    const vehiclesErrorRef = useRef(false);
    const startPositionsRef = useRef<Map<string, Position>>(new Map());
    const targetPositionsRef = useRef<Map<string, Position>>(new Map());
    const renderedPositionsRef = useRef<Map<string, Position>>(new Map());
    const transitionStartedRef = useRef(0);
    const { data: vehicles = [], dataUpdatedAt, isError } = useVehicles();

    useEffect(() => {
        let active = true;

        fetch("/api/map-config", { cache: "no-store" })
            .then(async (response) => {
                const data: { maptilerKey?: string; error?: string } =
                    await response.json();
                if (!response.ok || !data.maptilerKey) {
                    throw new Error(
                        data.error ?? "Map configuration is unavailable"
                    );
                }
                if (active) setMaptilerKey(data.maptilerKey);
            })
            .catch((error: unknown) => {
                if (active) {
                    setConfigError(
                        error instanceof Error
                            ? error.message
                            : "Map configuration failed"
                    );
                }
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !maptilerKey) return;

        const map = new maplibregl.Map({
            container,
            style: createMapStyle(maptilerKey),
            center: SEQ_CENTER,
            zoom: 11,
            attributionControl: { compact: true },
        });
        const resizeObserver = new ResizeObserver(() => map.resize());
        let animationFrame = 0;
        let lastRender = 0;

        const status = document.createElement("div");
        status.className = "maplibregl-ctrl map-status-control";
        status.textContent = "Loading buses...";

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

        refreshStatusRef.current = () => {
            if (vehiclesErrorRef.current) {
                status.textContent = "Buses unavailable";
                return;
            }

            const updatedAt = dataUpdatedAtRef.current;
            const remaining = updatedAt
                ? Math.max(
                      0,
                      Math.ceil((30_000 - (Date.now() - updatedAt)) / 1000)
                  )
                : 0;
            status.textContent = `${vehiclesRef.current.length} buses · refresh in ${remaining}s`;
        };
        refreshStatusRef.current();
        const statusInterval = window.setInterval(
            () => refreshStatusRef.current(),
            1000
        );

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
            refreshStatusRef.current = () => {};
            window.clearInterval(statusInterval);
            map.remove();
        };
    }, [maptilerKey]);

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
        dataUpdatedAtRef.current = dataUpdatedAt;
        vehiclesErrorRef.current = isError;
        refreshMapRef.current();
        refreshStatusRef.current();
    }, [dataUpdatedAt, isError, vehicles]);

    if (configError) {
        return (
            <div className="grid h-screen place-items-center bg-black px-6 text-center">
                <p className="text-sm text-white/60">{configError}</p>
            </div>
        );
    }

    if (!maptilerKey) {
        return (
            <div className="grid h-screen place-items-center bg-black">
                <p className="text-sm text-white/40">Loading map...</p>
            </div>
        );
    }

    return (
        <main className="map-shell bg-black">
            <div id="map" ref={containerRef} className="map-container" />
        </main>
    );
}
