import { Role } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ChurchSettingsForm } from "@/components/admin/church-settings-form";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireChurchContext } from "@/lib/tenant";

export default async function SettingsPage() {
  const context = await requireChurchContext();
  if (context.role !== Role.SUPER_ADMIN) {
    redirect("/dashboard");
  }

  const churches = await db.church.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      attendanceServiceLabels: true,
      attendanceMorningServiceLabels: true,
      attendanceEveningServiceLabels: true,
      attendanceOnlineServiceLabels: true,
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Settings</CardTitle>
        <CardDescription className="mt-1">
          Super admin settings for church profiles and attendance service labels.
        </CardDescription>
      </Card>

      <Card>
        <CardTitle>Zone Pastors</CardTitle>
        <CardDescription className="mt-1">
          Assign each zone to a pastor sourced from the membership list.
        </CardDescription>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/dashboard/admin/churches"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
          >
            Open Structure Settings
          </Link>
          <Link
            href="/dashboard/pastors"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-700 px-4 text-sm font-medium text-white transition hover:bg-sky-800"
          >
            Open Pastors Page
          </Link>
        </div>
      </Card>

      <Card>
        <CardTitle>Automation Jobs</CardTitle>
        <CardDescription className="mt-1">
          Scheduled operations are configured for notifications and monthly LTV refresh.
        </CardDescription>
        <div className="mt-4 space-y-2 text-sm text-slate-700">
          <p>
            Notifications cron: <span className="font-medium">daily 05:00 UTC</span> via{" "}
            <code>/api/cron/notifications</code>
          </p>
          <p>
            LTV cron: <span className="font-medium">monthly on day 1 at 05:30 UTC</span> via{" "}
            <code>/api/cron/ltv</code>
          </p>
          <p className="text-xs text-slate-500">Both cron routes require the `CRON_SECRET` bearer token.</p>
        </div>
      </Card>

      <ChurchSettingsForm churches={churches} currentChurchId={context.churchId ?? null} />
    </div>
  );
}
