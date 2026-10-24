import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { Context } from "hono";

export interface PrecompressedPayload {
    etag: string;
    raw: Buffer;
    br: Buffer;
    gzip: Buffer;
}

export function buildPrecompressedJson(
    data: unknown,
    etagSeed: string
): PrecompressedPayload {
    const raw = Buffer.from(JSON.stringify(data), "utf8");
    const br = brotliCompressSync(raw, {
        params: {
            [constants.BROTLI_PARAM_QUALITY]: 5,
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        },
    });
    const gzip = gzipSync(raw, { level: 6 });
    return {
        etag: `"${etagSeed}"`,
        raw,
        br,
        gzip,
    };
}

export function respondPrecompressed(
    c: Context,
    payload: PrecompressedPayload,
    cacheControl = "public, max-age=5, stale-while-revalidate=15"
): Response {
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch && ifNoneMatch.includes(payload.etag)) {
        return new Response(null, {
            status: 304,
            headers: {
                ETag: payload.etag,
                "Cache-Control": cacheControl,
                Vary: "Accept-Encoding",
            },
        });
    }

    const accept = c.req.header("accept-encoding") ?? "";
    const baseHeaders: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
        ETag: payload.etag,
        "Cache-Control": cacheControl,
        Vary: "Accept-Encoding",
        "X-Raw-Bytes": String(payload.raw.byteLength),
    };

    if (accept.includes("br")) {
        return new Response(new Uint8Array(payload.br), {
            status: 200,
            headers: {
                ...baseHeaders,
                "Content-Encoding": "br",
                "Content-Length": String(payload.br.byteLength),
            },
        });
    }

    if (accept.includes("gzip")) {
        return new Response(new Uint8Array(payload.gzip), {
            status: 200,
            headers: {
                ...baseHeaders,
                "Content-Encoding": "gzip",
                "Content-Length": String(payload.gzip.byteLength),
            },
        });
    }

    return new Response(new Uint8Array(payload.raw), {
        status: 200,
        headers: {
            ...baseHeaders,
            "Content-Length": String(payload.raw.byteLength),
        },
    });
}

export function respondCompressedJson(
    c: Context,
    data: unknown,
    options?: {
        etag?: string;
        cacheControl?: string;
    }
): Response {
    const cacheControl =
        options?.cacheControl ?? "public, max-age=5, stale-while-revalidate=15";
    const etag = options?.etag
        ? `"${options.etag.replace(/"/g, "")}"`
        : undefined;

    if (etag) {
        const ifNoneMatch = c.req.header("if-none-match");
        if (ifNoneMatch && ifNoneMatch.includes(etag)) {
            return new Response(null, {
                status: 304,
                headers: {
                    ETag: etag,
                    "Cache-Control": cacheControl,
                    Vary: "Accept-Encoding",
                },
            });
        }
    }

    const raw = Buffer.from(JSON.stringify(data), "utf8");
    const accept = c.req.header("accept-encoding") ?? "";
    const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": cacheControl,
        Vary: "Accept-Encoding",
        "X-Raw-Bytes": String(raw.byteLength),
    };
    if (etag) headers.ETag = etag;

    if (raw.byteLength >= 512 && accept.includes("br")) {
        const br = brotliCompressSync(raw, {
            params: {
                [constants.BROTLI_PARAM_QUALITY]: 4,
                [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            },
        });
        return new Response(new Uint8Array(br), {
            status: 200,
            headers: {
                ...headers,
                "Content-Encoding": "br",
                "Content-Length": String(br.byteLength),
            },
        });
    }

    if (raw.byteLength >= 512 && accept.includes("gzip")) {
        const gz = gzipSync(raw, { level: 6 });
        return new Response(new Uint8Array(gz), {
            status: 200,
            headers: {
                ...headers,
                "Content-Encoding": "gzip",
                "Content-Length": String(gz.byteLength),
            },
        });
    }

    return new Response(new Uint8Array(raw), {
        status: 200,
        headers: {
            ...headers,
            "Content-Length": String(raw.byteLength),
        },
    });
}
