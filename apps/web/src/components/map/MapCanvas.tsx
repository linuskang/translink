"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
    GeoJSONSource,
    MapGeoJSONFeature,
    StyleSpecification,
} from "maplibre-gl";
import type {
    FeatureCollection,
    LineString,
    MultiLineString,
    Point,
} from "geojson";

import {
    InspectorSheet,
    type SheetSnap,
} from "@/components/inspector/InspectorSheet";
import { TopControlBar } from "@/components/map/TopControlBar";
import {
    useRouteDetail,
    useStopDetail,
    useVehicleDetail,
} from "@/hooks/useTransitDetails";
import { useVehicles } from "@/hooks/useVehicles";
import {
    buildRouteLinesGeoJSON,
    buildStopsGeoJSON,
    computeGeometryBounds,
    vehiclesToGeoJSON,
} from "@/lib/geo";
import type { TransitMode, Vehicle } from "@/types";

const SEQ_CENTER: [number, number] = [153.0251, -27.4698];
const POSITION_TRANSITION_MS = 4_500;

const EMPTY_POINTS: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: [],
};
const EMPTY_LINES: FeatureCollection<LineString | MultiLineString> = {
    type: "FeatureCollection",
    features: [],
};

type Position = [longitude: number, latitude: number];

interface MapConfigResponse {
    provider?: string;
    tileUrl?: string;
    tileSize?: number;
    attribution?: string;
    error?: string;
}

function lerp(start: number, end: number, progress: number) {
    return start + (end - start) * progress;
}

function createMapStyle(
    config: Required<
        Pick<MapConfigResponse, "tileUrl" | "tileSize" | "attribution">
    >
): StyleSpecification {
    return {
        version: 8,
        sources: {
            basemap: {
                type: "raster",
                tiles: [config.tileUrl],
                tileSize: config.tileSize,
                attribution: config.attribution,
            },
        },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
    };
}

function buildVehicleMarkerImageData(
    hexColor: string,
    directional: boolean
): ImageData {
    const size = 48;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const cx = size / 2;
    const cy = size / 2 + (directional ? 2 : 0);
    const radius = 11.5;

    ctx.clearRect(0, 0, size, size);

    if (directional) {
        // Outer dark casing for directional nose + body
        ctx.fillStyle = "#09090b";
        ctx.beginPath();
        ctx.moveTo(cx, 3.5);
        ctx.lineTo(cx + 9.5, cy - 5);
        ctx.lineTo(cx - 9.5, cy - 5);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, radius + 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Crisp white directional pointer + border
        ctx.fillStyle = "#f4f4f5";
        ctx.beginPath();
        ctx.moveTo(cx, 6);
        ctx.lineTo(cx + 7.8, cy - 5);
        ctx.lineTo(cx - 7.8, cy - 5);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, radius + 1.2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillStyle = "#09090b";
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#f4f4f5";
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 1.2, 0, Math.PI * 2);
        ctx.fill();
    }

    // Inner Translink route fill
    ctx.fillStyle = `#${hexColor}`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1.4, 0, Math.PI * 2);
    ctx.fill();

    return ctx.getImageData(0, 0, size, size);
}

function buildRouteChevronImageData(): ImageData {
    const size = 28;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.strokeStyle = "#09090b";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(10, 7);
    ctx.lineTo(18, 14);
    ctx.lineTo(10, 21);
    ctx.stroke();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(10, 7);
    ctx.lineTo(18, 14);
    ctx.lineTo(10, 21);
    ctx.stroke();

    return ctx.getImageData(0, 0, size, size);
}

