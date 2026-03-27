import Link from "next/link";
import { Prisma, Role } from "@prisma/client";
import { ExternalLink } from "lucide-react";

import { MemberFilters } from "@/components/members/member-filters";
import { MemberProfilePopup } from "@/components/members/member-profile-popup";
import { MembersTableMenu } from "@/components/members/members-table-menu";
import { MobileMembersList } from "@/components/members/mobile-members-list";
import { PendingMemberApprovalPanel } from "@/components/members/pending-member-approval-panel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { hasLimitedMemberView } from "@/lib/member-visibility";
import { resolveMemberScope } from "@/lib/member-scope";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";

type SearchParams = {
  q?: string;
  page?: string;
  homecellId?: string;
  departmentId?: string;
  status?: "ACTIVE" | "INACTIVE" | "VISITOR";
};

const pageSize = 12;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireChurchContext();
  const churchId = assertChurch(context.churchId);
  const params = await searchParams;
  const page = Number(params.page ?? "1");
  const limitedMemberView = hasLimitedMemberView(context.role);
  const canManage = hasPermission(context.role, "members:manage") && !limitedMemberView;
  const canSetupHomecells =
    context.role === Role.SUPER_ADMIN || context.role === Role.PASTOR || context.role === Role.CHURCH_ADMIN;
  const canApprovePendingRequests = context.role === Role.PASTOR || context.role === Role.SUPER_ADMIN;
  const scope = await resolveMemberScope({
    churchId,
    userId: context.userId,
    role: context.role,
  });
  const scopedHomecellIds = scope.isFullAccess
    ? []
    : scope.homecellIds.length > 0
      ? scope.homecellIds
      : ["__no_scope__"];

  const whereAnd: Prisma.MemberWhereInput[] = [];
  if (!scope.isFullAccess) {
    whereAnd.push({ homecellId: { in: scopedHomecellIds } });
  }
  if (params.homecellId) {
    whereAnd.push({ homecellId: params.homecellId });
  }

  const where: Prisma.MemberWhereInput = {
    churchId,
    isDeleted: false,
    membershipStatus: params.status || undefined,
    departmentId: params.departmentId || undefined,
    ...(whereAnd.length > 0 ? { AND: whereAnd } : {}),
    OR: params.q
      ? [
          { firstName: { contains: params.q, mode: "insensitive" as const } },
          { lastName: { contains: params.q, mode: "insensitive" as const } },
          { phone: { contains: params.q, mode: "insensitive" as const } },
          { email: { contains: params.q, mode: "insensitive" as const } },
        ]
      : undefined,
  };

  const [members, totalMembers, homecells, departments, pendingRequests] = await Promise.all([
    db.member.findMany({
      where,
      include: {
        homecell: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.member.count({ where }),
    db.homecell.findMany({
      where: {
        churchId,
        ...(scope.isFullAccess ? {} : { id: { in: scopedHomecellIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.department.findMany({
      where: {
        churchId,
        ...(scope.isFullAccess
          ? {}
          : {
              members: {
                some: {
                  churchId,
                  isDeleted: false,
                  homecellId: { in: scopedHomecellIds },
                },
              },
            }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    canApprovePendingRequests
      ? db.pendingMemberRequest.findMany({
          where: {
            churchId,
            status: "PENDING",
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            createdAt: true,
            homecell: {
              select: {
                name: true,
              },
            },
            requestedBy: {
              select: {
                name: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const [leaders, regions, zones, assignableMembers] = canSetupHomecells
    ? await Promise.all([
        db.user.findMany({
          where: {
            churchId,
            isActive: true,
            role: Role.HOMECELL_LEADER,
          },
          select: { id: true, name: true, role: true },
          orderBy: { name: "asc" },
          take: 500,
        }),
        db.region.findMany({
          where: { churchId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 300,
        }),
        db.zone.findMany({
          where: { churchId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 500,
        }),
        db.member.findMany({
          where: {
            churchId,
            isDeleted: false,
            ...(scope.isFullAccess ? {} : { homecellId: { in: scopedHomecellIds } }),
          },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 1000,
        }),
      ])
    : [[], [], [], []];

  const totalPages = Math.max(Math.ceil(totalMembers / pageSize), 1);
  const buildPageHref = (targetPage: number) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.homecellId) query.set("homecellId", params.homecellId);
    if (params.departmentId) query.set("departmentId", params.departmentId);
    if (params.status) query.set("status", params.status);
    query.set("page", String(targetPage));
    return `/dashboard/members?${query.toString()}`;
  };
  const mobileMembers = members.map((member) => ({
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    phone: member.phone,
    email: member.email,
    occupation: member.occupation,
    homecellName: member.homecell?.name ?? null,
    departmentName: member.department?.name ?? null,
    membershipStatus: member.membershipStatus,
  }));

  return (
    <div className="space-y-6">
      {canApprovePendingRequests ? (
        <PendingMemberApprovalPanel
          requests={pendingRequests.map((request) => ({
            id: request.id,
            name: `${request.firstName} ${request.lastName}`.trim(),
            phone: request.phone,
            email: request.email,
            homecellName: request.homecell.name,
            requestedByName: request.requestedBy.name,
            createdAtLabel: request.createdAt.toLocaleDateString(),
          }))}
        />
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 md:px-5">
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold text-slate-900">Members</p>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
              {totalMembers} {totalMembers === 1 ? "user" : "users"}
            </span>
          </div>
          {canManage && context.role !== Role.FINANCE_ADMIN ? (
            <MembersTableMenu
              departments={departments}
              homecells={homecells}
              members={assignableMembers.map((member) => ({
                id: member.id,
                name: `${member.firstName} ${member.lastName}`.trim(),
              }))}
              leaders={leaders.map((leader) => ({ id: leader.id, name: leader.name, role: leader.role }))}
              regions={regions}
              zones={zones}
              canSetupHomecells={canSetupHomecells}
            />
          ) : null}
        </div>
        <div className="border-b border-slate-200 px-4 py-3 md:px-5">
          <MemberFilters homecells={homecells} />
        </div>

        <div className="p-3 md:hidden">
          {mobileMembers.length > 0 ? (
            <MobileMembersList members={mobileMembers} />
          ) : (
            <p className="py-4 text-center text-sm text-slate-500">No members found for your current filters and scope.</p>
          )}
        </div>
        <div className="hidden md:block">
          <Table>
            <TableHead className="bg-white">
              <TableRow className="border-b border-slate-200 hover:bg-white">
                <TableHeaderCell className="w-10">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label="Select all members" />
                </TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Email address</TableHeaderCell>
                <TableHeaderCell>Teams</TableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="align-middle">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={`Select ${member.firstName} ${member.lastName}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                        {member.firstName.charAt(0)}
                        {member.lastName.charAt(0)}
                      </div>
                      <div className="space-y-0.5">
                        <p className="font-medium text-slate-900">
                          {member.firstName} {member.lastName}
                        </p>
                        <p className="text-xs text-slate-500">{member.phone ?? "-"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        member.membershipStatus === "ACTIVE"
                          ? "inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                          : member.membershipStatus === "INACTIVE"
                            ? "inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                            : "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                      }
                    >
                      <span
                        className={
                          member.membershipStatus === "ACTIVE"
                            ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
                            : member.membershipStatus === "INACTIVE"
                              ? "h-1.5 w-1.5 rounded-full bg-amber-500"
                              : "h-1.5 w-1.5 rounded-full bg-slate-500"
                        }
                      />
                      {member.membershipStatus === "ACTIVE"
                        ? "Active member"
                        : member.membershipStatus === "INACTIVE"
                          ? "Inactive member"
                          : "Visitor"}
                    </span>
                  </TableCell>
                  <TableCell>{member.email ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {member.homecell?.name ? (
                        <Badge className="border border-sky-200 bg-sky-50 text-sky-700">{member.homecell.name}</Badge>
                      ) : null}
                      {member.department?.name ? (
                        <Badge className="border border-indigo-200 bg-indigo-50 text-indigo-700">{member.department.name}</Badge>
                      ) : null}
                      {!member.homecell?.name && !member.department?.name ? (
                        <Badge className="border border-slate-200 bg-slate-50 text-slate-600">No team</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <MemberProfilePopup
                        memberId={member.id}
                        memberName={`${member.firstName} ${member.lastName}`}
                        variant="icon"
                      />
                      <Link
                        href={`/dashboard/members/${member.id}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                        aria-label={`Open full profile for ${member.firstName} ${member.lastName}`}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No members found for your current filters and scope.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 p-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              Page {page} of {totalPages}
            </span>
            <span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-slate-700">
              {pageSize} per page
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href={buildPageHref(Math.max(page - 1, 1))}>
              <Button variant="outline" disabled={page <= 1}>
                Previous
              </Button>
            </Link>
            <Link href={buildPageHref(Math.min(page + 1, totalPages))}>
              <Button variant="outline" disabled={page >= totalPages}>
                Next
              </Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
