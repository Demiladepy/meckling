"use client";

import { useEffect } from "react";

/** Registers /sw.js so the app is installable as a PWA (iOS home screen, Android install). */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err: unknown) => {
      console.error("Service worker registration failed", err);
    });
  }, []);
  return null;
}
