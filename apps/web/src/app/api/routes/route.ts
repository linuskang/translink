import type { NextRequest } from "next/server";
import { proxyToUpstream } from "@/lib/upstream";

export async function GET(req: NextRequest) {
    return proxyToUpstream(
        req,
        "/v1/seq/routes",
        "public, max-age=15, stale-while-revalidate=30"
    );
}
