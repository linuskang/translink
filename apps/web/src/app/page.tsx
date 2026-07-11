"use client";

import dynamic from "next/dynamic";

const MapCanvas = dynamic(() => import("@/components/map/MapCanvas"), {
    ssr: false,
    loading: () => (
        <div className="flex h-screen w-screen items-center justify-center bg-black">
            <span className="text-sm text-white/30">Loading...</span>
        </div>
    ),
});

export default function Page() {
    return <MapCanvas />;
}
