import type { NextRequest } from "next/server";
import { proxyToUpstream } from "@/lib/upstream";

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ routeKey: string }> }
) {
    const { routeKey } = await context.params;
    return proxyToUpstream(
        req,
        `/v1/seq/routes/${encodeURIComponent(routeKey)}`,
        "public, max-age=10, stale-while-revalidate=20"
    );
}
