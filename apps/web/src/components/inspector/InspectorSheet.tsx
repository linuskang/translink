"use client";

import { useMemo, useRef, useState } from "react";
import {
    compassLabel,
    formatBrisbaneTime,
    formatDelay,
    formatRelativeEta,
    normalizeHex,
} from "@/lib/geo";
import type {
    RouteDetail,
    ServiceAlert,
    StopDetail,
    TransitMode,
    Vehicle,
    VehicleDetail,
} from "@/types";

export type SheetSnap = "peek" | "half" | "full";

interface InspectorSheetProps {
    selectedVehicle: Vehicle | null;
    vehicleDetail: VehicleDetail | undefined;
    isLoadingVehicle: boolean;
    routeDetail: RouteDetail | undefined;
    isLoadingRoute: boolean;
    activeDirectionId: number | null;
    showBothDirections: boolean;
    selectedStopId: string | null;
    stopDetail: StopDetail | undefined;
    isLoadingStop: boolean;
    followingVehicle: boolean;
    nowUnix: number;
    snap: SheetSnap;
    onSnapChange: (snap: SheetSnap) => void;
    onSelectDirection: (directionId: number) => void;
    onToggleBothDirections: () => void;
    onSelectVehicle: (vehicleId: string, panTo?: boolean) => void;
    onClearVehicleKeepRoute: () => void;
    onSelectStop: (stopId: string | null, coords?: [number, number]) => void;
    onToggleFollow: () => void;
    onFitRoute: () => void;
    onClose: () => void;
}

function modeLabel(mode: TransitMode): string {
    switch (mode) {
        case "rail":
            return "Train";
        case "ferry":
            return "Ferry";
        case "tram":
            return "Light Rail";
        case "bus":
        default:
            return "Bus";
    }
}

function statusPrefix(statusCode: number): string {
    switch (statusCode) {
        case 0:
            return "Approaching";
        case 1:
            return "Stopped at";
        default:
            return "Next stop";
    }
}

