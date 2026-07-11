import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

loadEnvConfig(repoRoot);

try {
    const envPath = path.join(repoRoot, ".env.local");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx);
        const val = trimmed.slice(eqIdx + 1);
        if (!(key in process.env)) {
            process.env[key] = val;
        }
    }
} catch {}

const nextConfig: NextConfig = {
    output: "standalone",
    outputFileTracingRoot: repoRoot,
};

export default nextConfig;
