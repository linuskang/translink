"use client";

import { X } from "lucide-react";
import type { SelectedVehicle } from "@/types";

interface Props {
    vehicle: SelectedVehicle | null;
    onClose: () => void;
}

export function InfoPanel({ vehicle, onClose }: Props) {
    if (!vehicle) return null;

    return (
        <div className="absolute bottom-4 left-4 z-10 w-64 rounded-xl border border-white/10 bg-black/70 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-white">
                    {vehicle.route}
                </span>
                <button
                    onClick={onClose}
                    className="rounded p-0.5 text-white/30 hover:bg-white/10 hover:text-white/70"
                >
                    <X className="size-4" />
                </button>
            </div>
            <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between gap-4">
                    <dt className="text-white/40">Vehicle</dt>
                    <dd className="truncate text-white/80">
                        {vehicle.vehicle}
                    </dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-white/40">Trip</dt>
                    <dd className="truncate text-white/80">{vehicle.trip}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-white/40">Bearing</dt>
                    <dd className="text-white/80">{vehicle.bearing}&deg;</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-white/40">Position</dt>
                    <dd className="text-white/80">
                        {vehicle.lngLat[1].toFixed(4)},{" "}
                        {vehicle.lngLat[0].toFixed(4)}
                    </dd>
                </div>
            </dl>
        </div>
    );
}
