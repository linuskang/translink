import type { NextRequest } from "next/server";
import { proxyToUpstream } from "@/lib/upstream";

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    return proxyToUpstream(
        req,
        `/v1/seq/vehicles/${encodeURIComponent(id)}`,
        "no-cache"
    );
}
