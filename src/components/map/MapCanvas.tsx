"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { Search, X, RotateCw } from "lucide-react";

import { useVehicles } from "@/hooks/useVehicles";
import { normalizeVehicles } from "@/lib/geo";
import { InfoPanel } from "./InfoPanel";
import type { SelectedFeature, VehicleEntity } from "@/types";

// Next.js/Turbopack can't inline the worker blob — point to the file in /public
setWorkerUrl("/maplibre-gl-csp-worker.js");

const STYLE_URL = `https://api.maptiler.com/maps/openstreetmap-dark/style.json?key=bGeKQuErbYq34iLTlCjO`;
const SEQ_CENTER: [number, number] = [153.0251, -27.4698];
const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };
const VEHICLE_COLOR = "#f97316";
const VEHICLE_ANIMATION_MS = 5_000;

type VehiclePos = { lng: number; lat: number; bearing: number };

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const prevPosRef = useRef<Map<string, VehiclePos>>(new Map());
  const currPosRef = useRef<Map<string, VehiclePos>>(new Map());
  const vehicleEntitiesRef = useRef<VehicleEntity[]>([]);
  const lastFetchTimeRef = useRef(0);
  const rafRef = useRef(0);

  const [selected, setSelected] = useState<SelectedFeature | null>(null);
  const [search, setSearch] = useState("");
  const [nextRefresh, setNextRefresh] = useState(0);
  const searchRef = useRef(search);

  const { data: vehicles, dataUpdatedAt: vehiclesUpdatedAt } = useVehicles();

  // Init map
  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;
    const container = containerRef.current;

    // Fetch style manually to inject `projection` — prevents MapLibre 5.x generator
    // crash where `map.style` becomes null mid-tile-load after React Strict Mode cleanup.
    fetch(STYLE_URL)
      .then((r) => r.json())
      .then((style: StyleSpecification) => {
        if (!mounted || !container.isConnected) return;
        if (!style.projection) style.projection = { type: "mercator" };

        const map = new maplibregl.Map({
          container,
          style,
          center: SEQ_CENTER,
          zoom: 12,
          attributionControl: { compact: true },
        });

        mapRef.current = map;

        map.on("load", () => {
          if (!mounted) return;

          map.addSource("vehicles", { type: "geojson", data: EMPTY_FC });

          map.addLayer({
            id: "vehicles-layer",
            type: "circle",
            source: "vehicles",
            paint: {
              "circle-radius": 7,
              "circle-color": VEHICLE_COLOR,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#fff",
              "circle-opacity": 1,
            },
          });

          map.addLayer({
            id: "vehicles-label",
            type: "symbol",
            source: "vehicles",
            layout: {
              "text-field": ["get", "route_id"],
              "text-size": 8,
              "text-offset": [0, 1.5],
              "text-anchor": "top",
              "text-allow-overlap": false,
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": "#000000",
              "text-halo-width": 1,
            },
          });

          map.on("click", "vehicles-layer", (e) => {
            const f = e.features?.[0];
            if (!f) return;
            setSelected({
              properties: (f.properties ?? {}) as Record<string, unknown>,
              lngLat: [e.lngLat.lng, e.lngLat.lat],
            });
          });

          map.on("mouseenter", "vehicles-layer", () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "vehicles-layer", () => {
            map.getCanvas().style.cursor = "";
          });

          const geolocate = new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showUserHeading: true,
            showAccuracyCircle: true,
          });
          map.addControl(geolocate, "bottom-right");
          map.once("idle", () => geolocate.trigger());

          setMapReady(true);
        });
      })
      .catch((e) => console.error("Map style fetch failed:", e));

    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
    };
  }, []);

  // Refresh timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (vehiclesUpdatedAt) {
        const remaining = Math.max(0, 30_000 - (Date.now() - vehiclesUpdatedAt));
        setNextRefresh(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [vehiclesUpdatedAt]);

  // Keep search ref in sync
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  // Update vehicle interpolation refs when new data arrives
  useEffect(() => {
    if (!vehicles) return;
    vehicleEntitiesRef.current = vehicles;

    prevPosRef.current = new Map(currPosRef.current);
    currPosRef.current.clear();

    for (const entity of vehicles) {
      const pos = entity.vehicle?.position;
      if (!pos?.latitude || !pos?.longitude) continue;
      currPosRef.current.set(entity.id, {
        lng: pos.longitude,
        lat: pos.latitude,
        bearing: pos.bearing ?? 0,
      });
    }

    lastFetchTimeRef.current = Date.now();
  }, [vehicles]);

  // RAF loop — smooth vehicle animation
  useEffect(() => {
    let id: number;

    function tick() {
      id = requestAnimationFrame(tick);

      const map = mapRef.current;
      if (!map || !mapReady) return;
      if (!vehicleEntitiesRef.current.length) return;

      const t = Math.min(
        1,
        (Date.now() - lastFetchTimeRef.current) / VEHICLE_ANIMATION_MS
      );

      const interpolated = new Map<string, [number, number]>();
      currPosRef.current.forEach((curr, entityId) => {
        const prev = prevPosRef.current.get(entityId);
        if (prev) {
          interpolated.set(entityId, [
            lerp(prev.lng, curr.lng, t),
            lerp(prev.lat, curr.lat, t),
          ]);
        } else {
          interpolated.set(entityId, [curr.lng, curr.lat]);
        }
      });

      const fc = normalizeVehicles(vehicleEntitiesRef.current, interpolated);

      if (searchRef.current.trim()) {
        const q = searchRef.current.toLowerCase();
        fc.features = fc.features.filter(
          (f) =>
            f.properties?.label?.toLowerCase().includes(q) ||
            f.properties?.route_id?.toLowerCase().includes(q)
        );
      }

      (map.getSource("vehicles") as GeoJSONSource | undefined)?.setData(fc);
    }

    id = requestAnimationFrame(tick);
    rafRef.current = id;
    return () => cancelAnimationFrame(id);
  }, [mapReady]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%" }}
        className="absolute inset-0"
      />

      <div className="absolute top-4 left-4 z-20 w-72 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-white/40" />
          <input
            type="text"
            placeholder="Search routes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/70 py-2.5 pl-9 pr-9 text-sm text-white placeholder-white/30 backdrop-blur-md outline-none transition-colors focus:border-white/30 focus:bg-black/80"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-3 text-white/40 hover:text-white/70 transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-white/50 backdrop-blur-sm">
          <RotateCw className="size-3 animate-spin flex-shrink-0" />
          <span>Refresh in: {((nextRefresh / 1000) | 0)}s</span>
        </div>
      </div>

      <InfoPanel feature={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
