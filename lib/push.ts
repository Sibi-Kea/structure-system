import webpush from "web-push";

import { db } from "@/lib/db";

type BrowserPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
};

function getPushConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() ?? "mailto:admin@crc-reporting.local";
  return {
    publicKey,
    privateKey,
    subject,
    configured: Boolean(publicKey && privateKey),
  };
}

let vapidConfigured = false;

function ensureVapidConfigured() {
  if (vapidConfigured) return getPushConfig().configured;
  const config = getPushConfig();
  if (!config.configured) return false;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  vapidConfigured = true;
  return true;
}

export function getPublicVapidKey() {
  return getPushConfig().publicKey;
}

export function normalizePushSubscription(input: BrowserPushSubscription | null | undefined) {
  const endpoint = input?.endpoint?.trim() ?? "";
  const p256dh = input?.keys?.p256dh?.trim() ?? "";
  const auth = input?.keys?.auth?.trim() ?? "";
  if (!endpoint || !p256dh || !auth) {
    return null;
  }
  return {
    endpoint,
    p256dh,
    auth,
    expiresAt:
      typeof input?.expirationTime === "number" && Number.isFinite(input.expirationTime)
        ? new Date(input.expirationTime)
        : null,
  };
}

export async function savePushSubscription(input: {
  churchId: string;
  userId: string;
  userAgent?: string | null;
  subscription: BrowserPushSubscription;
}) {
  const normalized = normalizePushSubscription(input.subscription);
  if (!normalized) {
    return { success: false as const, message: "Invalid push subscription payload." };
  }

  await db.pushSubscription.upsert({
    where: { endpoint: normalized.endpoint },
    update: {
      churchId: input.churchId,
      userId: input.userId,
      p256dh: normalized.p256dh,
      auth: normalized.auth,
      userAgent: input.userAgent ?? null,
      expiresAt: normalized.expiresAt,
    },
    create: {
      churchId: input.churchId,
      userId: input.userId,
      endpoint: normalized.endpoint,
      p256dh: normalized.p256dh,
      auth: normalized.auth,
      userAgent: input.userAgent ?? null,
      expiresAt: normalized.expiresAt,
    },
  });

  return { success: true as const };
}

export async function removePushSubscription(input: {
  churchId: string;
  userId: string;
  endpoint: string;
}) {
  const endpoint = input.endpoint.trim();
  if (!endpoint) {
    return { success: false as const, message: "Endpoint is required." };
  }

  await db.pushSubscription.deleteMany({
    where: {
      churchId: input.churchId,
      userId: input.userId,
      endpoint,
    },
  });

  return { success: true as const };
}

export async function sendPushToUsers(input: {
  churchId: string;
  userIds: string[];
  payload: PushPayload;
}) {
  if (!ensureVapidConfigured() || input.userIds.length === 0) {
    return { sent: 0, failed: 0, removed: 0 };
  }

  const subscriptions = await db.pushSubscription.findMany({
    where: {
      churchId: input.churchId,
      userId: { in: input.userIds },
    },
    select: {
      endpoint: true,
      p256dh: true,
      auth: true,
    },
  });

  let sent = 0;
  let failed = 0;
  const staleEndpoints: string[] = [];
  const payload = JSON.stringify({
    title: input.payload.title,
    body: input.payload.body,
    url: input.payload.url ?? "/dashboard/notifications",
    tag: input.payload.tag ?? "crc-notification",
    icon: input.payload.icon ?? "/icons/icon-192.png",
  });

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload,
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode?: number }).statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        staleEndpoints.push(subscription.endpoint);
      }
    }
  }

  if (staleEndpoints.length > 0) {
    await db.pushSubscription.deleteMany({
      where: {
        endpoint: { in: staleEndpoints },
      },
    });
  }

  return { sent, failed, removed: staleEndpoints.length };
}

