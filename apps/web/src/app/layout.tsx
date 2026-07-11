import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geist = Geist({
    subsets: ["latin"],
    variable: "--font-geist-sans",
});

export const metadata: Metadata = {
    title: "Translink",
    description: "Real-time SEQ transit map",
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
