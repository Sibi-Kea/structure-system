import Link from "next/link";
import { Activity, Bell, Building2, DollarSign, Users, UserRoundPlus } from "lucide-react";
import { AttendanceStatus, Role } from "@prisma/client";
import { format } from "date-fns";

import { DashboardCalendarSummary } from "@/components/dashboard/calendar-summary";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { resolveAttendanceScope } from "@/lib/attendance-scope";
import { db } from "@/lib/db";
import { getWeeklyReportingTimeline } from "@/lib/reporting-deadlines";
import { getAttendanceTrend, getDashboardMetrics } from "@/lib/services/dashboard";
import { assertChurch, requireChurchContext } from "@/lib/tenant";
import { formatCurrency, formatPercent } from "@/lib/utils";

type SearchParams = {
  statsMonth?: string;
};

function parseStatsMonth(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(year, monthIndex, 1));
}

function monthWindow(monthStartUtc: Date) {
  const start = new Date(Date.UTC(monthStartUtc.getUTCFullYear(), monthStartUtc.getUTCMonth(), 1));
  const end = new Date(Date.UTC(monthStartUtc.getUTCFullYear(), monthStartUtc.getUTCMonth() + 1, 1));
  return { start, end };
}

function buildCalendarDays(monthStartUtc: Date) {
  const monthEnd = new Date(Date.UTC(monthStartUtc.getUTCFullYear(), monthStartUtc.getUTCMonth() + 1, 0));
  const gridStart = new Date(monthStartUtc);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());
  const gridEnd = new Date(monthEnd);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  const days: Date[] = [];
  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(new Date(cursor));
  }
  return days;
}

