"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, formatDelay, normalizeHex } from "@/lib/geo";
import { useRouteSearch } from "@/hooks/useTransitDetails";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import type { SyncTelemetry, TransitMode, Vehicle } from "@/types";

interface TopControlBarProps {
    vehicles: Vehicle[];
    modeFilter: TransitMode | "all";
    onModeFilterChange: (mode: TransitMode | "all") => void;
    searchQuery: string;
    onSearchQueryChange: (q: string) => void;
    onSelectRoute: (routeShortName: string) => void;
    onSelectVehicle: (vehicleId: string, panTo?: boolean) => void;
    onManualRefresh: () => void;
    isError: boolean;
    isFetching: boolean;
    secondsUntilRefresh: number;
    telemetry: SyncTelemetry;
}

const MODE_OPTIONS: Array<{ value: TransitMode | "all"; label: string }> = [
    { value: "all", label: "All" },
    { value: "bus", label: "Bus" },
    { value: "rail", label: "Train" },
    { value: "ferry", label: "Ferry" },
    { value: "tram", label: "Tram" },
];

export function TopControlBar({
    vehicles,
    modeFilter,
    onModeFilterChange,
    searchQuery,
    onSearchQueryChange,
    onSelectRoute,
    onSelectVehicle,
    onManualRefresh,
    isError,
    isFetching,
    secondsUntilRefresh,
    telemetry,
}: TopControlBarProps) {
    const [searchFocused, setSearchFocused] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    const searchWrapRef = useRef<HTMLDivElement>(null);
    const statusWrapRef = useRef<HTMLDivElement>(null);

    const { canPromptInstall, isIosSafari, isStandalone, promptInstall } =
        usePwaInstall();
    const { data: searchedRoutes = [] } = useRouteSearch(searchQuery);

    useEffect(() => {
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (
                searchWrapRef.current &&
                !searchWrapRef.current.contains(target)
            ) {
                setSearchFocused(false);
            }
            if (
                statusWrapRef.current &&
                !statusWrapRef.current.contains(target)
            ) {
                setStatusOpen(false);
            }
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, []);

    const modeCounts = useMemo(() => {
        const counts = {
            all: vehicles.length,
            bus: 0,
            rail: 0,
            ferry: 0,
            tram: 0,
        };
        for (const v of vehicles) {
            counts[v.mode]++;
        }
        return counts;
    }, [vehicles]);

    const matchingVehicles = useMemo(() => {
        const q = searchQuery.trim().toLowerCase().replace(/^#/, "");
        if (!q) return [];
        const exact: Vehicle[] = [];
        const partial: Vehicle[] = [];

        for (const v of vehicles) {
            const routeMatch = v.route.toLowerCase() === q;
            const labelMatch = v.label?.toLowerCase() === q;
            if (routeMatch || labelMatch) {
                exact.push(v);
                if (exact.length >= 8) break;
                continue;
            }
            if (
                partial.length < 8 &&
                (v.route.toLowerCase().includes(q) ||
                    v.headsign?.toLowerCase().includes(q) ||
                    v.routeLongName?.toLowerCase().includes(q) ||
                    v.label?.toLowerCase().includes(q))
            ) {
                partial.push(v);
            }
        }
        return [...exact, ...partial].slice(0, 6);
    }, [searchQuery, vehicles]);

    const showDropdown =
        searchFocused &&
        searchQuery.trim().length > 0 &&
        (searchedRoutes.length > 0 || matchingVehicles.length > 0);

    return (
        <header
            className="pointer-events-none fixed top-0 right-0 left-0 z-20 px-2.5 pt-2.5 md:px-3 md:pt-3"
            style={{
                paddingTop: "calc(env(safe-area-inset-top) + 10px)",
                paddingLeft: "calc(env(safe-area-inset-left) + 10px)",
                paddingRight: "calc(env(safe-area-inset-right) + 10px)",
            }}
        >
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                {/* Left cluster: Search + Status */}
                <div className="flex items-center gap-2">
                    <div
                        ref={searchWrapRef}
                        className="pointer-events-auto relative flex-1 md:w-72 md:flex-none"
                    >
                        <div className="flex h-9 items-center rounded-md border border-zinc-800 bg-[#111113]/95 px-2.5 shadow-lg">
                            <svg
                                viewBox="0 0 16 16"
                                className="mr-2 h-3.5 w-3.5 shrink-0 text-zinc-500"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.75"
                            >
                                <circle cx="7" cy="7" r="4.75" />
                                <path d="M10.5 10.5L14 14" />
                            </svg>
                            <input
                                type="search"
                                inputMode="search"
                                value={searchQuery}
                                onFocus={() => setSearchFocused(true)}
                                onChange={(e) =>
                                    onSearchQueryChange(e.target.value)
                                }
                                placeholder="Route, destination, or #fleet"
                                aria-label="Search route, destination, or fleet number"
                                className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => onSearchQueryChange("")}
                                    aria-label="Clear search"
                                    className="ml-1 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
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
                            )}
                        </div>

                        {/* Search Autocomplete Dropdown */}
                        {showDropdown && (
                            <div className="absolute top-10 right-0 left-0 max-h-[60dvh] overflow-y-auto rounded-md border border-zinc-800 bg-[#111113] shadow-2xl">
                                {searchedRoutes.length > 0 && (
                                    <div className="border-b border-zinc-800/80 py-1">
                                        <div className="px-2.5 py-1 text-[10px] font-medium tracking-wide text-zinc-500 uppercase">
                                            Routes & directions
                                        </div>
                                        {searchedRoutes
                                            .slice(0, 6)
                                            .map((route) => (
                                                <button
                                                    key={`${route.mode}-${route.shortName}`}
                                                    type="button"
                                                    onClick={() => {
                                                        onSelectRoute(
                                                            route.shortName
                                                        );
                                                        setSearchFocused(false);
                                                    }}
                                                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-900"
                                                >
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <span
                                                            className="inline-flex min-w-[36px] shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                                                            style={{
                                                                backgroundColor: `#${normalizeHex(route.color)}`,
                                                                color: `#${normalizeHex(route.textColor, "1D1D1D")}`,
                                                            }}
                                                        >
                                                            {route.shortName}
                                                        </span>
                                                        <span className="truncate text-xs text-zinc-200">
                                                            {route.longName}
                                                        </span>
                                                    </div>
                                                    <span className="shrink-0 text-[11px] text-zinc-400 tabular-nums">
                                                        {route.activeVehicles}{" "}
                                                        live
                                                    </span>
                                                </button>
                                            ))}
                                    </div>
                                )}

                                {matchingVehicles.length > 0 && (
                                    <div className="py-1">
                                        <div className="px-2.5 py-1 text-[10px] font-medium tracking-wide text-zinc-500 uppercase">
                                            Active vehicles
                                        </div>
                                        {matchingVehicles.map((v) => {
                                            const d = formatDelay(v.delaySec);
                                            return (
                                                <button
                                                    key={v.id}
                                                    type="button"
                                                    onClick={() => {
                                                        onSelectVehicle(
                                                            v.id,
                                                            true
                                                        );
                                                        setSearchFocused(false);
                                                    }}
                                                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-900"
                                                >
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <span
                                                            className="inline-flex min-w-[36px] shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                                                            style={{
                                                                backgroundColor: `#${normalizeHex(v.color)}`,
                                                                color: `#${normalizeHex(v.textColor, "1D1D1D")}`,
                                                            }}
                                                        >
                                                            {v.route}
                                                        </span>
                                                        <div className="min-w-0">
                                                            <div className="truncate text-xs text-zinc-200">
                                                                {v.headsign
                                                                    ? `To ${v.headsign}`
                                                                    : (v.routeLongName ??
                                                                      `Route ${v.route}`)}
                                                            </div>
                                                            <div className="text-[10px] text-zinc-500 tabular-nums">
                                                                #
                                                                {v.label ||
                                                                    v.id}{" "}
                                                                · {d.label}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <span className="shrink-0 text-[10px] text-zinc-500 uppercase">
                                                        {v.directionId === 0
                                                            ? "In"
                                                            : v.directionId ===
                                                                1
                                                              ? "Out"
                                                              : ""}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Live Status + Data Usage Popover */}
                    <div
                        ref={statusWrapRef}
                        className="pointer-events-auto relative"
                    >
                        <button
                            type="button"
                            onClick={() => setStatusOpen((prev) => !prev)}
                            className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-zinc-800 bg-[#111113]/95 px-2.5 text-xs text-zinc-200 shadow-lg hover:border-zinc-700 tabular-nums"
                        >
                            <span
                                className={`h-2 w-2 rounded-full ${
                                    isError
                                        ? "bg-red-500"
                                        : isFetching
                                          ? "bg-amber-400"
                                          : "bg-emerald-500"
                                }`}
                            />
                            <span className="font-medium">
                                {isError ? "Offline" : `${vehicles.length}`}
                            </span>
                            {!isError && (
                                <span className="text-zinc-500">
                                    · {secondsUntilRefresh}s
                                </span>
                            )}
                        </button>

                        {statusOpen && (
                            <div className="absolute top-10 right-0 w-72 rounded-md border border-zinc-800 bg-[#111113] p-3 text-xs text-zinc-200 shadow-2xl md:right-auto md:left-0">
                                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                                    <span className="font-semibold text-zinc-100">
                                        SEQ Live Telemetry
                                    </span>
                                    <button
                                        type="button"
                                        onClick={onManualRefresh}
                                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
                                    >
                                        {isFetching ? "Syncing..." : "Sync now"}
                                    </button>
                                </div>

                                <dl className="mt-2.5 space-y-1.5 text-[11px] tabular-nums">
                                    <div className="flex justify-between">
                                        <dt className="text-zinc-400">
                                            Active vehicles
                                        </dt>
                                        <dd className="font-medium text-zinc-100">
                                            {vehicles.length} loaded
                                        </dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-zinc-400">
                                            Sync protocol
                                        </dt>
                                        <dd className="font-medium text-zinc-100 uppercase">
                                            {telemetry.lastSyncMode}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-zinc-400">
                                            Last 30s transfer
                                        </dt>
                                        <dd className="font-medium text-emerald-400">
                                            {formatBytes(
                                                telemetry.lastWireBytes
                                            )}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-zinc-400">
                                            Session total ({telemetry.pollCount}{" "}
                                            polls)
                                        </dt>
                                        <dd className="font-medium text-zinc-200">
                                            {formatBytes(
                                                telemetry.sessionWireBytes
                                            )}
                                        </dd>
                                    </div>
                                </dl>

                                <p className="mt-2.5 border-t border-zinc-800/80 pt-2 text-[11px] leading-relaxed text-zinc-500">
                                    Dictionary + delta sync transfers only
                                    position changes every 30s and pauses
                                    automatically while backgrounded.
                                </p>

                                {!isStandalone &&
                                    (canPromptInstall || isIosSafari) && (
                                        <div className="mt-2.5 border-t border-zinc-800 pt-2.5">
                                            {canPromptInstall ? (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        void promptInstall();
                                                    }}
                                                    className="w-full rounded border border-zinc-300 bg-zinc-100 py-1.5 text-center text-xs font-semibold text-zinc-950 hover:bg-white"
                                                >
                                                    Install mobile app
                                                </button>
                                            ) : (
                                                <div className="rounded border border-zinc-800 bg-zinc-900/70 px-2.5 py-2 text-[11px] text-zinc-300">
                                                    <div className="font-medium text-zinc-100">
                                                        Install on iPhone
                                                    </div>
                                                    <div className="mt-0.5 text-zinc-400">
                                                        Tap Safari Share, then
                                                        select Add to Home
                                                        Screen.
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                            </div>
                        )}
                    </div>

                    {canPromptInstall && !isStandalone && (
                        <button
                            type="button"
                            onClick={() => void promptInstall()}
                            className="pointer-events-auto hidden h-9 items-center rounded-md border border-zinc-700 bg-[#111113]/95 px-2.5 text-xs font-medium text-zinc-100 shadow-lg hover:bg-zinc-800 sm:flex"
                        >
                            Install app
                        </button>
                    )}
                </div>

                {/* Right cluster: Mode Filter Pills */}
                <div className="pointer-events-auto flex items-center gap-1 overflow-x-auto rounded-md border border-zinc-800 bg-[#111113]/95 p-1 shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {MODE_OPTIONS.map((opt) => {
                        const active = modeFilter === opt.value;
                        const count = modeCounts[opt.value];
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => onModeFilterChange(opt.value)}
                                className={`flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors tabular-nums ${
                                    active
                                        ? "bg-zinc-100 text-zinc-950"
                                        : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
                                }`}
                            >
                                <span>{opt.label}</span>
                                <span
                                    className={`text-[10px] ${
                                        active
                                            ? "text-zinc-600"
                                            : "text-zinc-500"
                                    }`}
                                >
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </header>
    );
}