export default function MapCanvas() {
    const queryClient = useQueryClient();
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const mapLoadedRef = useRef(false);

    const [mapConfig, setMapConfig] = useState<Required<
        Pick<MapConfigResponse, "tileUrl" | "tileSize" | "attribution">
    > | null>(null);
    const [configError, setConfigError] = useState<string | null>(null);

    const [modeFilter, setModeFilter] = useState<TransitMode | "all">("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
        null
    );
    const [selectedRouteKey, setSelectedRouteKey] = useState<string | null>(
        null
    );
    const [activeDirectionId, setActiveDirectionId] = useState<number | null>(
        null
    );
    const [showBothDirections, setShowBothDirections] = useState(false);
    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
    const [followingVehicle, setFollowingVehicle] = useState(false);
    const [sheetSnap, setSheetSnap] = useState<SheetSnap>("peek");
    const [nowMs, setNowMs] = useState(() => Date.now());

    const {
        data: vehicles = [],
        dataUpdatedAt,
        isError,
        isFetching,
        telemetry,
    } = useVehicles();

    const selectedVehicleFromList = useMemo(
        () =>
            selectedVehicleId
                ? (vehicles.find((v) => v.id === selectedVehicleId) ?? null)
                : null,
        [selectedVehicleId, vehicles]
    );

    const effectiveRouteKey =
        selectedRouteKey ?? selectedVehicleFromList?.route ?? null;

    const { data: vehicleDetail, isLoading: isLoadingVehicle } =
        useVehicleDetail(selectedVehicleId);
    const { data: routeDetail, isLoading: isLoadingRoute } =
        useRouteDetail(effectiveRouteKey);
    const { data: stopDetail, isLoading: isLoadingStop } =
        useStopDetail(selectedStopId);

    // Refs for smooth WebGL animation without recreating map instance
    const vehiclesRef = useRef<Vehicle[]>([]);
    const filterStateRef = useRef({
        modeFilter: "all" as TransitMode | "all",
        searchQuery: "",
        selectedVehicleId: null as string | null,
        highlightedRoutes: null as Set<string> | null,
        highlightedDirectionId: null as number | null,
        showBothDirections: false,
    });
    const startPositionsRef = useRef<Map<string, Position>>(new Map());
    const targetPositionsRef = useRef<Map<string, Position>>(new Map());
    const renderedPositionsRef = useRef<Map<string, Position>>(new Map());
    const transitionStartedRef = useRef(0);
    const triggerRenderRef = useRef<() => void>(() => {});

    // 1s ticker for countdown & relative ETAs
    useEffect(() => {
        const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    // Fetch map tile config
    useEffect(() => {
        let active = true;
        fetch("/api/map-config", { cache: "no-store" })
            .then(async (response) => {
                const data = (await response.json()) as MapConfigResponse;
                if (!response.ok || !data.tileUrl) {
                    throw new Error(
                        data.error ?? "Map configuration is unavailable"
                    );
                }
                if (active) {
                    setMapConfig({
                        tileUrl: data.tileUrl,
                        tileSize: data.tileSize ?? 512,
                        attribution: data.attribution ?? "",
                    });
                }
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

    // Highlighted route set (includes paired QR rail reverse code e.g. BNFG <-> FGBN)
    const highlightedRoutes = useMemo(() => {
        if (!effectiveRouteKey) return null;
        const set = new Set<string>([effectiveRouteKey.toUpperCase()]);
        if (routeDetail?.shortName) {
            set.add(routeDetail.shortName.toUpperCase());
        }
        if (routeDetail?.pairedShortName) {
            set.add(routeDetail.pairedShortName.toUpperCase());
        }
        return set;
    }, [effectiveRouteKey, routeDetail]);

    const effectiveDirectionId =
        activeDirectionId ??
        vehicleDetail?.vehicle.directionId ??
        selectedVehicleFromList?.directionId ??
        routeDetail?.directions[0]?.directionId ??
        null;

    // Keep filter ref synchronized and re-render map immediately when filters/selection change
    useEffect(() => {
        filterStateRef.current = {
            modeFilter,
            searchQuery,
            selectedVehicleId,
            highlightedRoutes,
            highlightedDirectionId: effectiveDirectionId,
            showBothDirections,
        };
        triggerRenderRef.current();
    }, [
        modeFilter,
        searchQuery,
        selectedVehicleId,
        highlightedRoutes,
        effectiveDirectionId,
        showBothDirections,
    ]);

    // Initialize MapLibre GL map
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !mapConfig) return;

        const map = new maplibregl.Map({
            container,
            style: createMapStyle(mapConfig),
            center: SEQ_CENTER,
            zoom: 11.5,
            attributionControl: { compact: true },
        });
        mapRef.current = map;

        const resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(container);

        let animFrame = 0;
        let lastFrameMs = 0;

        map.addControl(
            new maplibregl.NavigationControl({ showCompass: true }),
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

        map.on("dragstart", () => {
            setFollowingVehicle(false);
        });

        map.on("styleimagemissing", (e) => {
            const id = e.id;
            if (map.hasImage(id)) return;
            if (id === "route-chevron") {
                map.addImage(id, buildRouteChevronImageData(), {
                    pixelRatio: 2,
                });
                return;
            }
            if (id.startsWith("dir-") || id.startsWith("dot-")) {
                const directional = id.startsWith("dir-");
                const hex = id.slice(4);
                if (/^[0-9A-F]{6}$/i.test(hex)) {
                    map.addImage(
                        id,
                        buildVehicleMarkerImageData(hex, directional),
                        { pixelRatio: 2 }
                    );
                }
            }
        });

        function renderVehiclesFrame(now: number) {
            if (!mapLoadedRef.current) return;
            const src = map.getSource("vehicles") as GeoJSONSource | undefined;
            if (!src) return;

            const elapsed = now - transitionStartedRef.current;
            const progress = Math.min(
                1,
                Math.max(0, elapsed / POSITION_TRANSITION_MS)
            );

            const rendered = new Map<string, Position>();
            const currentList = vehiclesRef.current;
            const {
                modeFilter: mFilter,
                searchQuery: sQuery,
                selectedVehicleId: selId,
                highlightedRoutes: hiRoutes,
                highlightedDirectionId: hiDir,
                showBothDirections: bothDirs,
            } = filterStateRef.current;

            const q = sQuery.trim().toLowerCase().replace(/^#/, "");
            const animated: Vehicle[] = [];

            for (const vehicle of currentList) {
                const target = targetPositionsRef.current.get(vehicle.id) ?? [
                    vehicle.lon,
                    vehicle.lat,
                ];
                const start =
                    startPositionsRef.current.get(vehicle.id) ?? target;
                const pos: Position = [
                    lerp(start[0], target[0], progress),
                    lerp(start[1], target[1], progress),
                ];
                rendered.set(vehicle.id, pos);

                if (mFilter !== "all" && vehicle.mode !== mFilter) {
                    continue;
                }
                if (q) {
                    const match =
                        vehicle.route.toLowerCase().includes(q) ||
                        vehicle.headsign?.toLowerCase().includes(q) ||
                        vehicle.routeLongName?.toLowerCase().includes(q) ||
                        vehicle.label?.toLowerCase().includes(q);
                    if (!match && vehicle.id !== selId) {
                        continue;
                    }
                }

                animated.push({
                    ...vehicle,
                    lon: pos[0],
                    lat: pos[1],
                });
            }

            renderedPositionsRef.current = rendered;
            src.setData(
                vehiclesToGeoJSON(animated, {
                    selectedVehicleId: selId,
                    highlightedRoutes: hiRoutes,
                    highlightedDirectionId: hiDir,
                    showBothDirections: bothDirs,
                })
            );
        }

        function stepAnimation(now: number) {
            if (now - lastFrameMs >= 50) {
                lastFrameMs = now;
                renderVehiclesFrame(now);
            }
            if (
                now - transitionStartedRef.current <
                POSITION_TRANSITION_MS + 80
            ) {
                animFrame = requestAnimationFrame(stepAnimation);
            } else {
                animFrame = 0;
            }
        }

        triggerRenderRef.current = () => {
            cancelAnimationFrame(animFrame);
            renderVehiclesFrame(performance.now());
            if (
                performance.now() - transitionStartedRef.current <
                POSITION_TRANSITION_MS
            ) {
                animFrame = requestAnimationFrame(stepAnimation);
            }
        };

        map.on("load", () => {
            mapLoadedRef.current = true;
            map.resize();

            if (!map.hasImage("route-chevron")) {
                map.addImage("route-chevron", buildRouteChevronImageData(), {
                    pixelRatio: 2,
                });
            }

            map.addSource("route-lines", {
                type: "geojson",
                data: EMPTY_LINES,
            });
            map.addSource("route-stops", {
                type: "geojson",
                data: EMPTY_POINTS,
            });
            map.addSource("vehicles", {
                type: "geojson",
                data: EMPTY_POINTS,
            });

            // Secondary / opposite direction route line (dashed)
            map.addLayer({
                id: "route-secondary-casing",
                type: "line",
                source: "route-lines",
                filter: ["==", ["get", "role"], "secondary"],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": "#09090b",
                    "line-width": 5,
                    "line-opacity": 0.65,
                },
            });
            map.addLayer({
                id: "route-secondary-line",
                type: "line",
                source: "route-lines",
                filter: ["==", ["get", "role"], "secondary"],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": "#a1a1aa",
                    "line-width": 2.5,
                    "line-dasharray": [2.2, 2.2],
                    "line-opacity": 0.75,
                },
            });

            // Primary selected direction route line + casing + directional chevrons
            map.addLayer({
                id: "route-primary-casing",
                type: "line",
                source: "route-lines",
                filter: ["==", ["get", "role"], "primary"],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": "#09090b",
                    "line-width": 6.5,
                    "line-opacity": 0.92,
                },
            });
            map.addLayer({
                id: "route-primary-line",
                type: "line",
                source: "route-lines",
                filter: ["==", ["get", "role"], "primary"],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": ["get", "color"],
                    "line-width": 3.75,
                    "line-opacity": 0.96,
                },
            });
            map.addLayer({
                id: "route-primary-arrows",
                type: "symbol",
                source: "route-lines",
                filter: ["==", ["get", "role"], "primary"],
                minzoom: 11,
                layout: {
                    "symbol-placement": "line",
                    "symbol-spacing": 110,
                    "icon-image": "route-chevron",
                    "icon-size": 0.85,
                    "icon-allow-overlap": true,
                    "icon-rotation-alignment": "map",
                },
            });

            // Stops along selected route / trip
            map.addLayer({
                id: "route-stops-layer",
                type: "circle",
                source: "route-stops",
                minzoom: 10.5,
                paint: {
                    "circle-radius": [
                        "case",
                        ["==", ["get", "selected"], 1],
                        6.5,
                        ["==", ["get", "status"], "current"],
                        5.5,
                        3.6,
                    ],
                    "circle-color": [
                        "case",
                        ["==", ["get", "selected"], 1],
                        "#ffffff",
                        ["==", ["get", "status"], "current"],
                        "#ffffff",
                        ["==", ["get", "status"], "passed"],
                        "#27272a",
                        "#18181b",
                    ],
                    "circle-stroke-width": [
                        "case",
                        ["==", ["get", "selected"], 1],
                        2.5,
                        ["==", ["get", "status"], "current"],
                        2,
                        1.5,
                    ],
                    "circle-stroke-color": [
                        "case",
                        ["==", ["get", "status"], "passed"],
                        "#52525b",
                        "#f4f4f5",
                    ],
                },
            });

            // Flat crisp selection ring around active vehicle
            map.addLayer({
                id: "vehicle-selected-ring",
                type: "circle",
                source: "vehicles",
                filter: ["==", ["get", "selected"], 1],
                paint: {
                    "circle-radius": 14,
                    "circle-color": "rgba(255, 255, 255, 0.12)",
                    "circle-stroke-width": 2,
                    "circle-stroke-color": "#ffffff",
                },
            });

            // Directional vehicle markers
            map.addLayer({
                id: "vehicles-layer",
                type: "symbol",
                source: "vehicles",
                layout: {
                    "icon-image": ["get", "icon"],
                    "icon-size": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        8,
                        0.52,
                        11,
                        0.72,
                        14,
                        0.92,
                    ],
                    "icon-rotate": ["get", "bearing"],
                    "icon-rotation-alignment": "map",
                    "icon-pitch-alignment": "map",
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                    "symbol-sort-key": ["get", "sortKey"],
                },
                paint: {
                    "icon-opacity": [
                        "case",
                        ["==", ["get", "dimmed"], 1],
                        0.26,
                        0.96,
                    ],
                },
            });

            // Route number labels beneath vehicles
            map.addLayer({
                id: "vehicle-labels",
                type: "symbol",
                source: "vehicles",
                minzoom: 11.2,
                layout: {
                    "text-field": ["get", "route"],
                    "text-size": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        11,
                        9.5,
                        14,
                        11,
                    ],
                    "text-offset": [0, 1.15],
                    "text-anchor": "top",
                    "text-optional": true,
                    "symbol-sort-key": ["get", "sortKey"],
                },
                paint: {
                    "text-color": "#f4f4f5",
                    "text-halo-color": "#09090b",
                    "text-halo-width": 1.25,
                    "text-opacity": [
                        "case",
                        ["==", ["get", "dimmed"], 1],
                        0.22,
                        0.95,
                    ],
                },
            });

            // Unified click handler with generous mobile touch hit-box
            map.on("click", (e) => {
                const pad = 9;
                const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
                    [e.point.x - pad, e.point.y - pad],
                    [e.point.x + pad, e.point.y + pad],
                ];

                const vehicleHits = map.queryRenderedFeatures(bbox, {
                    layers: ["vehicles-layer"],
                });
                if (vehicleHits.length > 0) {
                    const topHit: MapGeoJSONFeature = vehicleHits[0];
                    const clickedId = String(topHit.properties?.id ?? "");
                    const clickedRoute = String(topHit.properties?.route ?? "");
                    const dirProp = Number(topHit.properties?.directionId);
                    if (clickedId) {
                        setSelectedStopId(null);
                        setSelectedVehicleId(clickedId);
                        if (clickedRoute) setSelectedRouteKey(clickedRoute);
                        setActiveDirectionId(
                            dirProp === 0 || dirProp === 1 ? dirProp : null
                        );
                        setShowBothDirections(false);
                        setSheetSnap("peek");
                    }
                    return;
                }

                const stopHits = map.queryRenderedFeatures(bbox, {
                    layers: ["route-stops-layer"],
                });
                if (stopHits.length > 0) {
                    const stopId = String(stopHits[0].properties?.stopId ?? "");
                    if (stopId) {
                        setSelectedStopId(stopId);
                        setSheetSnap("half");
                    }
                    return;
                }

                // Clicked empty map space
                setFollowingVehicle(false);
                setSelectedStopId((prevStop) => {
                    if (prevStop) return null;
                    setSelectedVehicleId(null);
                    setSelectedRouteKey(null);
                    setActiveDirectionId(null);
                    setShowBothDirections(false);
                    return null;
                });
            });

            const interactiveLayers = ["vehicles-layer", "route-stops-layer"];
            for (const layerId of interactiveLayers) {
                map.on("mouseenter", layerId, () => {
                    map.getCanvas().style.cursor = "pointer";
                });
                map.on("mouseleave", layerId, () => {
                    map.getCanvas().style.cursor = "";
                });
            }

            triggerRenderRef.current();
        });

        map.on("error", (event) => {
            console.error("MapLibre error:", event.error);
        });

        return () => {
            mapLoadedRef.current = false;
            mapRef.current = null;
            resizeObserver.disconnect();
            cancelAnimationFrame(animFrame);
            triggerRenderRef.current = () => {};
            map.remove();
        };
    }, [mapConfig]);

    // Update vehicle interpolation targets whenever sync completes
    useEffect(() => {
        const starts = new Map(renderedPositionsRef.current);
        const targets = new Map<string, Position>();
        for (const v of vehicles) {
            const target: Position = [v.lon, v.lat];
            targets.set(v.id, target);
            if (!starts.has(v.id)) {
                starts.set(v.id, target);
            }
        }
        startPositionsRef.current = starts;
        targetPositionsRef.current = targets;
        transitionStartedRef.current = performance.now();
        vehiclesRef.current = vehicles;
        triggerRenderRef.current();
    }, [dataUpdatedAt, vehicles]);

    // Follow selected vehicle when enabled
    useEffect(() => {
        if (!followingVehicle || !selectedVehicleFromList || !mapRef.current) {
            return;
        }
        mapRef.current.easeTo({
            center: [selectedVehicleFromList.lon, selectedVehicleFromList.lat],
            duration: 900,
        });
    }, [
        followingVehicle,
        selectedVehicleFromList,
        selectedVehicleFromList?.lat,
        selectedVehicleFromList?.lon,
    ]);

    // Update route polyline + stops GeoJSON sources whenever vehicleDetail or routeDetail changes
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapLoadedRef.current) return;

        const linesSource = map.getSource("route-lines") as
            GeoJSONSource | undefined;
        const stopsSource = map.getSource("route-stops") as
            GeoJSONSource | undefined;
        if (!linesSource || !stopsSource) return;

        if (!effectiveRouteKey && !selectedVehicleId) {
            linesSource.setData(EMPTY_LINES);
            stopsSource.setData(EMPTY_POINTS);
            return;
        }

        const dirs = routeDetail?.directions ?? [];
        const chosenDir =
            dirs.find((d) => d.directionId === effectiveDirectionId) ??
            dirs[0] ??
            null;
        const oppositeDir =
            dirs.find((d) => d.directionId !== chosenDir?.directionId) ?? null;

        // If user specifically switched to the opposite direction than the selected vehicle's trip,
        // show chosenDir.shape as primary; otherwise prefer exact trip shape from vehicleDetail.
        const viewingVehiclesOwnDirection =
            !selectedVehicleId ||
            activeDirectionId === null ||
            activeDirectionId ===
                (vehicleDetail?.vehicle.directionId ??
                    selectedVehicleFromList?.directionId);

        const primaryShape =
            (viewingVehiclesOwnDirection ? vehicleDetail?.shape : null) ??
            chosenDir?.shape ??
            vehicleDetail?.shape ??
            null;

        const secondaryShape = showBothDirections
            ? (oppositeDir?.shape ?? null)
            : null;

        const color =
            routeDetail?.color ??
            vehicleDetail?.vehicle.color ??
            selectedVehicleFromList?.color ??
            "E463A4";

        linesSource.setData(
            buildRouteLinesGeoJSON({
                primaryShape,
                secondaryShape,
                color,
            })
        );

        stopsSource.setData(
            buildStopsGeoJSON({
                tripStops: viewingVehiclesOwnDirection
                    ? vehicleDetail?.stops
                    : undefined,
                directionStops: chosenDir?.stops,
                selectedStopId,
            })
        );
    }, [
        effectiveRouteKey,
        selectedVehicleId,
        selectedVehicleFromList,
        vehicleDetail,
        routeDetail,
        effectiveDirectionId,
        activeDirectionId,
        showBothDirections,
        selectedStopId,
    ]);

    const handleSelectVehicle = useCallback(
        (vehicleId: string, panTo = false) => {
            const v = vehiclesRef.current.find((item) => item.id === vehicleId);
            setSelectedStopId(null);
            setSelectedVehicleId(vehicleId);
            if (v) {
                setSelectedRouteKey(v.route);
                setActiveDirectionId(v.directionId);
                if (panTo && mapRef.current) {
                    mapRef.current.easeTo({
                        center: [v.lon, v.lat],
                        zoom: Math.max(mapRef.current.getZoom(), 13.5),
                        duration: 650,
                    });
                }
            }
            setShowBothDirections(false);
        },
        []
    );

    const handleSelectRoute = useCallback((routeShortName: string) => {
        setSelectedStopId(null);
        setSelectedVehicleId(null);
        setFollowingVehicle(false);
        setSelectedRouteKey(routeShortName);
        setActiveDirectionId(0);
        setShowBothDirections(true);
        setSheetSnap("half");
    }, []);

    const handleFitRoute = useCallback(() => {
        if (!mapRef.current) return;
        const shapes = [
            vehicleDetail?.shape,
            ...(routeDetail?.directions.map((d) => d.shape) ?? []),
        ];
        const bounds = computeGeometryBounds(shapes);
        if (!bounds) return;

        const isMobile = window.innerWidth < 768;
        mapRef.current.fitBounds(bounds, {
            padding: isMobile
                ? { top: 96, bottom: 260, left: 28, right: 28 }
                : { top: 80, bottom: 48, left: 410, right: 48 },
            duration: 700,
            maxZoom: 14.5,
        });
    }, [routeDetail, vehicleDetail]);

    // Auto-fit when selecting a route from search (when no individual vehicle is selected)
    useEffect(() => {
        if (selectedRouteKey && !selectedVehicleId && routeDetail) {
            handleFitRoute();
        }
    }, [selectedRouteKey, selectedVehicleId, routeDetail, handleFitRoute]);

    const handleSelectStop = useCallback(
        (stopId: string | null, coords?: [number, number]) => {
            setSelectedStopId(stopId);
            if (stopId) {
                setFollowingVehicle(false);
                if (sheetSnap === "peek") setSheetSnap("half");
                if (coords && mapRef.current) {
                    mapRef.current.easeTo({
                        center: coords,
                        zoom: Math.max(mapRef.current.getZoom(), 14.5),
                        duration: 550,
                    });
                }
            }
        },
        [sheetSnap]
    );

    const handleCloseInspector = useCallback(() => {
        setSelectedStopId(null);
        setSelectedVehicleId(null);
        setSelectedRouteKey(null);
        setActiveDirectionId(null);
        setShowBothDirections(false);
        setFollowingVehicle(false);
    }, []);

    const secondsUntilRefresh = dataUpdatedAt
        ? Math.max(0, Math.ceil((30_000 - (nowMs - dataUpdatedAt)) / 1000))
        : 0;

    if (configError) {
        return (
            <div className="grid h-screen place-items-center bg-[#0c0c0e] px-6 text-center">
                <p className="text-sm text-zinc-400">{configError}</p>
            </div>
        );
    }

    return (
        <main className="map-shell bg-[#0c0c0e]">
            <div id="map" ref={containerRef} className="map-container" />

            <TopControlBar
                vehicles={vehicles}
                modeFilter={modeFilter}
                onModeFilterChange={setModeFilter}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                onSelectRoute={handleSelectRoute}
                onSelectVehicle={handleSelectVehicle}
                onManualRefresh={() => {
                    void queryClient.invalidateQueries({
                        queryKey: ["vehicles-sync"],
                    });
                }}
                isError={isError}
                isFetching={isFetching}
                secondsUntilRefresh={secondsUntilRefresh}
                telemetry={telemetry}
            />

            <InspectorSheet
                selectedVehicle={selectedVehicleFromList}
                vehicleDetail={vehicleDetail}
                isLoadingVehicle={isLoadingVehicle}
                routeDetail={routeDetail}
                isLoadingRoute={isLoadingRoute}
                activeDirectionId={effectiveDirectionId}
                showBothDirections={showBothDirections}
                selectedStopId={selectedStopId}
                stopDetail={stopDetail}
                isLoadingStop={isLoadingStop}
                followingVehicle={followingVehicle}
                nowUnix={Math.floor(nowMs / 1000)}
                snap={sheetSnap}
                onSnapChange={setSheetSnap}
                onSelectDirection={(dirId) => {
                    setShowBothDirections(false);
                    setActiveDirectionId(dirId);
                }}
                onToggleBothDirections={() =>
                    setShowBothDirections((prev) => !prev)
                }
                onSelectVehicle={handleSelectVehicle}
                onClearVehicleKeepRoute={() => {
                    if (effectiveRouteKey) {
                        setSelectedRouteKey(effectiveRouteKey);
                    }
                    setSelectedVehicleId(null);
                    setFollowingVehicle(false);
                }}
                onSelectStop={handleSelectStop}
                onToggleFollow={() => setFollowingVehicle((prev) => !prev)}
                onFitRoute={handleFitRoute}
                onClose={handleCloseInspector}
            />
        </main>
    );
}
