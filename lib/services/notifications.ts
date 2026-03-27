import { NotificationType, Role } from "@prisma/client";
import { addDays, startOfDay } from "date-fns";

import { db } from "@/lib/db";
import { sendPushToUsers } from "@/lib/push";
import { ensureOutstandingReportNotificationForUser } from "@/lib/services/reporting-notifications";

export async function generateOperationalNotifications(churchId: string) {
  const today = startOfDay(new Date());
  const inThreeDays = addDays(today, 3);

  const users = await db.user.findMany({
    where: { churchId, isActive: true },
    select: { id: true, role: true },
  });

  const pendingVisitors = await db.visitor.count({
    where: {
      churchId,
      followUpStatus: "PENDING",
    },
  });

  const upcomingServices = await db.service.findMany({
    where: { churchId, eventDate: { gte: today, lte: inThreeDays } },
    select: { id: true, title: true, eventDate: true },
  });

  const existingToday = await db.notification.findMany({
    where: {
      churchId,
      createdAt: { gte: today },
      OR: [
        { title: "Visitor follow-up pending" },
        { title: "Service attendance reminder" },
      ],
    },
    select: {
      userId: true,
      title: true,
      message: true,
      actionUrl: true,
    },
  });
  const existingKeys = new Set(
    existingToday.map((item) => `${item.userId}|${item.title}|${item.actionUrl ?? ""}|${item.message}`),
  );

  const notifications = users.flatMap((user) => {
    const created: Array<{
      churchId: string;
      userId: string;
      type: NotificationType;
      title: string;
      message: string;
      actionUrl: string;
    }> = [];

    if (pendingVisitors > 0 && user.role !== Role.HOMECELL_LEADER) {
      const candidate = {
        churchId,
        userId: user.id,
        type: NotificationType.ALERT,
        title: "Visitor follow-up pending",
        message: `${pendingVisitors} visitor(s) still require follow-up.`,
        actionUrl: "/dashboard/visitors",
      };
      const key = `${candidate.userId}|${candidate.title}|${candidate.actionUrl}|${candidate.message}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        created.push(candidate);
      }
    }

    for (const service of upcomingServices) {
      const candidate = {
        churchId,
        userId: user.id,
        type: NotificationType.REMINDER,
        title: "Service attendance reminder",
        message: `Attendance marking for ${service.title} is due on ${service.eventDate.toDateString()}.`,
        actionUrl: `/dashboard/attendance?serviceId=${service.id}`,
      };
      const key = `${candidate.userId}|${candidate.title}|${candidate.actionUrl}|${candidate.message}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        created.push(candidate);
      }
    }

    return created;
  });

  let created = 0;

  if (notifications.length) {
    await db.notification.createMany({
      data: notifications,
    });
    created += notifications.length;

    await Promise.allSettled(
      notifications.map((notification) =>
        sendPushToUsers({
          churchId,
          userIds: [notification.userId],
          payload: {
            title: notification.title,
            body: notification.message,
            url: notification.actionUrl,
            tag: `notif-${notification.userId}-${notification.title}`,
          },
        }),
      ),
    );
  }

  const outstanding = await Promise.all(
    users.map((user) =>
      ensureOutstandingReportNotificationForUser({
        churchId,
        userId: user.id,
        role: user.role,
      }),
    ),
  );
  created += outstanding.reduce((total, item) => total + item.created, 0);

  await Promise.allSettled(
    outstanding.map((item, index) => {
      const user = users[index];
      if (!user || !item.summary || item.created <= 0) {
        return Promise.resolve(null);
      }
      return sendPushToUsers({
        churchId,
        userIds: [user.id],
        payload: {
          title: item.summary.title,
          body: item.summary.message,
          url: item.summary.actionUrl,
          tag: `outstanding-${user.id}-${item.summary.dedupeKey}`,
        },
      });
    }),
  );

  return { created };
}

