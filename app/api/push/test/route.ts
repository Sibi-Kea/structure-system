import { NotificationType } from "@prisma/client";
import { NextResponse } from "next/server";

import { getServerAuthSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendPushToUsers } from "@/lib/push";

export async function POST() {
  const session = await getServerAuthSession();
  if (!session?.user?.id || !session.user.churchId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const createdAtLabel = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  const title = "Push notifications are active";
  const message = `Device push test succeeded at ${createdAtLabel}.`;

  await db.notification.create({
    data: {
      churchId: session.user.churchId,
      userId: session.user.id,
      type: NotificationType.SYSTEM,
      title,
      message,
      actionUrl: "/dashboard/notifications",
    },
  });

  const pushResult = await sendPushToUsers({
    churchId: session.user.churchId,
    userIds: [session.user.id],
    payload: {
      title,
      body: message,
      url: "/dashboard/notifications",
      tag: `push-test-${session.user.id}`,
    },
  });

  return NextResponse.json({
    success: true,
    push: pushResult,
  });
}

