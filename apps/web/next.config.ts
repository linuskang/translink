import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
    output: "standalone",
    outputFileTracingRoot: repoRoot,
};

export default nextConfig;