function AlertsList({ alerts }: { alerts: ServiceAlert[] }) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    if (alerts.length === 0) return null;

    return (
        <div className="border-b border-zinc-800/90 px-3.5 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium tracking-wide text-amber-400 uppercase">
                    Service alerts ({alerts.length})
                </span>
            </div>
            <div className="space-y-1.5">
                {alerts.slice(0, 3).map((alert) => {
                    const open = expandedId === alert.id;
                    return (
                        <div
                            key={alert.id}
                            className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2 text-xs"
                        >
                            <button
                                type="button"
                                onClick={() =>
                                    setExpandedId(open ? null : alert.id)
                                }
                                className="flex w-full items-start justify-between gap-2 text-left font-medium text-zinc-100"
                            >
                                <span className="leading-snug">
                                    {alert.header}
                                </span>
                                <span className="shrink-0 text-[11px] text-zinc-400">
                                    {open ? "Hide" : "Details"}
                                </span>
                            </button>
                            {open && (
                                <div className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed text-zinc-300">
                                    {alert.description && (
                                        <p className="whitespace-pre-line">
                                            {alert.description}
                                        </p>
                                    )}
                                    {alert.url && (
                                        <a
                                            href={alert.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-block font-medium text-amber-300 underline underline-offset-2"
                                        >
                                            Translink notice
                                        </a>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function InspectorSheet({
    selectedVehicle,
    vehicleDetail,
    isLoadingVehicle,
    routeDetail,
    isLoadingRoute,
    activeDirectionId,
    showBothDirections,
    selectedStopId,
    stopDetail,
    isLoadingStop,
    followingVehicle,
    nowUnix,
    snap,
    onSnapChange,
    onSelectDirection,
    onToggleBothDirections,
    onSelectVehicle,
    onClearVehicleKeepRoute,
    onSelectStop,
    onToggleFollow,
    onFitRoute,
    onClose,
}: InspectorSheetProps) {
    const [showPassedStops, setShowPassedStops] = useState(false);
    const dragStartYRef = useRef<number | null>(null);
    const dragStartSnapRef = useRef<SheetSnap>(snap);

    const liveVehicle = vehicleDetail?.vehicle ?? selectedVehicle;
    const activeRouteShort =
        routeDetail?.shortName ?? liveVehicle?.route ?? null;
    const badgeColor = `#${normalizeHex(routeDetail?.color ?? liveVehicle?.color)}`;
    const badgeTextColor = `#${normalizeHex(routeDetail?.textColor ?? liveVehicle?.textColor, "1D1D1D")}`;
    const mode = routeDetail?.mode ?? liveVehicle?.mode ?? "bus";
    const routeLongName =
        routeDetail?.longName ?? liveVehicle?.routeLongName ?? null;

    const directions = useMemo(
        () => routeDetail?.directions ?? [],
        [routeDetail?.directions]
    );
    const effectiveDirectionId =
        activeDirectionId ??
        liveVehicle?.directionId ??
        directions[0]?.directionId ??
        null;

    const currentDirection = useMemo(
        () =>
            directions.find((d) => d.directionId === effectiveDirectionId) ??
            directions[0] ??
            null,
        [directions, effectiveDirectionId]
    );

    const stopCalls = useMemo(
        () => vehicleDetail?.stops ?? [],
        [vehicleDetail?.stops]
    );
    const passedStopsCount = useMemo(
        () => stopCalls.filter((s) => s.status === "passed").length,
        [stopCalls]
    );
    const visibleStopCalls = useMemo(
        () =>
            showPassedStops
                ? stopCalls
                : stopCalls.filter((s) => s.status !== "passed"),
        [showPassedStops, stopCalls]
    );

    const nextStopCall = useMemo(
        () =>
            stopCalls.find((s) => s.status === "current") ??
            stopCalls.find((s) => s.status === "upcoming") ??
            null,
        [stopCalls]
    );

    if (!liveVehicle && !routeDetail && !selectedStopId) {
        return null;
    }

    const handleTouchStart = (e: React.TouchEvent) => {
        dragStartYRef.current = e.touches[0].clientY;
        dragStartSnapRef.current = snap;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (dragStartYRef.current === null) return;
        const deltaY = e.changedTouches[0].clientY - dragStartYRef.current;
        dragStartYRef.current = null;

        if (Math.abs(deltaY) < 28) return;
        const order: SheetSnap[] = ["peek", "half", "full"];
        const idx = order.indexOf(dragStartSnapRef.current);
        if (deltaY < 0 && idx < order.length - 1) {
            onSnapChange(order[idx + 1]);
        } else if (deltaY > 0) {
            if (idx > 0) {
                onSnapChange(order[idx - 1]);
            } else {
                onClose();
            }
        }
    };

    const cycleSnap = () => {
        if (snap === "peek") onSnapChange("half");
        else if (snap === "half") onSnapChange("full");
        else onSnapChange("half");
    };

    const snapHeightClass =
        snap === "full"
            ? "max-md:h-[85dvh]"
            : snap === "half"
              ? "max-md:h-[52dvh]"
              : "max-md:h-[224px]";

    // Stop Departures View
    if (selectedStopId) {
        return (
            <aside
                aria-label="Stop details"
                className={`pointer-events-auto fixed z-30 flex flex-col overflow-hidden border border-zinc-800 bg-[#111113] text-zinc-100 shadow-2xl transition-[height] duration-200 ease-out md:top-16 md:left-3 md:max-h-[calc(100dvh-80px)] md:w-[372px] md:rounded-lg max-md:right-0 max-md:bottom-0 max-md:left-0 max-md:rounded-t-xl max-md:border-x-0 max-md:border-b-0 ${snapHeightClass}`}
                style={{
                    paddingBottom: "env(safe-area-inset-bottom)",
                }}
            >
                <div
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    onClick={cycleSnap}
                    className="flex cursor-pointer justify-center py-2 md:hidden"
                >
                    <div className="h-1 w-9 rounded-full bg-zinc-700" />
                </div>

                <div className="flex items-start justify-between gap-2 border-b border-zinc-800 px-3.5 pb-3 md:pt-3.5">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            {(liveVehicle || routeDetail) && (
                                <button
                                    type="button"
                                    onClick={() => onSelectStop(null)}
                                    className="rounded border border-zinc-700/80 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
                                >
                                    Back
                                </button>
                            )}
                            <span className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                                Stop departures
                            </span>
                        </div>
                        <h2 className="mt-1 truncate text-sm font-semibold text-zinc-100">
                            {stopDetail?.stop.name ?? `Stop ${selectedStopId}`}
                        </h2>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-400 tabular-nums">
                            {stopDetail?.stop.code && (
                                <span>Stop #{stopDetail.stop.code}</span>
                            )}
                            {stopDetail?.stop.platformCode && (
                                <span>
                                    Platform {stopDetail.stop.platformCode}
                                </span>
                            )}
                            {stopDetail?.stop.zoneId && (
                                <span>Zone {stopDetail.stop.zoneId}</span>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close inspector"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                        <svg
                            viewBox="0 0 16 16"
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                        >
                            <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                    </button>
                </div>

                {stopDetail?.alerts && stopDetail.alerts.length > 0 && (
                    <AlertsList alerts={stopDetail.alerts} />
                )}

                <div className="flex-1 overflow-y-auto overscroll-contain">
                    {isLoadingStop ? (
                        <div className="px-3.5 py-6 text-xs text-zinc-400">
                            Loading upcoming departures...
                        </div>
                    ) : !stopDetail || stopDetail.departures.length === 0 ? (
                        <div className="px-3.5 py-6 text-xs text-zinc-400">
                            No live departures predicted in the next 90 minutes.
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-800/70">
                            {stopDetail.departures.map((dep, idx) => {
                                const delay = formatDelay(dep.delaySec);
                                const eta = formatRelativeEta(
                                    dep.predictedUnix,
                                    nowUnix
                                );
                                const clock = formatBrisbaneTime(
                                    dep.predictedUnix
                                );
                                return (
                                    <button
                                        key={`${dep.tripId}-${dep.stopId}-${idx}`}
                                        type="button"
                                        onClick={() => {
                                            if (dep.vehicleId) {
                                                onSelectStop(null);
                                                onSelectVehicle(
                                                    dep.vehicleId,
                                                    true
                                                );
                                            }
                                        }}
                                        className="flex w-full items-center justify-between gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-900/80"
                                    >
                                        <div className="flex min-w-0 items-center gap-2.5">
                                            <span
                                                className="inline-flex min-w-[38px] shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums"
                                                style={{
                                                    backgroundColor: `#${normalizeHex(dep.color)}`,
                                                    color: `#${normalizeHex(dep.textColor, "1D1D1D")}`,
                                                }}
                                            >
                                                {dep.routeShortName}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="truncate text-xs font-medium text-zinc-100">
                                                    {dep.headsign ??
                                                        dep.routeLongName ??
                                                        dep.routeShortName}
                                                </div>
                                                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400 tabular-nums">
                                                    <span
                                                        className={
                                                            delay.tone ===
                                                            "ontime"
                                                                ? "text-emerald-400"
                                                                : delay.tone ===
                                                                    "late"
                                                                  ? "text-amber-400"
                                                                  : "text-zinc-400"
                                                        }
                                                    >
                                                        {delay.label}
                                                    </span>
                                                    {dep.platformCode && (
                                                        <span>
                                                            · Plat{" "}
                                                            {dep.platformCode}
                                                        </span>
                                                    )}
                                                    {dep.vehicleLabel && (
                                                        <span>
                                                            · #
                                                            {dep.vehicleLabel}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="shrink-0 text-right tabular-nums">
                                            <div className="text-xs font-semibold text-zinc-100">
                                                {eta ?? "--"}
                                            </div>
                                            <div className="text-[11px] text-zinc-400">
                                                {clock}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </aside>
        );
    }

    const delayInfo = liveVehicle ? formatDelay(liveVehicle.delaySec) : null;
    const headingText = liveVehicle ? compassLabel(liveVehicle.bearing) : null;
    const gpsAgeSec = liveVehicle
        ? Math.max(0, nowUnix - liveVehicle.updatedAt)
        : null;
    const alerts =
        (vehicleDetail?.alerts && vehicleDetail.alerts.length > 0
            ? vehicleDetail.alerts
            : routeDetail?.alerts) ?? [];

    return (
        <aside
            aria-label="Transit inspector"
            className={`pointer-events-auto fixed z-30 flex flex-col overflow-hidden border border-zinc-800 bg-[#111113] text-zinc-100 shadow-2xl transition-[height] duration-200 ease-out md:top-16 md:left-3 md:max-h-[calc(100dvh-80px)] md:w-[376px] md:rounded-lg max-md:right-0 max-md:bottom-0 max-md:left-0 max-md:rounded-t-xl max-md:border-x-0 max-md:border-b-0 ${snapHeightClass}`}
            style={{
                paddingBottom: "env(safe-area-inset-bottom)",
            }}
        >
            {/* Mobile Drag Handle */}
            <div
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={cycleSnap}
                className="flex shrink-0 cursor-pointer justify-center py-2 md:hidden"
            >
                <div className="h-1 w-9 rounded-full bg-zinc-700" />
            </div>

            {/* Header: Route Badge + Destination + Actions */}
            <div className="shrink-0 border-b border-zinc-800 px-3.5 pb-3 md:pt-3.5">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                        <span
                            className="inline-flex min-w-[44px] shrink-0 items-center justify-center rounded px-2 py-1 text-sm font-bold tracking-tight tabular-nums"
                            style={{
                                backgroundColor: badgeColor,
                                color: badgeTextColor,
                            }}
                        >
                            {activeRouteShort ?? "?"}
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-medium text-zinc-400 uppercase">
                                    {modeLabel(mode)}
                                </span>
                                {liveVehicle?.directionId !== null &&
                                    liveVehicle?.directionId !== undefined && (
                                        <span className="text-[11px] text-zinc-500">
                                            ·{" "}
                                            {liveVehicle.directionId === 0
                                                ? "Inbound"
                                                : "Outbound"}
                                        </span>
                                    )}
                            </div>
                            <h2 className="truncate text-sm font-semibold text-zinc-100">
                                {liveVehicle?.headsign
                                    ? `To ${liveVehicle.headsign}`
                                    : currentDirection?.label
                                      ? `To ${currentDirection.label}`
                                      : (routeLongName ??
                                        `Route ${activeRouteShort}`)}
                            </h2>
                            {routeLongName && (
                                <p className="truncate text-xs text-zinc-400">
                                    {routeLongName}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            onClick={onFitRoute}
                            title="Fit route on map"
                            className="flex h-7 items-center rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                        >
                            Fit
                        </button>
                        {liveVehicle && (
                            <button
                                type="button"
                                onClick={onToggleFollow}
                                title="Follow vehicle"
                                className={`flex h-7 items-center rounded border px-2 text-[11px] font-medium ${
                                    followingVehicle
                                        ? "border-zinc-200 bg-zinc-100 text-zinc-950"
                                        : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                                }`}
                            >
                                {followingVehicle ? "Following" : "Follow"}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close inspector"
                            className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        >
                            <svg
                                viewBox="0 0 16 16"
                                className="h-3.5 w-3.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.75"
                            >
                                <path d="M4 4l8 8M12 4l-8 8" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Direction Switcher */}
                {(directions.length > 0 || isLoadingRoute) && (
                    <div className="mt-2.5">
                        <div className="mb-1 flex items-center justify-between">
                            <span className="text-[11px] font-medium text-zinc-400">
                                Route directions
                            </span>
                            {directions.length > 1 && (
                                <button
                                    type="button"
                                    onClick={onToggleBothDirections}
                                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                                        showBothDirections
                                            ? "bg-zinc-200 text-zinc-950"
                                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                                    }`}
                                >
                                    {showBothDirections
                                        ? "Showing both paths"
                                        : "Overlay both paths"}
                                </button>
                            )}
                        </div>

                        {directions.length > 0 ? (
                            <div className="grid grid-cols-2 gap-1.5">
                                {directions.map((dir) => {
                                    const active =
                                        !showBothDirections &&
                                        effectiveDirectionId ===
                                            dir.directionId;
                                    return (
                                        <button
                                            key={`${dir.routeShortName}-${dir.directionId}`}
                                            type="button"
                                            onClick={() => {
                                                onSelectDirection(
                                                    dir.directionId
                                                );
                                                if (snap === "peek") {
                                                    onSnapChange("half");
                                                }
                                            }}
                                            className={`flex flex-col rounded border px-2.5 py-1.5 text-left transition-colors ${
                                                active
                                                    ? "border-zinc-500 bg-zinc-800/90 text-zinc-100"
                                                    : "border-zinc-800/90 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                                            }`}
                                        >
                                            <div className="flex w-full items-center justify-between gap-1 text-[10px] uppercase">
                                                <span>
                                                    {dir.directionId === 0
                                                        ? "Inbound"
                                                        : "Outbound"}
                                                    {dir.routeShortName !==
                                                    activeRouteShort
                                                        ? ` · ${dir.routeShortName}`
                                                        : ""}
                                                </span>
                                                <span className="font-semibold tabular-nums">
                                                    {dir.activeVehicleCount}{" "}
                                                    active
                                                </span>
                                            </div>
                                            <span className="mt-0.5 w-full truncate text-xs font-medium text-zinc-200">
                                                {dir.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-[11px] text-zinc-500">
                                Loading route directions...
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
                {/* Selected Vehicle Live Telemetry */}
                {liveVehicle && (
                    <div className="border-b border-zinc-800/90 px-3.5 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 text-xs">
                                <span className="text-zinc-400">
                                    {statusPrefix(liveVehicle.statusCode)}:{" "}
                                </span>
                                <span className="font-medium text-zinc-100">
                                    {vehicleDetail?.vehicle.stopName ??
                                        nextStopCall?.stopName ??
                                        (isLoadingVehicle
                                            ? "Loading stop..."
                                            : "En route")}
                                </span>
                            </div>
                            {delayInfo && (
                                <span
                                    className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                                        delayInfo.tone === "ontime"
                                            ? "bg-emerald-500/15 text-emerald-400"
                                            : delayInfo.tone === "late"
                                              ? "bg-amber-500/15 text-amber-400"
                                              : delayInfo.tone === "early"
                                                ? "bg-sky-500/15 text-sky-400"
                                                : "bg-zinc-800 text-zinc-400"
                                    }`}
                                >
                                    {delayInfo.label}
                                </span>
                            )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400 tabular-nums">
                            <span>
                                Vehicle{" "}
                                <strong className="font-medium text-zinc-200">
                                    #{liveVehicle.label || liveVehicle.id}
                                </strong>
                            </span>
                            {liveVehicle.speedKmh !== null && (
                                <span>
                                    <strong className="font-medium text-zinc-200">
                                        {liveVehicle.speedKmh}
                                    </strong>{" "}
                                    km/h
                                </span>
                            )}
                            {headingText && <span>{headingText}</span>}
                            {gpsAgeSec !== null && (
                                <span>Updated {gpsAgeSec}s ago</span>
                            )}
                        </div>
                    </div>
                )}

                {/* Active Vehicles on Current Direction (quick switcher!) */}
                {currentDirection && currentDirection.vehicles.length > 0 && (
                    <div className="border-b border-zinc-800/90 px-3.5 py-2.5">
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[11px] font-medium text-zinc-400">
                                Vehicles heading to {currentDirection.label} (
                                {currentDirection.vehicles.length})
                            </span>
                            {liveVehicle && (
                                <button
                                    type="button"
                                    onClick={onClearVehicleKeepRoute}
                                    className="text-[11px] text-zinc-400 hover:text-zinc-200"
                                >
                                    Route stops
                                </button>
                            )}
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                            {currentDirection.vehicles.map((v) => {
                                const isCurrent = liveVehicle?.id === v.id;
                                const d = formatDelay(v.delaySec);
                                return (
                                    <button
                                        key={v.id}
                                        type="button"
                                        onClick={() =>
                                            onSelectVehicle(v.id, true)
                                        }
                                        className={`shrink-0 rounded border px-2 py-1 text-left text-[11px] tabular-nums transition-colors ${
                                            isCurrent
                                                ? "border-zinc-300 bg-zinc-800 text-zinc-100"
                                                : "border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-700"
                                        }`}
                                    >
                                        <span className="font-semibold">
                                            #{v.label || v.id.slice(0, 4)}
                                        </span>
                                        <span className="ml-1.5 text-zinc-400">
                                            {d.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Alerts */}
                <AlertsList alerts={alerts} />

                {/* Trip Stop Predictions OR Canonical Direction Stops */}
                {liveVehicle ? (
                    <div className="px-3.5 py-2.5">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                                Trip stops{" "}
                                {stopCalls.length > 0
                                    ? `(${stopCalls.length})`
                                    : ""}
                            </span>
                            {passedStopsCount > 0 && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowPassedStops((prev) => !prev)
                                    }
                                    className="text-[11px] font-medium text-zinc-400 hover:text-zinc-200"
                                >
                                    {showPassedStops
                                        ? "Hide passed"
                                        : `Show ${passedStopsCount} passed`}
                                </button>
                            )}
                        </div>

                        {isLoadingVehicle && stopCalls.length === 0 ? (
                            <div className="py-4 text-xs text-zinc-400">
                                Loading live trip schedule...
                            </div>
                        ) : visibleStopCalls.length === 0 ? (
                            <div className="py-4 text-xs text-zinc-400">
                                Stop schedule unavailable for this trip.
                            </div>
                        ) : (
                            <ol className="relative space-y-0">
                                {visibleStopCalls.map((stop, idx) => {
                                    const isCurrent = stop.status === "current";
                                    const isPassed = stop.status === "passed";
                                    const isLast =
                                        idx === visibleStopCalls.length - 1;
                                    const timeStr =
                                        formatBrisbaneTime(
                                            stop.predictedUnix ??
                                                stop.scheduledUnix
                                        ) ?? stop.scheduledTime;
                                    const etaStr = formatRelativeEta(
                                        stop.predictedUnix ??
                                            stop.scheduledUnix,
                                        nowUnix
                                    );

                                    return (
                                        <li
                                            key={`${stop.stopId}-${stop.stopSequence}`}
                                            className="relative"
                                        >
                                            {!isLast && (
                                                <span
                                                    aria-hidden="true"
                                                    className={`absolute top-4 bottom-0 left-[7px] w-[1.5px] ${
                                                        isPassed
                                                            ? "bg-zinc-800"
                                                            : "bg-zinc-700"
                                                    }`}
                                                />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onSelectStop(stop.stopId, [
                                                        stop.lon,
                                                        stop.lat,
                                                    ])
                                                }
                                                className={`group flex w-full items-start justify-between gap-2 rounded px-1 py-1.5 text-left hover:bg-zinc-900 ${
                                                    isPassed ? "opacity-50" : ""
                                                }`}
                                            >
                                                <div className="flex min-w-0 items-start gap-2.5">
                                                    <span
                                                        className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                                                            isCurrent
                                                                ? "border-zinc-100 bg-zinc-100"
                                                                : isPassed
                                                                  ? "border-zinc-700 bg-zinc-950"
                                                                  : "border-zinc-400 bg-zinc-950 group-hover:border-zinc-200"
                                                        }`}
                                                    />
                                                    <div className="min-w-0">
                                                        <div
                                                            className={`truncate text-xs ${
                                                                isCurrent
                                                                    ? "font-semibold text-zinc-100"
                                                                    : "font-normal text-zinc-200"
                                                            }`}
                                                        >
                                                            {stop.stopName}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 tabular-nums">
                                                            {stop.platformCode && (
                                                                <span>
                                                                    Plat{" "}
                                                                    {
                                                                        stop.platformCode
                                                                    }
                                                                </span>
                                                            )}
                                                            {stop.stopCode && (
                                                                <span>
                                                                    #
                                                                    {
                                                                        stop.stopCode
                                                                    }
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="shrink-0 text-right tabular-nums">
                                                    {etaStr && !isPassed && (
                                                        <div
                                                            className={`text-xs font-medium ${
                                                                isCurrent
                                                                    ? "text-zinc-100"
                                                                    : "text-zinc-300"
                                                            }`}
                                                        >
                                                            {etaStr}
                                                        </div>
                                                    )}
                                                    {timeStr && (
                                                        <div className="text-[11px] text-zinc-500">
                                                            {timeStr}
                                                        </div>
                                                    )}
                                                </div>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </div>
                ) : (
                    currentDirection && (
                        <div className="px-3.5 py-2.5">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                                    Stops · {currentDirection.label} (
                                    {currentDirection.stops.length})
                                </span>
                            </div>
                            {currentDirection.stops.length === 0 ? (
                                <div className="py-4 text-xs text-zinc-400">
                                    {isLoadingRoute
                                        ? "Loading route stops..."
                                        : "Select an active vehicle to view live arrival times."}
                                </div>
                            ) : (
                                <ol className="space-y-0.5">
                                    {currentDirection.stops.map((stop) => (
                                        <li
                                            key={`${stop.stopId}-${stop.sequence}`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onSelectStop(stop.stopId, [
                                                        stop.lon,
                                                        stop.lat,
                                                    ])
                                                }
                                                className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1.5 text-left hover:bg-zinc-900"
                                            >
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <span className="h-2 w-2 shrink-0 rounded-full border border-zinc-400 bg-zinc-950" />
                                                    <span className="truncate text-xs text-zinc-200">
                                                        {stop.name}
                                                    </span>
                                                </div>
                                                <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">
                                                    {stop.platformCode
                                                        ? `Plat ${stop.platformCode}`
                                                        : stop.code
                                                          ? `#${stop.code}`
                                                          : ""}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                    )
                )}

                {routeDetail?.url && (
                    <div className="border-t border-zinc-800/80 px-3.5 py-2.5">
                        <a
                            href={routeDetail.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-medium text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
                        >
                            Official Translink timetable
                        </a>
                    </div>
                )}
            </div>
        </aside>
    );
}
