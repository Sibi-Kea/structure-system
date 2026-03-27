import { format } from "date-fns";

import { HomecellMembersReportForm } from "@/components/reporting/homecell-members-report-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { resolveAttendanceScope } from "@/lib/attendance-scope";
import { db } from "@/lib/db";
import {
  getReportingDeadlineStage,
  getWeeklyReportingTimeline,
  toDateKey,
} from "@/lib/reporting-deadlines";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";

type SearchParams = {
  date?: string;
  homecellId?: string;
  tab?: string;
};

function parseDateParam(value: string | undefined) {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return todayUtc;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return todayUtc;
  return parsed;
}

export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireChurchContext();
  const churchId = assertChurch(context.churchId);
  const params = await searchParams;

  if (!hasPermission(context.role, "attendance:view")) {
    return (
      <Card>
        <CardTitle>Reporting Access Restricted</CardTitle>
        <CardDescription className="mt-1">Your role does not include weekly attendance reporting.</CardDescription>
      </Card>
    );
  }

  const scope = await resolveAttendanceScope({
    churchId,
    userId: context.userId,
    role: context.role,
  });
  const canSubmitHomecellMembers = hasPermission(context.role, "homecell_reports:submit");
  const scopedHomecellIds = scope.isFullAccess
    ? []
    : scope.homecellIds.length > 0
      ? scope.homecellIds
      : ["__no_scope__"];

  const selectedDate = parseDateParam(params.date);
  const selectedDateKey = toDateKey(selectedDate);
  const timeline = getWeeklyReportingTimeline(selectedDate);
  const weekStart = timeline.weekStartDate;
  const weekEnd = timeline.weekEndDate;
  const deadlineStage = getReportingDeadlineStage(new Date(), weekStart);
  const deadlineLocked = deadlineStage === "LOCKED";

  const homecells = await db.homecell.findMany({
    where: {
      churchId,
      ...(scope.isFullAccess ? {} : { id: { in: scopedHomecellIds } }),
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: { name: "asc" },
  });

  const selectedHomecellId = homecells.some((homecell) => homecell.id === params.homecellId)
    ? params.homecellId ?? ""
    : (homecells[0]?.id ?? "");
  const hideHomecellSelect = !scope.isFullAccess && homecells.length === 1;
  const activeHomecellName =
    homecells.find((homecell) => homecell.id === selectedHomecellId)?.name ?? "All scoped homecells";

  const [churchSettings, selectedHomecellMembers, selectedHomecellWeekReport, pendingMemberRequests] = await Promise.all([
    db.church.findUnique({
      where: { id: churchId },
      select: {
        attendanceServiceLabels: true,
        attendanceMorningServiceLabels: true,
        attendanceEveningServiceLabels: true,
        attendanceOnlineServiceLabels: true,
      },
    }),
    selectedHomecellId
      ? db.member.findMany({
          where: {
            churchId,
            homecellId: selectedHomecellId,
            isDeleted: false,
            membershipStatus: "ACTIVE",
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        })
      : Promise.resolve([]),
    selectedHomecellId
      ? db.homecellReport.findUnique({
          where: {
            churchId_homecellId_weekStartDate: {
              churchId,
              homecellId: selectedHomecellId,
              weekStartDate: weekStart,
            },
          },
          select: {
            id: true,
            isLocked: true,
            memberItems: {
              select: {
                memberId: true,
                memberName: true,
                absenceReason: true,
                absenceNote: true,
                homecellPresent: true,
                homecellAbsenceReason: true,
                homecellAbsenceNote: true,
                churchPresent: true,
                churchAttendedLabels: true,
                churchAbsenceReason: true,
                churchAbsenceNote: true,
                churchMorningPresent: true,
                churchMorningAttendedLabel: true,
                churchMorningAbsenceReason: true,
                churchMorningAbsenceNote: true,
                churchEveningPresent: true,
                churchEveningAttendedLabel: true,
                churchEveningAbsenceReason: true,
                churchEveningAbsenceNote: true,
              },
            },
          },
        })
      : Promise.resolve(null),
    selectedHomecellId
      ? db.pendingMemberRequest.findMany({
          where: {
            churchId,
            homecellId: selectedHomecellId,
            status: "PENDING",
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const serviceLabels = churchSettings?.attendanceServiceLabels ?? [];
  const serviceGroups = {
    morning: churchSettings?.attendanceMorningServiceLabels ?? [],
    evening: churchSettings?.attendanceEveningServiceLabels ?? [],
    online: churchSettings?.attendanceOnlineServiceLabels ?? [],
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-lg font-semibold text-slate-900">
              Date: <span className="font-normal">{format(selectedDate, "yyyy-MM-dd")}</span>
            </p>
            <form method="get" className="flex flex-wrap items-end gap-2">
              <div>
                <p className="mb-1 text-xs text-slate-500">Report date</p>
                <input
                  type="date"
                  name="date"
                  defaultValue={selectedDateKey}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
                />
              </div>
              {hideHomecellSelect ? (
                <input type="hidden" name="homecellId" value={selectedHomecellId} />
              ) : (
                <div>
                  <p className="mb-1 text-xs text-slate-500">Homecell(s)</p>
                  <select
                    name="homecellId"
                    defaultValue={selectedHomecellId}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100 sm:min-w-56"
                  >
                    <option value="">All scoped homecells</option>
                    {homecells.map((homecell) => (
                      <option key={homecell.id} value={homecell.id}>
                        {homecell.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700"
              >
                Apply
              </button>
            </form>
            {hideHomecellSelect ? (
              <p className="text-xs text-slate-500">Homecell: {activeHomecellName}</p>
            ) : null}
          </div>

        </div>

        <div className="mt-4">
          {selectedHomecellId ? (
            <HomecellMembersReportForm
              homecellId={selectedHomecellId}
              homecellName={activeHomecellName}
              weekStartDate={toDateKey(weekStart)}
              weekEndDate={toDateKey(weekEnd)}
              members={selectedHomecellMembers.map((member) => ({
                id: member.id,
                name: `${member.firstName} ${member.lastName}`.trim(),
              }))}
              totalMembers={selectedHomecellMembers.length}
              existingItems={selectedHomecellWeekReport?.memberItems ?? []}
              pendingMemberRequests={pendingMemberRequests.map((request) => ({
                id: request.id,
                name: `${request.firstName} ${request.lastName}`.trim(),
                phone: request.phone,
                email: request.email,
                createdAtLabel: format(request.createdAt, "yyyy-MM-dd"),
              }))}
              serviceLabels={serviceLabels}
              serviceGroups={serviceGroups}
              canSubmit={canSubmitHomecellMembers}
              isLocked={deadlineLocked || (selectedHomecellWeekReport?.isLocked ?? false)}
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No homecell is available in your scope yet. Ask admin to assign one.
            </div>
          )}
        </div>

        {selectedHomecellWeekReport || deadlineLocked ? (
          <div className="mt-4">
            {deadlineLocked || selectedHomecellWeekReport?.isLocked ? (
              <Badge variant="danger">Locked</Badge>
            ) : (
              <Badge variant="success">Unlocked</Badge>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
