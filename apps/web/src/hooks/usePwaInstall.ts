"use client";

import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function detectStandalone(): boolean {
    if (typeof window === "undefined") return false;
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        Boolean(
            (window.navigator as Navigator & { standalone?: boolean })
                .standalone
        )
    );
}

function detectIosSafari(): boolean {
    if (typeof window === "undefined") return false;
    const ua = window.navigator.userAgent;
    const ios =
        /iPad|iPhone|iPod/.test(ua) ||
        (window.navigator.platform === "MacIntel" &&
            window.navigator.maxTouchPoints > 1);
    const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return ios && webkit;
}

export function usePwaInstall() {
    const [deferredPrompt, setDeferredPrompt] =
        useState<BeforeInstallPromptEvent | null>(null);
    const [isStandalone, setIsStandalone] = useState<boolean>(detectStandalone);
    const [isIosWebkit] = useState<boolean>(detectIosSafari);

    useEffect(() => {
        if (typeof window === "undefined") return;

        if ("serviceWorker" in navigator) {
            navigator.serviceWorker
                .register("/sw.js", { scope: "/" })
                .catch((err) => {
                    console.warn("SW registration skipped:", err);
                });
        }

        const mq = window.matchMedia("(display-mode: standalone)");
        const onDisplayModeChange = (e: MediaQueryListEvent) => {
            setIsStandalone(e.matches);
        };
        const onBeforeInstall = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
        };
        const onInstalled = () => {
            setDeferredPrompt(null);
            setIsStandalone(true);
        };

        mq.addEventListener("change", onDisplayModeChange);
        window.addEventListener("beforeinstallprompt", onBeforeInstall);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            mq.removeEventListener("change", onDisplayModeChange);
            window.removeEventListener("beforeinstallprompt", onBeforeInstall);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, []);

    const promptInstall = useCallback(async () => {
        if (!deferredPrompt) return false;
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
            setDeferredPrompt(null);
            return true;
        }
        return false;
    }, [deferredPrompt]);

    return {
        canPromptInstall: Boolean(deferredPrompt) && !isStandalone,
        isIosSafari: isIosWebkit && !isStandalone,
        isStandalone,
        promptInstall,
    };
}
