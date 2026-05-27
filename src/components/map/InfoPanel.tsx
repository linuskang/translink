"use client";

import { X } from "lucide-react";
import type { SelectedFeature } from "@/types";

interface Props {
  feature: SelectedFeature | null;
  onClose: () => void;
}

function formatValue(val: unknown): string {
  if (val == null || val === "") return "—";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

const SKIP_KEYS = new Set(["id", "lat", "lon", "latitude", "longitude"]);

const FRIENDLY_KEYS: Record<string, string> = {
  label: "Vehicle",
  route_id: "Route",
  trip_id: "Trip",
  bearing: "Bearing",
  speed: "Speed (m/s)",
  occupancy: "Occupancy",
};

export function InfoPanel({ feature, onClose }: Props) {
  if (!feature) return null;

  const props = feature.properties;
  const displayEntries = Object.entries(props).filter(
    ([k, v]) => FRIENDLY_KEYS[k] && !SKIP_KEYS.has(k) && v != null && v !== ""
  );

  const title =
    formatValue(props.label) !== "—" ? formatValue(props.label) : "Vehicle";

  return (
    <div className="absolute bottom-8 left-1/2 z-10 w-full max-w-sm -translate-x-1/2 px-4">
      <div className="rounded-2xl border border-white/10 bg-black/80 p-4 backdrop-blur-md shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🚌</span>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">
                {title}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#f97316" }}>
                Live vehicle position
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {displayEntries.length > 0 && (
          <div className="space-y-1.5 border-t border-white/10 pt-3">
            {displayEntries.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 text-xs">
                <span className="text-white/40 shrink-0">{FRIENDLY_KEYS[k]}</span>
                <span className="text-white/80 text-right truncate max-w-[180px]">
                  {formatValue(v)}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-[10px] text-white/20">
          {feature.lngLat[1].toFixed(5)}, {feature.lngLat[0].toFixed(5)}
        </p>
      </div>
    </div>
  );
}
