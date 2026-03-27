"use client";

import { BellRing, CircleCheck, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

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

export function PushControls() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busyEnable, setBusyEnable] = useState(false);
  const [busyTest, setBusyTest] = useState(false);

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const supported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Boolean(publicKey);

  const refreshState = useCallback(async () => {
    if (!supported) return;
    setPermission(Notification.permission);
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      setSubscribed(Boolean(current));
    } catch {
      setSubscribed(false);
    }
  }, [supported]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  async function handleEnablePush() {
    if (!supported) {
      toast.error("Push notifications are not supported on this device/browser.");
      return;
    }

    setBusyEnable(true);
    try {
      let currentPermission = Notification.permission;
      if (currentPermission !== "granted") {
        currentPermission = await Notification.requestPermission();
      }

      if (currentPermission !== "granted") {
        toast.error("Notification permission was not granted.");
        await refreshState();
        return;
      }

      const registration = await navigator.serviceWorker.ready;
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
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Failed to register push subscription.");
      }

      toast.success("Push notifications enabled for this device.");
      await refreshState();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to enable push notifications.");
    } finally {
      setBusyEnable(false);
    }
  }

  async function handleSendTest() {
    if (!supported) {
      toast.error("Push notifications are not supported on this device/browser.");
      return;
    }

    setBusyTest(true);
    try {
      const response = await fetch("/api/push/test", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            push?: { sent?: number };
          }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Failed to send test notification.");
      }

      const sentCount = payload?.push?.sent ?? 0;
      if (sentCount > 0) {
        toast.success("Test push sent to this device.");
      } else {
        toast.message("Test in-app notification created. Push may be disabled or not configured.");
      }
      await refreshState();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send test notification.");
    } finally {
      setBusyTest(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Device Push Notifications</CardTitle>
          <CardDescription>
            Enable push for this browser/device and run a delivery test.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant={supported ? "success" : "default"}>
              {supported ? "Supported" : "Not supported"}
            </Badge>
            <Badge variant={permission === "granted" ? "success" : "default"}>
              Permission: {permission}
            </Badge>
            <Badge variant={subscribed ? "success" : "default"}>
              {subscribed ? "Subscribed" : "Not subscribed"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={handleEnablePush} disabled={busyEnable}>
            {busyEnable ? (
              <>
                <CircleCheck className="mr-2 h-4 w-4 animate-pulse" />
                Enabling...
              </>
            ) : (
              <>
                <BellRing className="mr-2 h-4 w-4" />
                Enable Push
              </>
            )}
          </Button>
          <Button type="button" onClick={handleSendTest} disabled={busyTest}>
            {busyTest ? (
              <>
                <Send className="mr-2 h-4 w-4 animate-pulse" />
                Sending test...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Test Push
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

