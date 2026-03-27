"use client";

import { useEffect } from "react";

const PUSH_PROMPTED_KEY = "crc_push_prompted_v1";

function base64UrlToUint8Array(base64Url: string) {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob(base64 + padding);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function syncPushSubscription({
  publicKey,
  promptIfNeeded,
}: {
  publicKey: string;
  promptIfNeeded: boolean;
}) {
  const registration = await navigator.serviceWorker.ready;

  let permission = Notification.permission;
  if (
    permission === "default" &&
    promptIfNeeded &&
    !window.localStorage.getItem(PUSH_PROMPTED_KEY)
  ) {
    window.localStorage.setItem(PUSH_PROMPTED_KEY, "1");
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: existing.endpoint }),
      });
      await existing.unsubscribe();
    }
    return;
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    });
  }

  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });

  if (!response.ok) {
    throw new Error(`Failed to sync push subscription (${response.status}).`);
  }
}

export function PushProvider() {
  useEffect(() => {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return;
    }

    let cancelled = false;

    const setupPush = async (promptIfNeeded: boolean) => {
      try {
        if (cancelled) return;
        await syncPushSubscription({
          publicKey,
          promptIfNeeded,
        });
      } catch (error) {
        console.error("Push setup failed", error);
      }
    };

    void setupPush(true);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void setupPush(false);
      }
    };
    const onFocus = () => {
      void setupPush(false);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}
