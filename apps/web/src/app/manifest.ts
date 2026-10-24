import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Translink SEQ Live",
        short_name: "Translink",
        description:
            "Real-time South East Queensland bus, train, ferry, and tram positions, routes, and live arrivals",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#0c0c0e",
        theme_color: "#0c0c0e",
        categories: ["navigation", "travel", "utilities"],
        icons: [
            {
                src: "/icon-192.png",
                sizes: "192x192",
                type: "image/png",
                purpose: "any",
            },
            {
                src: "/icon-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
            },
            {
                src: "/icon-maskable-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
            },
            {
                src: "/icon.svg",
                sizes: "any",
                type: "image/svg+xml",
                purpose: "any",
            },
        ],
    };
}
