import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
    const rawKey = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim();
    const hasValidKey = Boolean(rawKey && rawKey !== "your_maptiler_key_here");

    if (hasValidKey) {
        return NextResponse.json(
            {
                provider: "maptiler",
                tileUrl: `https://api.maptiler.com/maps/openstreetmap-dark/{z}/{x}/{y}@2x.png?key=${encodeURIComponent(rawKey!)}`,
                tileSize: 512,
                attribution:
                    '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    }

    return NextResponse.json(
        {
            provider: "carto-dark",
            tileUrl:
                "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
            tileSize: 512,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        },
        { headers: { "Cache-Control": "no-store" } }
    );
}
