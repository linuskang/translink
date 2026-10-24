import type { NextRequest } from "next/server";
import { proxyToUpstream } from "@/lib/upstream";

export async function GET(req: NextRequest) {
    return proxyToUpstream(
        req,
        "/v1/seq/stops",
        "public, max-age=60, stale-while-revalidate=300"
    );
}
