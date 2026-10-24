import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { NextRequest } from "next/server";

export function getUpstreamApiBase(): string {
    if (process.env.API_BASE_URL) {
        return process.env.API_BASE_URL.replace(/\/+$/, "");
    }
    const legacy = process.env.VEHICLE_API_URL;
    if (legacy) {
        const idx = legacy.indexOf("/v1/");
        if (idx !== -1) {
            return legacy.slice(0, idx);
        }
        return legacy.replace(/\/+$/, "");
    }
    return "http://localhost:8000";
}

export async function proxyToUpstream(
    req: NextRequest,
    upstreamPath: string,
    cacheControl = "no-cache"
): Promise<Response> {
    const base = getUpstreamApiBase();
    const search = req.nextUrl.search || "";
    const targetUrl = `${base}${upstreamPath}${search}`;

    const upstreamHeaders: Record<string, string> = {};
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch) {
        upstreamHeaders["If-None-Match"] = ifNoneMatch;
    }

    let upstreamRes: Response;
    try {
        upstreamRes = await fetch(targetUrl, {
            headers: upstreamHeaders,
            cache: "no-store",
        });
    } catch {
        return Response.json(
            { error: "Upstream transit API unavailable" },
            { status: 502 }
        );
    }

    const etag = upstreamRes.headers.get("etag");
    if (upstreamRes.status === 304) {
        const headers: Record<string, string> = {
            "Cache-Control": cacheControl,
            Vary: "Accept-Encoding",
        };
        if (etag) headers.ETag = etag;
        return new Response(null, { status: 304, headers });
    }

    const rawBuf = Buffer.from(await upstreamRes.arrayBuffer());
    if (!upstreamRes.ok) {
        return new Response(new Uint8Array(rawBuf), {
            status: upstreamRes.status,
            headers: {
                "Content-Type":
                    upstreamRes.headers.get("content-type") ??
                    "application/json; charset=utf-8",
            },
        });
    }

    const acceptEncoding = req.headers.get("accept-encoding") ?? "";
    const resHeaders: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": cacheControl,
        Vary: "Accept-Encoding",
        "X-Raw-Bytes": String(rawBuf.byteLength),
    };
    if (etag) resHeaders.ETag = etag;

    if (rawBuf.byteLength >= 512 && acceptEncoding.includes("br")) {
        const compressed = brotliCompressSync(rawBuf, {
            params: {
                [constants.BROTLI_PARAM_QUALITY]: 5,
                [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            },
        });
        return new Response(new Uint8Array(compressed), {
            status: 200,
            headers: {
                ...resHeaders,
                "Content-Encoding": "br",
                "Content-Length": String(compressed.byteLength),
            },
        });
    }

    if (rawBuf.byteLength >= 512 && acceptEncoding.includes("gzip")) {
        const compressed = gzipSync(rawBuf, { level: 6 });
        return new Response(new Uint8Array(compressed), {
            status: 200,
            headers: {
                ...resHeaders,
                "Content-Encoding": "gzip",
                "Content-Length": String(compressed.byteLength),
            },
        });
    }

    return new Response(new Uint8Array(rawBuf), {
        status: 200,
        headers: {
            ...resHeaders,
            "Content-Length": String(rawBuf.byteLength),
        },
    });
}
