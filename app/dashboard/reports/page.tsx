import { subWeeks } from "date-fns";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { resolveAttendanceScope } from "@/lib/attendance-scope";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";
import { formatPercent } from "@/lib/utils";

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

export default async function ReportsPage() {
  const context = await requireChurchContext();
  const churchId = assertChurch(context.churchId);

  if (!hasPermission(context.role, "homecell_reports:view")) {
    return (
      <Card>
        <CardTitle>Summary Access Restricted</CardTitle>
        <CardDescription className="mt-1">Your role does not include summary access.</CardDescription>
      </Card>
    );
  }

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
  const reportWindowStart = subWeeks(new Date(), 8);

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
        weekStartDate: { gte: reportWindowStart },
        ...(scope.isFullAccess ? {} : { homecellId: { in: scopedHomecellIds } }),
      },
      select: {
        id: true,
        homecellId: true,
        totalMembers: true,
        membersPresent: true,
        membersAbsent: true,
        homecell: { select: { name: true } },
        memberItems: {
          select: {
            homecellPresent: true,
            homecellAbsenceReason: true,
            absenceReason: true,
          },
        },
      },
      orderBy: { weekStartDate: "desc" },
    }),
    db.attendanceRecord.findMany({
      where: {
        churchId,
        service: {
          eventDate: { gte: reportWindowStart },
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
  const homecellRowsMap = new Map<
    string,
    {
      homecellName: string;
      present: number;
      absent: number;
      total: number;
      reasons: Map<string, number>;
    }
  >();
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

  let homecellPresentTotal = 0;
  let homecellAbsentTotal = 0;
  let homecellMembersTotal = 0;

  for (const report of homecellReports) {
    const homecellKey = report.homecellId;
    const existing = homecellRowsMap.get(homecellKey) ?? {
      homecellName: report.homecell.name,
      present: 0,
      absent: 0,
      total: 0,
      reasons: new Map<string, number>(),
    };

    existing.present += report.membersPresent;
    existing.absent += report.membersAbsent;
    existing.total += report.totalMembers;
    homecellRowsMap.set(homecellKey, existing);

    homecellPresentTotal += report.membersPresent;
    homecellAbsentTotal += report.membersAbsent;
    homecellMembersTotal += report.totalMembers;

    for (const item of report.memberItems) {
      if (item.homecellPresent !== false) continue;
      const reason = normalizeReason(item.homecellAbsenceReason ?? item.absenceReason);
      homecellReasons.set(reason, (homecellReasons.get(reason) ?? 0) + 1);
      existing.reasons.set(reason, (existing.reasons.get(reason) ?? 0) + 1);
    }
  }

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
  const homecellCoverageRate = homecellsTotal
    ? (new Set(homecellReports.map((report) => report.homecellId)).size / homecellsTotal) * 100
    : 0;

  const homecellReasonRows = mapToReasonRows(homecellReasons, 10);
  const churchReasonRows = mapToReasonRows(churchReasons, 10);

  const homecellRows: HomecellRow[] = Array.from(homecellRowsMap.values())
    .map((row) => ({
      homecellName: row.homecellName,
      present: row.present,
      absent: row.absent,
      total: row.total,
      attendanceRate: row.total ? (row.present / row.total) * 100 : 0,
      topReason: topReasonLabel(row.reasons),
    }))
    .sort((a, b) => b.attendanceRate - a.attendanceRate || a.homecellName.localeCompare(b.homecellName));

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
        <CardTitle>Attendance Summary Report</CardTitle>
        <CardDescription className="mt-1">
          Reporting-team view of homecell and church attendance, including absent-reason breakdowns (last 8 weeks).
        </CardDescription>
        <p className="mt-2 text-sm text-slate-600">
          Scope:{" "}
          <span className="font-medium">
            {scope.isFullAccess ? "Full church view" : `${scope.homecellIds.length} homecell(s) under your structure`}
          </span>
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
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
            Present/Online {churchPresentTotal} | Absent {churchAbsentTotal} | Total {churchAttendanceTotal}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Report Coverage</p>
          <p className="mt-1 text-2xl font-semibold text-indigo-700">{formatPercent(homecellCoverageRate)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Submitted homecells {new Set(homecellReports.map((report) => report.homecellId)).size}/{homecellsTotal}
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
              <p className="text-sm text-slate-500">No homecell absence reasons captured yet.</p>
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
              <p className="text-sm text-slate-500">No church absence reasons captured yet.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle>Homecell Attendance Breakdown</CardTitle>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Homecell</TableHeaderCell>
                  <TableHeaderCell className="text-right">Present</TableHeaderCell>
                  <TableHeaderCell className="text-right">Absent</TableHeaderCell>
                  <TableHeaderCell className="text-right">Total</TableHeaderCell>
                  <TableHeaderCell className="text-right">Rate</TableHeaderCell>
                  <TableHeaderCell>Top Absence Reason</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {homecellRows.slice(0, 12).map((row) => (
                  <TableRow key={row.homecellName}>
                    <TableCell>{row.homecellName}</TableCell>
                    <TableCell className="text-right">{row.present}</TableCell>
                    <TableCell className="text-right">{row.absent}</TableCell>
                    <TableCell className="text-right">{row.total}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.attendanceRate)}</TableCell>
                    <TableCell>{row.topReason}</TableCell>
                  </TableRow>
                ))}
                {homecellRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-slate-500">
                      No homecell report data in this window.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card>
          <CardTitle>Church Attendance Breakdown</CardTitle>
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
                {serviceRows.slice(0, 12).map((row) => (
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
                      No church attendance records in this window.
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
