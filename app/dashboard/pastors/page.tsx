import { redirect } from "next/navigation";

import { AddPastorPopup } from "@/components/pastors/add-pastor-popup";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";

export default async function PastorsPage() {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:view")) {
    redirect("/dashboard");
  }
  const churchId = assertChurch(context.churchId);
  const canManagePastors = hasPermission(context.role, "members:manage");
  const canManageAcrossChurches = hasPermission(context.role, "church:create");

  const [church, zones, churches, pastorMembers, assignableZones] = await Promise.all([
    db.church.findUnique({
      where: { id: churchId },
      select: { name: true },
    }),
    db.zone.findMany({
      where: { churchId },
      include: {
        region: { select: { name: true } },
        pastorMember: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
        _count: { select: { homecells: true, members: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.church.findMany({
      where: canManageAcrossChurches ? undefined : { id: churchId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.member.findMany({
      where: canManageAcrossChurches
        ? { isDeleted: false }
        : { churchId, isDeleted: false },
      select: {
        id: true,
        churchId: true,
        firstName: true,
        lastName: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 2000,
    }),
    db.zone.findMany({
      where: canManageAcrossChurches ? { pastorMemberId: null } : { churchId, pastorMemberId: null },
      select: {
        id: true,
        churchId: true,
        name: true,
      },
      orderBy: { name: "asc" },
      take: 2000,
    }),
  ]);

  const assignedCount = zones.filter((zone) => Boolean(zone.pastorMember)).length;
  const unassignedCount = zones.length - assignedCount;
  const uniquePastorIds = new Set(
    zones
      .map((zone) => zone.pastorMember?.id)
      .filter((id): id is string => Boolean(id)),
  );

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Zone Pastors</CardTitle>
            <CardDescription className="mt-1">
              {church?.name ?? "Church"} member-based pastor assignments by zone.
            </CardDescription>
          </div>
          <AddPastorPopup
            canManage={canManagePastors}
            churches={churches}
            members={pastorMembers.map((member) => ({
              id: member.id,
              churchId: member.churchId,
              name: `${member.firstName} ${member.lastName}`,
            }))}
            zones={assignableZones}
            defaultChurchId={churchId}
          />
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardTitle>Total Zones</CardTitle>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{zones.length}</p>
        </Card>
        <Card>
          <CardTitle>Assigned Pastors</CardTitle>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{assignedCount}</p>
          <p className="mt-1 text-xs text-slate-500">{uniquePastorIds.size} unique members</p>
        </Card>
        <Card>
          <CardTitle>Unassigned Zones</CardTitle>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{unassignedCount}</p>
        </Card>
      </div>

      <Card>
        <CardTitle>Pastor Mapping</CardTitle>
        <div className="mt-4 space-y-2 md:hidden">
          {zones.map((zone) => (
            <div key={zone.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-900">{zone.name}</p>
              <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600">
                <p>Region: {zone.region?.name ?? "Unassigned"}</p>
                <p>
                  Pastor:{" "}
                  {zone.pastorMember
                    ? `${zone.pastorMember.firstName} ${zone.pastorMember.lastName}`
                    : "Unassigned"}
                </p>
                <p>Homecells: {zone._count.homecells}</p>
                <p>Members: {zone._count.members}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 hidden overflow-x-auto md:block">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Zone</TableHeaderCell>
                <TableHeaderCell>Region</TableHeaderCell>
                <TableHeaderCell>Pastor (Member)</TableHeaderCell>
                <TableHeaderCell>Contact</TableHeaderCell>
                <TableHeaderCell>Homecells</TableHeaderCell>
                <TableHeaderCell>Members</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {zones.map((zone) => (
                <TableRow key={zone.id}>
                  <TableCell>{zone.name}</TableCell>
                  <TableCell>{zone.region?.name ?? "Unassigned"}</TableCell>
                  <TableCell>
                    {zone.pastorMember ? `${zone.pastorMember.firstName} ${zone.pastorMember.lastName}` : "Unassigned"}
                  </TableCell>
                  <TableCell>{zone.pastorMember?.phone ?? zone.pastorMember?.email ?? "-"}</TableCell>
                  <TableCell>{zone._count.homecells}</TableCell>
                  <TableCell>{zone._count.members}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
