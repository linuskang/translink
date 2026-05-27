import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
    title: "seq",
    description: "view the world through one unified interface. by linus.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            className={`${GeistSans.className} dark h-full antialiased`}
        >
            <body className="h-full bg-black text-white">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
