import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geist = Geist({
    subsets: ["latin"],
    variable: "--font-geist-sans",
});

export const metadata: Metadata = {
    title: "Translink SEQ Live",
    description:
        "Real-time South East Queensland bus, train, ferry, and tram tracking with routes, directions, and live arrivals",
    applicationName: "Translink",
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "Translink",
    },
    formatDetection: {
        telephone: false,
    },
    icons: {
        icon: [
            { url: "/icon.svg", type: "image/svg+xml" },
            { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
        apple: [
            {
                url: "/apple-touch-icon.png",
                sizes: "180x180",
                type: "image/png",
            },
        ],
    },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
    themeColor: "#0c0c0e",
    colorScheme: "dark",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={geist.variable}>
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