function attendanceRateFromStatusRows(rows: Array<{ status: AttendanceStatus; _count: { _all: number } }>) {
  const total = rows.reduce((sum, row) => sum + row._count._all, 0);
  const present = rows.reduce((sum, row) => {
    if (row.status === "PRESENT" || row.status === "ONLINE") return sum + row._count._all;
    return sum;
  }, 0);

  return {
    present,
    total,
    rate: total ? (present / total) * 100 : 0,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireChurchContext();
  const params = await searchParams;
  const selectedMonthDate = parseStatsMonth(params.statsMonth);
  const selectedMonthWindow = monthWindow(selectedMonthDate);
  const selectedMonth = format(selectedMonthDate, "yyyy-MM");
  const selectedMonthLabel = format(selectedMonthDate, "MMMM yyyy");

  if (context.role === Role.SUPER_ADMIN && !context.churchId) {
    const [churches, users, members] = await Promise.all([
      db.church.count(),
      db.user.count(),
      db.member.count({ where: { isDeleted: false } }),
    ]);

    const latestChurches = await db.church.findMany({
      take: 8,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, slug: true, createdAt: true },
    });

    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Total Churches" value={churches} icon={Building2} />
          <StatCard label="Total Staff Users" value={users} icon={Users} />
          <StatCard label="Total Members" value={members} icon={Activity} />
        </div>
        <Card>
          <CardTitle>Recent Church Onboarding</CardTitle>
          <CardDescription className="mt-1">Super admin visibility across all tenants.</CardDescription>
          <div className="mt-4 space-y-2">
            {latestChurches.map((church) => (
              <div
                key={church.id}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
              >
                <span className="font-medium text-slate-700">{church.name}</span>
                <span className="text-slate-500">{church.slug}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const churchId = assertChurch(context.churchId);
  const weekTimeline = getWeeklyReportingTimeline(new Date());
  const weekStart = weekTimeline.weekStartDate;

  if (context.role === Role.HOMECELL_LEADER) {
    const scope = await resolveAttendanceScope({
      churchId,
      userId: context.userId,
      role: context.role,
    });
    const scopedHomecellIds = Array.from(new Set(scope.homecellIds)).sort((a, b) => a.localeCompare(b));
    const whereScopeIds = scopedHomecellIds.length > 0 ? scopedHomecellIds : ["__no_scope__"];

    const [
      homecellsLedDirectly,
      scopedHomecells,
      activeMembersInScope,
      totalMembersInScope,
      pendingRequestsCount,
      pendingRequests,
      weekReports,
      recentReports,
      monthStatusRows,
    ] = await Promise.all([
      db.homecell.findMany({
        where: { churchId, leaderId: context.userId },
        select: {
          id: true,
          name: true,
          zone: { select: { name: true } },
          region: { select: { name: true } },
          _count: { select: { members: true } },
        },
        orderBy: { name: "asc" },
      }),
      db.homecell.findMany({
        where: { churchId, id: { in: whereScopeIds } },
        select: {
          id: true,
          name: true,
          zone: { select: { name: true } },
          region: { select: { name: true } },
          _count: { select: { members: true } },
        },
        orderBy: { name: "asc" },
      }),
      db.member.count({
        where: {
          churchId,
          isDeleted: false,
          membershipStatus: "ACTIVE",
          homecellId: { in: whereScopeIds },
        },
      }),
      db.member.count({
        where: {
          churchId,
          isDeleted: false,
          homecellId: { in: whereScopeIds },
        },
      }),
      db.pendingMemberRequest.count({
        where: {
          churchId,
          status: "PENDING",
          homecellId: { in: whereScopeIds },
        },
      }),
      db.pendingMemberRequest.findMany({
        where: {
          churchId,
          status: "PENDING",
          homecellId: { in: whereScopeIds },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          homecell: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 8,
      }),
      db.homecellReport.findMany({
        where: {
          churchId,
          weekStartDate: weekStart,
          homecellId: { in: whereScopeIds },
        },
        select: {
          id: true,
          homecellId: true,
          membersPresent: true,
          totalMembers: true,
          visitors: true,
          firstTimeVisitors: true,
          isLocked: true,
        },
      }),
      db.homecellReport.findMany({
        where: {
          churchId,
          homecellId: { in: whereScopeIds },
        },
        select: {
          id: true,
          weekStartDate: true,
          membersPresent: true,
          totalMembers: true,
          visitors: true,
          firstTimeVisitors: true,
          isLocked: true,
          homecell: { select: { name: true } },
        },
        orderBy: [{ weekStartDate: "desc" }, { updatedAt: "desc" }],
        take: 12,
      }),
      db.attendanceEntry.groupBy({
        by: ["status"],
        where: {
          churchId,
          member: { homecellId: { in: whereScopeIds } },
          attendance: {
            service: {
              eventDate: {
                gte: selectedMonthWindow.start,
                lt: selectedMonthWindow.end,
              },
            },
          },
        },
        _count: { _all: true },
      }),
    ]);

    const weekReportByHomecell = new Map(weekReports.map((report) => [report.homecellId, report]));
    const weekMembersTotal = weekReports.reduce((sum, report) => sum + report.totalMembers, 0);
    const weekMembersPresent = weekReports.reduce((sum, report) => sum + report.membersPresent, 0);
    const weekVisitorsTotal = weekReports.reduce((sum, report) => sum + report.visitors, 0);
    const weekCoverageRate = scopedHomecellIds.length > 0 ? (weekReports.length / scopedHomecellIds.length) * 100 : 0;
    const weekAttendanceRate = weekMembersTotal ? (weekMembersPresent / weekMembersTotal) * 100 : 0;
    const monthAttendance = attendanceRateFromStatusRows(monthStatusRows);

    return (
      <div className="space-y-6">
        <Card>
          <CardTitle>Homecell Leader Dashboard</CardTitle>
          <CardDescription className="mt-1">
            Detailed view for your homecells, submissions, member movement, and attendance health.
          </CardDescription>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/dashboard/reporting"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open Reporting
            </Link>
            <Link
              href="/dashboard/membership"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open Membership
            </Link>
            <Link
              href="/dashboard/attendance"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open Attendance
            </Link>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Scoped Homecells" value={scopedHomecellIds.length} subtitle="Assigned by structure" icon={Users} />
          <StatCard label="Homecells You Lead" value={homecellsLedDirectly.length} subtitle="Direct leader assignment" icon={Users} />
          <StatCard label="Active Members In Scope" value={activeMembersInScope} subtitle={`${totalMembersInScope} total members`} icon={Activity} />
          <StatCard label="Pending Member Requests" value={pendingRequestsCount} subtitle="Awaiting pastor approval" icon={Bell} />
          <StatCard label="Week Report Coverage" value={formatPercent(weekCoverageRate)} subtitle={`${weekReports.length} / ${scopedHomecellIds.length || 0} submitted`} icon={Activity} />
          <StatCard label="Week Attendance Rate" value={formatPercent(weekAttendanceRate)} subtitle={`${weekMembersPresent} present / ${weekMembersTotal} total`} icon={Activity} />
          <StatCard label="Week Visitors" value={weekVisitorsTotal} subtitle="Across your scoped reports" icon={UserRoundPlus} />
          <StatCard label={`${selectedMonthLabel} Attendance`} value={formatPercent(monthAttendance.rate)} subtitle={`${monthAttendance.present} present / ${monthAttendance.total} marked`} icon={Bell} />
        </div>

        {scopedHomecellIds.length === 0 ? (
          <Card>
            <CardTitle>No Homecell Scope Assigned</CardTitle>
            <CardDescription className="mt-1">
              Ask your Pastor or Church Admin to assign your structure branch.
            </CardDescription>
          </Card>
        ) : null}

        <Card>
          <CardTitle>Homecells This Week</CardTitle>
          <CardDescription className="mt-1">Submission and attendance status by homecell.</CardDescription>
          <div className="mt-4 space-y-2">
            {scopedHomecells.map((homecell) => {
              const weekReport = weekReportByHomecell.get(homecell.id);
              const reportRate = weekReport?.totalMembers
                ? (weekReport.membersPresent / weekReport.totalMembers) * 100
                : 0;
              return (
                <div key={homecell.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{homecell.name}</p>
                      <p className="text-xs text-slate-500">
                        Region: {homecell.region?.name ?? "-"} | Zone: {homecell.zone?.name ?? "-"} | Members:{" "}
                        {homecell._count.members}
                      </p>
                    </div>
                    {weekReport ? (
                      <Badge variant={weekReport.isLocked ? "default" : "success"}>
                        {weekReport.isLocked ? "Submitted (Locked)" : "Submitted"}
                      </Badge>
                    ) : (
                      <Badge variant="warning">Not Submitted</Badge>
                    )}
                  </div>
                  {weekReport ? (
                    <p className="mt-2 text-xs text-slate-600">
                      Attendance: {weekReport.membersPresent}/{weekReport.totalMembers} ({formatPercent(reportRate)}) | Visitors:{" "}
                      {weekReport.visitors} ({weekReport.firstTimeVisitors} first-time)
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardTitle>Pending Requests In Scope</CardTitle>
            <CardDescription className="mt-1">Recent requests sent for pastor approval.</CardDescription>
            <div className="mt-4 space-y-2">
              {pendingRequests.length > 0 ? (
                pendingRequests.map((request) => (
                  <div key={request.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <p className="font-medium text-slate-800">
                      {request.firstName} {request.lastName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {request.homecell.name} | Requested {request.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No pending requests in your scope.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Recent Reporting Activity</CardTitle>
            <CardDescription className="mt-1">Latest report records across your scoped homecells.</CardDescription>
            <div className="mt-4 space-y-2">
              {recentReports.length > 0 ? (
                recentReports.map((report) => {
                  const rate = report.totalMembers ? (report.membersPresent / report.totalMembers) * 100 : 0;
                  return (
                    <div key={report.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                      <p className="font-medium text-slate-800">
                        {report.homecell.name} | Week {report.weekStartDate.toISOString().slice(0, 10)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Attendance {report.membersPresent}/{report.totalMembers} ({formatPercent(rate)}) | Visitors{" "}
                        {report.visitors} ({report.firstTimeVisitors} first-time)
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-slate-500">No reports found yet for your scope.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (context.role === Role.PASTOR) {
    const [metrics, attendanceTrend, homecellsTotal, submittedThisWeek, weekAggregate, pendingRequestsCount, topHomecellReports] =
      await Promise.all([
        getDashboardMetrics(churchId, selectedMonthDate),
        getAttendanceTrend(churchId, selectedMonthDate),
        db.homecell.count({ where: { churchId } }),
        db.homecellReport.count({ where: { churchId, weekStartDate: weekStart } }),
        db.homecellReport.aggregate({
          where: { churchId, weekStartDate: weekStart },
          _sum: {
            totalMembers: true,
            membersPresent: true,
            membersAbsent: true,
            visitors: true,
            firstTimeVisitors: true,
            offeringCollected: true,
          },
        }),
        db.pendingMemberRequest.count({
          where: { churchId, status: "PENDING" },
        }),
        db.homecellReport.findMany({
          where: { churchId, weekStartDate: weekStart },
          select: {
            id: true,
            membersPresent: true,
            totalMembers: true,
            visitors: true,
            firstTimeVisitors: true,
            homecell: { select: { name: true } },
          },
          orderBy: [{ membersPresent: "desc" }, { totalMembers: "desc" }],
          take: 6,
        }),
      ]);

    const activeRate = metrics.totalMembers ? (metrics.activeMembers / metrics.totalMembers) * 100 : 0;
    const averageAttendanceRate = attendanceTrend.length
      ? attendanceTrend.reduce((sum, item) => sum + item.attendanceRate, 0) / attendanceTrend.length
      : 0;
    const weekTotalMembers = weekAggregate._sum.totalMembers ?? 0;
    const weekPresentMembers = weekAggregate._sum.membersPresent ?? 0;
    const weekVisitors = weekAggregate._sum.visitors ?? 0;
    const weekFirstTimeVisitors = weekAggregate._sum.firstTimeVisitors ?? 0;
    const weekCoverageRate = homecellsTotal ? (submittedThisWeek / homecellsTotal) * 100 : 0;
    const weekAttendanceRate = weekTotalMembers ? (weekPresentMembers / weekTotalMembers) * 100 : 0;
    const weekOffering = Number(weekAggregate._sum.offeringCollected ?? 0);

    return (
      <div className="space-y-6">
        <Card>
          <CardTitle>Pastor Dashboard</CardTitle>
          <CardDescription className="mt-1">Church-wide summary with the most important weekly and monthly signals.</CardDescription>
          <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <p className="mb-1 text-xs text-slate-500">Summary month</p>
              <input
                type="month"
                name="statsMonth"
                defaultValue={selectedMonth}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700"
            >
              Load
            </button>
            <p className="text-sm text-slate-600">
              Viewing: <span className="font-medium">{selectedMonthLabel}</span>
            </p>
          </form>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Total Members" value={metrics.totalMembers} subtitle={`${metrics.activeMembers} active`} icon={Users} />
          <StatCard label="Active Rate" value={formatPercent(activeRate)} subtitle="Church membership health" icon={Activity} />
          <StatCard label="Visitors In Month" value={metrics.visitorsThisMonth} subtitle={selectedMonthLabel} icon={UserRoundPlus} />
          <StatCard label="Giving In Month" value={formatCurrency(metrics.financeThisMonth)} subtitle={selectedMonthLabel} icon={DollarSign} />
          <StatCard label="Average Attendance" value={formatPercent(averageAttendanceRate)} subtitle="Monthly trend average" icon={Bell} />
          <StatCard label="Pending Member Requests" value={pendingRequestsCount} subtitle="Awaiting approval" icon={Bell} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardTitle>This Week Snapshot</CardTitle>
            <CardDescription className="mt-1">Reporting coverage and outcomes for current week.</CardDescription>
            <div className="mt-4 grid gap-3 text-sm text-slate-700">
              <p>
                Homecell coverage: <span className="font-semibold">{submittedThisWeek}</span> / {homecellsTotal} (
                {formatPercent(weekCoverageRate)})
              </p>
              <p>
                Member attendance: <span className="font-semibold">{weekPresentMembers}</span> / {weekTotalMembers} (
                {formatPercent(weekAttendanceRate)})
              </p>
              <p>
                Visitors: <span className="font-semibold">{weekVisitors}</span> ({weekFirstTimeVisitors} first-time)
              </p>
              <p>
                Offering captured: <span className="font-semibold">{formatCurrency(weekOffering)}</span>
              </p>
            </div>
          </Card>

          <Card>
            <CardTitle>Quick Navigation</CardTitle>
            <CardDescription className="mt-1">Jump to the main pastor workflows.</CardDescription>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/dashboard/summary"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Weekly Summary
              </Link>
              <Link
                href="/dashboard/reporting"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Reporting
              </Link>
              <Link
                href="/dashboard/membership"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Membership
              </Link>
              <Link
                href="/dashboard/pastors"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Zone Pastors
              </Link>
            </div>
          </Card>
        </div>

        <Card>
          <CardTitle>Top Homecell Attendance This Week</CardTitle>
          <CardDescription className="mt-1">Best-performing homecells by present members for current reporting week.</CardDescription>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Homecell</TableHeaderCell>
                  <TableHeaderCell>Present / Total</TableHeaderCell>
                  <TableHeaderCell>Attendance %</TableHeaderCell>
                  <TableHeaderCell>Visitors</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {topHomecellReports.map((report) => {
                  const rate = report.totalMembers ? (report.membersPresent / report.totalMembers) * 100 : 0;
                  return (
                    <TableRow key={report.id}>
                      <TableCell>{report.homecell.name}</TableCell>
                      <TableCell>
                        {report.membersPresent} / {report.totalMembers}
                      </TableCell>
                      <TableCell>{formatPercent(rate)}</TableCell>
                      <TableCell>
                        {report.visitors} ({report.firstTimeVisitors} first-time)
                      </TableCell>
                    </TableRow>
                  );
                })}
                {topHomecellReports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-slate-500">
                      No homecell reports submitted for this week yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    );
  }

  const monthServices = await db.service.findMany({
    where: {
      churchId,
      eventDate: {
        gte: selectedMonthWindow.start,
        lt: selectedMonthWindow.end,
      },
    },
    select: {
      id: true,
      title: true,
      serviceType: true,
      eventDate: true,
      attendance: {
        select: {
          entries: {
            select: {
              status: true,
            },
          },
        },
      },
    },
    orderBy: [{ eventDate: "asc" }, { title: "asc" }],
  });

  const servicesByDay = new Map<
    string,
    Array<{
      id: string;
      title: string;
      serviceType: "SUNDAY" | "MIDWEEK" | "SPECIAL" | "CUSTOM";
      totalAttendance: number;
      presentAttendance: number;
      onlineAttendance: number;
      absentAttendance: number;
      attendanceRate: number;
    }>
  >();

  for (const service of monthServices) {
    const dayKey = service.eventDate.toISOString().slice(0, 10);
    const entries = service.attendance[0]?.entries ?? [];
    const presentAttendance = entries.filter((entry) => entry.status === "PRESENT").length;
    const onlineAttendance = entries.filter((entry) => entry.status === "ONLINE").length;
    const absentAttendance = entries.filter((entry) => entry.status === "ABSENT").length;
    const totalAttendance = entries.length;
    const dayServices = servicesByDay.get(dayKey) ?? [];
    dayServices.push({
      id: service.id,
      title: service.title,
      serviceType: service.serviceType,
      totalAttendance,
      presentAttendance,
      onlineAttendance,
      absentAttendance,
      attendanceRate: totalAttendance ? ((presentAttendance + onlineAttendance) / totalAttendance) * 100 : 0,
    });
    servicesByDay.set(dayKey, dayServices);
  }

  const calendarDays = buildCalendarDays(selectedMonthWindow.start).map((date) => {
    const key = date.toISOString().slice(0, 10);
    const dayServices = servicesByDay.get(key) ?? [];
    const servicesCount = dayServices.length;
    const presentAttendance = dayServices.reduce((sum, service) => sum + service.presentAttendance, 0);
    const onlineAttendance = dayServices.reduce((sum, service) => sum + service.onlineAttendance, 0);
    const absentAttendance = dayServices.reduce((sum, service) => sum + service.absentAttendance, 0);
    const totalAttendance = dayServices.reduce((sum, service) => sum + service.totalAttendance, 0);
    const inSelectedMonth =
      date.getUTCFullYear() === selectedMonthWindow.start.getUTCFullYear() &&
      date.getUTCMonth() === selectedMonthWindow.start.getUTCMonth();

    return {
      key,
      dayNumber: date.getUTCDate(),
      inSelectedMonth,
      servicesCount,
      totalAttendance,
      presentAttendance,
      onlineAttendance,
      absentAttendance,
      attendanceRate: totalAttendance ? ((presentAttendance + onlineAttendance) / totalAttendance) * 100 : 0,
      services: dayServices,
    };
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Dashboard Calendar</CardTitle>
        <CardDescription className="mt-1">Select a date to view services held and attendance summary.</CardDescription>
        <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1 text-xs text-slate-500">Stats month</p>
            <input
              type="month"
              name="statsMonth"
              defaultValue={selectedMonth}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700"
          >
            Load
          </button>
        </form>
        <DashboardCalendarSummary monthLabel={selectedMonthLabel} days={calendarDays} />
      </Card>
    </div>
  );
}
