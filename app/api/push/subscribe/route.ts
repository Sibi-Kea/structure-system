import { NextResponse } from "next/server";

import { getServerAuthSession } from "@/lib/auth/session";
import { removePushSubscription, savePushSubscription } from "@/lib/push";

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user?.id || !session.user.churchId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { subscription?: unknown }
    | null;

  if (!body?.subscription || typeof body.subscription !== "object") {
    return NextResponse.json({ message: "Invalid subscription payload." }, { status: 400 });
  }

  const result = await savePushSubscription({
    churchId: session.user.churchId,
    userId: session.user.id,
    userAgent: request.headers.get("user-agent"),
    subscription: body.subscription as {
      endpoint: string;
      expirationTime?: number | null;
      keys?: { p256dh?: string; auth?: string };
    },
  });

  if (!result.success) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user?.id || !session.user.churchId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  const endpoint = body?.endpoint?.trim() ?? "";
  if (!endpoint) {
    return NextResponse.json({ message: "Endpoint is required." }, { status: 400 });
  }

  const result = await removePushSubscription({
    churchId: session.user.churchId,
    userId: session.user.id,
    endpoint,
  });
  if (!result.success) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

