import { format } from "date-fns";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { resolveAttendanceScope } from "@/lib/attendance-scope";
import { db } from "@/lib/db";
import { getWeeklyReportingTimeline, toDateKey } from "@/lib/reporting-deadlines";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";
import { formatCurrency, formatPercent } from "@/lib/utils";

type SearchParams = {
  date?: string;
};

type ReasonRow = {
  reason: string;
  count: number;
};

type HomecellRow = {
  homecellName: string;
  present: number;
  absent: number;
  total: number;
  attendanceRate: number;
  visitors: number;
  firstTimeVisitors: number;
  offeringLabel: string;
  topReason: string;
};

type ServiceRow = {
  serviceTitle: string;
  present: number;
  online: number;
  absent: number;
  total: number;
  attendanceRate: number;
  topReason: string;
};

function parseDateParam(value: string | undefined) {
  const now = new Date();
  const fallback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

function normalizeReason(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Unspecified";
}

function mapToReasonRows(reasonMap: Map<string, number>, limit = 8): ReasonRow[] {
  return Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}

function topReasonLabel(reasonMap: Map<string, number>) {
  const topReason = mapToReasonRows(reasonMap, 1)[0];
  return topReason ? `${topReason.reason} (${topReason.count})` : "-";
}

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireChurchContext();
  const churchId = assertChurch(context.churchId);
  const params = await searchParams;

  if (!hasPermission(context.role, "homecell_reports:view")) {
    return (
      <Card>
        <CardTitle>Summary Access Restricted</CardTitle>
        <CardDescription className="mt-1">Your role does not include summary access.</CardDescription>
      </Card>
    );
  }

  const selectedDate = parseDateParam(params.date);
  const timeline = getWeeklyReportingTimeline(selectedDate);
  const weekStart = timeline.weekStartDate;
  const weekEnd = timeline.weekEndDate;
  const weekEndExclusive = new Date(weekEnd);
  weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 1);

  const scope = await resolveAttendanceScope({
    churchId,
    userId: context.userId,
    role: context.role,
  });
  const scopedHomecellIds = scope.isFullAccess
    ? []
    : scope.homecellIds.length > 0
      ? scope.homecellIds
      : ["__no_scope__"];

  const [homecellsTotal, homecellReports, attendanceRecords] = await Promise.all([
    db.homecell.count({
      where: {
        churchId,
        ...(scope.isFullAccess ? {} : { id: { in: scopedHomecellIds } }),
      },
    }),
    db.homecellReport.findMany({
      where: {
        churchId,
        weekStartDate: weekStart,
        ...(scope.isFullAccess ? {} : { homecellId: { in: scopedHomecellIds } }),
      },
      select: {
        id: true,
        homecellId: true,
        totalMembers: true,
        membersPresent: true,
        membersAbsent: true,
        visitors: true,
        firstTimeVisitors: true,
        offeringCollected: true,
        homecell: { select: { name: true } },
        memberItems: {
          select: {
            homecellPresent: true,
            homecellAbsenceReason: true,
            absenceReason: true,
          },
        },
      },
      orderBy: {
        homecell: {
          name: "asc",
        },
      },
    }),
    db.attendanceRecord.findMany({
      where: {
        churchId,
        service: {
          eventDate: {
            gte: weekStart,
            lt: weekEndExclusive,
          },
        },
        ...(scope.isFullAccess
          ? {}
          : {
              entries: {
                some: {
                  member: {
                    homecellId: { in: scopedHomecellIds },
                  },
                },
              },
            }),
      },
      include: {
        entries: {
          where: scope.isFullAccess
            ? undefined
            : {
                member: {
                  homecellId: { in: scopedHomecellIds },
                },
              },
          select: {
            status: true,
            absentReason: true,
          },
        },
        service: {
          select: {
            title: true,
          },
        },
      },
      orderBy: {
        service: {
          eventDate: "asc",
        },
      },
    }),
  ]);

  const homecellReasons = new Map<string, number>();
  const churchReasons = new Map<string, number>();
  const serviceRowsMap = new Map<
    string,
    {
      serviceTitle: string;
      present: number;
      online: number;
      absent: number;
      total: number;
      reasons: Map<string, number>;
    }
  >();

  const homecellPresentTotal = homecellReports.reduce((sum, report) => sum + report.membersPresent, 0);
  const homecellAbsentTotal = homecellReports.reduce((sum, report) => sum + report.membersAbsent, 0);
  const homecellMembersTotal = homecellReports.reduce((sum, report) => sum + report.totalMembers, 0);
  const homecellVisitorsTotal = homecellReports.reduce((sum, report) => sum + report.visitors, 0);
  const homecellFirstTimeVisitorsTotal = homecellReports.reduce((sum, report) => sum + report.firstTimeVisitors, 0);
  const offeringCollectedTotal = homecellReports.reduce(
    (sum, report) => sum + Number(report.offeringCollected ?? 0),
    0,
  );

  for (const report of homecellReports) {
    for (const item of report.memberItems) {
      if (item.homecellPresent !== false) continue;
      const reason = normalizeReason(item.homecellAbsenceReason ?? item.absenceReason);
      homecellReasons.set(reason, (homecellReasons.get(reason) ?? 0) + 1);
    }
  }

  const homecellRows: HomecellRow[] = homecellReports.map((report) => {
    const reasons = new Map<string, number>();

    for (const item of report.memberItems) {
      if (item.homecellPresent !== false) continue;
      const reason = normalizeReason(item.homecellAbsenceReason ?? item.absenceReason);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }

    return {
      homecellName: report.homecell.name,
      present: report.membersPresent,
      absent: report.membersAbsent,
      total: report.totalMembers,
      attendanceRate: report.totalMembers ? (report.membersPresent / report.totalMembers) * 100 : 0,
      visitors: report.visitors,
      firstTimeVisitors: report.firstTimeVisitors,
      offeringLabel: formatCurrency(Number(report.offeringCollected ?? 0)),
      topReason: topReasonLabel(reasons),
    };
  });

  let churchPresentTotal = 0;
  let churchOnlineTotal = 0;
  let churchAbsentTotal = 0;
  let churchAttendanceTotal = 0;

  for (const record of attendanceRecords) {
    const serviceTitle = record.service.title.trim() || "Untitled Service";
    const existing = serviceRowsMap.get(serviceTitle) ?? {
      serviceTitle,
      present: 0,
      online: 0,
      absent: 0,
      total: 0,
      reasons: new Map<string, number>(),
    };

    for (const entry of record.entries) {
      existing.total += 1;
      churchAttendanceTotal += 1;

      if (entry.status === "ONLINE") {
        existing.present += 1;
        existing.online += 1;
        churchPresentTotal += 1;
        churchOnlineTotal += 1;
      } else if (entry.status === "PRESENT") {
        existing.present += 1;
        churchPresentTotal += 1;
      } else {
        existing.absent += 1;
        churchAbsentTotal += 1;
        const reason = normalizeReason(entry.absentReason);
        churchReasons.set(reason, (churchReasons.get(reason) ?? 0) + 1);
        existing.reasons.set(reason, (existing.reasons.get(reason) ?? 0) + 1);
      }
    }

    serviceRowsMap.set(serviceTitle, existing);
  }

  const homecellAttendanceRate = homecellMembersTotal ? (homecellPresentTotal / homecellMembersTotal) * 100 : 0;
  const churchAttendanceRate = churchAttendanceTotal ? (churchPresentTotal / churchAttendanceTotal) * 100 : 0;
  const submittedHomecells = homecellReports.length;
  const homecellCoverageRate = homecellsTotal ? (submittedHomecells / homecellsTotal) * 100 : 0;

  const homecellReasonRows = mapToReasonRows(homecellReasons, 8);
  const churchReasonRows = mapToReasonRows(churchReasons, 8);
  const serviceRows: ServiceRow[] = Array.from(serviceRowsMap.values())
    .map((row) => ({
      serviceTitle: row.serviceTitle,
      present: row.present,
      online: row.online,
      absent: row.absent,
      total: row.total,
      attendanceRate: row.total ? (row.present / row.total) * 100 : 0,
      topReason: topReasonLabel(row.reasons),
    }))
    .sort((a, b) => b.total - a.total || a.serviceTitle.localeCompare(b.serviceTitle));

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>Weekly Summary</CardTitle>
        <CardDescription className="mt-1">
          Pastor view of weekly homecell reporting and church attendance performance.
        </CardDescription>
        <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <p className="mb-1 text-xs text-slate-500">Pick any date in week</p>
            <input
              type="date"
              name="date"
              defaultValue={toDateKey(selectedDate)}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700"
          >
            Load week
          </button>
          <p className="text-sm text-slate-600">
            Week:{" "}
            <span className="font-medium">
              {format(weekStart, "yyyy-MM-dd")} to {format(weekEnd, "yyyy-MM-dd")}
            </span>
          </p>
        </form>
        <p className="mt-2 text-sm text-slate-600">
          Scope:{" "}
          <span className="font-medium">
            {scope.isFullAccess ? "Full church view" : `${scope.homecellIds.length} homecell(s) under your structure`}
          </span>
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-sm text-slate-500">Homecell Attendance</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{formatPercent(homecellAttendanceRate)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Present {homecellPresentTotal} | Absent {homecellAbsentTotal} | Total {homecellMembersTotal}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Church Attendance</p>
          <p className="mt-1 text-2xl font-semibold text-sky-700">{formatPercent(churchAttendanceRate)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Present/Online {churchPresentTotal} | Online {churchOnlineTotal} | Absent {churchAbsentTotal} | Total{" "}
            {churchAttendanceTotal}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Report Coverage</p>
          <p className="mt-1 text-2xl font-semibold text-indigo-700">{formatPercent(homecellCoverageRate)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Submitted homecells {submittedHomecells}/{homecellsTotal}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Visitors + Offering</p>
          <p className="mt-1 text-2xl font-semibold text-violet-700">{homecellVisitorsTotal}</p>
          <p className="mt-1 text-xs text-slate-500">
            First-time {homecellFirstTimeVisitorsTotal} | Offering {formatCurrency(offeringCollectedTotal)}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Homecell Absence Reasons</CardTitle>
          <div className="mt-3 space-y-2">
            {homecellReasonRows.length > 0 ? (
              homecellReasonRows.map((row) => (
                <div key={row.reason} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-sm text-slate-700">{row.reason}</span>
                  <span className="text-sm font-semibold text-slate-900">{row.count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No homecell absence reasons captured this week.</p>
            )}
          </div>
        </Card>
        <Card>
          <CardTitle>Church Absence Reasons</CardTitle>
          <div className="mt-3 space-y-2">
            {churchReasonRows.length > 0 ? (
              churchReasonRows.map((row) => (
                <div key={row.reason} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-sm text-slate-700">{row.reason}</span>
                  <span className="text-sm font-semibold text-slate-900">{row.count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No church absence reasons captured this week.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle>Homecell Weekly Breakdown</CardTitle>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Homecell</TableHeaderCell>
                  <TableHeaderCell className="text-right">Present</TableHeaderCell>
                  <TableHeaderCell className="text-right">Absent</TableHeaderCell>
                  <TableHeaderCell className="text-right">Total</TableHeaderCell>
                  <TableHeaderCell className="text-right">Rate</TableHeaderCell>
                  <TableHeaderCell className="text-right">Visitors</TableHeaderCell>
                  <TableHeaderCell className="text-right">Offering</TableHeaderCell>
                  <TableHeaderCell>Top Absence Reason</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {homecellRows.map((row) => (
                  <TableRow key={row.homecellName}>
                    <TableCell>{row.homecellName}</TableCell>
                    <TableCell className="text-right">{row.present}</TableCell>
                    <TableCell className="text-right">{row.absent}</TableCell>
                    <TableCell className="text-right">{row.total}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.attendanceRate)}</TableCell>
                    <TableCell className="text-right">
                      {row.firstTimeVisitors}/{row.visitors}
                    </TableCell>
                    <TableCell className="text-right">{row.offeringLabel}</TableCell>
                    <TableCell>{row.topReason}</TableCell>
                  </TableRow>
                ))}
                {homecellRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-slate-500">
                      No homecell report submissions found for this week.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card>
          <CardTitle>Church Service Breakdown</CardTitle>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell className="text-right">Present</TableHeaderCell>
                  <TableHeaderCell className="text-right">Online</TableHeaderCell>
                  <TableHeaderCell className="text-right">Absent</TableHeaderCell>
                  <TableHeaderCell className="text-right">Total</TableHeaderCell>
                  <TableHeaderCell className="text-right">Rate</TableHeaderCell>
                  <TableHeaderCell>Top Absence Reason</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {serviceRows.map((row) => (
                  <TableRow key={row.serviceTitle}>
                    <TableCell>{row.serviceTitle}</TableCell>
                    <TableCell className="text-right">{row.present}</TableCell>
                    <TableCell className="text-right">{row.online}</TableCell>
                    <TableCell className="text-right">{row.absent}</TableCell>
                    <TableCell className="text-right">{row.total}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.attendanceRate)}</TableCell>
                    <TableCell>{row.topReason}</TableCell>
                  </TableRow>
                ))}
                {serviceRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-slate-500">
                      No church attendance records found for this week.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
