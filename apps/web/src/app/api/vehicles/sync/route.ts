import type { NextRequest } from "next/server";
import { proxyToUpstream } from "@/lib/upstream";

export async function GET(req: NextRequest) {
    return proxyToUpstream(req, "/v1/seq/vehicles/sync", "no-cache");
}
