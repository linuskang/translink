import type { NextRequest } from "next/server";
import { proxyToUpstream } from "@/lib/upstream";

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ stopId: string }> }
) {
    const { stopId } = await context.params;
    return proxyToUpstream(
        req,
        `/v1/seq/stops/${encodeURIComponent(stopId)}`,
        "no-cache"
    );
}
