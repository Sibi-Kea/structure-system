"use client";

import { useEffect } from "react";

export function PwaProvider() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (error) {
        console.error("Failed to register service worker", error);
      }
    };

    if (process.env.NODE_ENV !== "production") {
      const cleanupLegacyCaches = async () => {
        try {
          if ("caches" in window) {
            const cacheNames = await caches.keys();
            await Promise.all(
              cacheNames
                .filter((cacheName) => cacheName.startsWith("churchflow-pwa-"))
                .map((cacheName) => caches.delete(cacheName)),
            );
          }
        } catch (error) {
          console.error("Failed to clear legacy development caches", error);
        }
      };
      void cleanupLegacyCaches().then(register);
      return;
    }

    void register();
  }, []);

  return null;
}
