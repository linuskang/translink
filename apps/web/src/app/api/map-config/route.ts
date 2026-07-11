import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
    const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;

    if (!maptilerKey) {
        return NextResponse.json(
            { error: "NEXT_PUBLIC_MAPTILER_KEY is not configured" },
            { status: 503 }
        );
    }

    return NextResponse.json(
        { maptilerKey },
        { headers: { "Cache-Control": "no-store" } }
    );
}
