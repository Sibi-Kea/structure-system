import { Role } from "@prisma/client";
import { startOfMonth, subDays } from "date-fns";

import { HierarchyVisual } from "@/components/hierarchy/hierarchy-visual";
import { db } from "@/lib/db";
import { assertChurch, requireChurchContext } from "@/lib/tenant";

function uniqueNames(names: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      names
        .filter((name): name is string => Boolean(name))
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ),
  );
}

const structureRoles = new Set<Role>([
  Role.OVERSEER,
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.HOMECELL_LEADER,
]);

export default async function HierarchyPage() {
  const context = await requireChurchContext();
  const churchId = assertChurch(context.churchId);

  const [
    loggedInUser,
    church,
    attendanceEntries,
    growthMembers,
    structureLeaders,
  ] = await Promise.all([
    db.user.findUnique({
      where: { id: context.userId },
      select: {
        name: true,
        role: true,
      },
    }),
    db.church.findUnique({
      where: { id: churchId },
      select: {
        name: true,
        pastor: { select: { name: true } },
        users: {
          where: {
            churchId,
            isActive: true,
            role: { in: [Role.OVERSEER, Role.SUPERVISOR, Role.COORDINATOR, Role.HOMECELL_LEADER] },
          },
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        regions: {
          include: {
            zones: {
              include: {
                homecells: {
                  include: {
                    leader: { select: { id: true, name: true } },
                    _count: { select: { members: true } },
                  },
                  orderBy: { name: "asc" },
                },
              },
              orderBy: { name: "asc" },
            },
          },
          orderBy: { name: "asc" },
        },
      },
    }),
    db.attendanceEntry.findMany({
      where: {
        churchId,
        attendance: {
          service: {
            eventDate: { gte: subDays(new Date(), 30) },
          },
        },
      },
      select: {
        status: true,
        member: { select: { homecellId: true } },
      },
    }),
    db.member.findMany({
      where: {
        churchId,
        isDeleted: false,
        dateJoined: { gte: startOfMonth(new Date()) },
      },
      select: { homecellId: true },
    }),
    db.structureLeader.findMany({
      where: { churchId },
      select: {
        id: true,
        role: true,
        parentLeaderId: true,
        regionId: true,
        zoneId: true,
        homecellId: true,
        user: { select: { id: true, name: true } },
        homecell: { select: { id: true, zoneId: true, regionId: true } },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  if (!church) {
    return null;
  }

  const attendanceMap = new Map<string, { total: number; present: number }>();
  for (const entry of attendanceEntries) {
    const homecellId = entry.member.homecellId;
    if (!homecellId) continue;
    const current = attendanceMap.get(homecellId) ?? { total: 0, present: 0 };
    current.total += 1;
    if (entry.status === "PRESENT" || entry.status === "ONLINE") current.present += 1;
    attendanceMap.set(homecellId, current);
  }

  const growthMap = new Map<string, number>();
  for (const member of growthMembers) {
    if (!member.homecellId) continue;
    growthMap.set(member.homecellId, (growthMap.get(member.homecellId) ?? 0) + 1);
  }

  const namesFromStructure = (role: Role) =>
    structureLeaders
      .filter((leader) => leader.role === role)
      .map((leader) => leader.user.name);

  const namesFromUsers = (role: Role) =>
    church.users.filter((user) => user.role === role).map((user) => user.name);

  const summary = {
    pastors: uniqueNames([church.pastor?.name]),
    overseers: uniqueNames([...namesFromStructure(Role.OVERSEER), ...namesFromUsers(Role.OVERSEER)]),
    supervisors: uniqueNames([
      ...namesFromStructure(Role.SUPERVISOR),
      ...namesFromUsers(Role.SUPERVISOR),
    ]),
    coordinators: uniqueNames([
      ...namesFromStructure(Role.COORDINATOR),
      ...namesFromUsers(Role.COORDINATOR),
    ]),
    homecellLeaders: uniqueNames([
      ...namesFromStructure(Role.HOMECELL_LEADER),
      ...namesFromUsers(Role.HOMECELL_LEADER),
    ]),
  };

  const totalHomecells = church.regions.reduce(
    (count, region) => count + region.zones.reduce((zoneCount, zone) => zoneCount + zone.homecells.length, 0),
    0,
  );
  const totalZones = church.regions.reduce((count, region) => count + region.zones.length, 0);

  const leaderIds = new Set<string>();
  for (const leader of structureLeaders) {
    leaderIds.add(leader.user.id);
  }
  for (const user of church.users) {
    leaderIds.add(user.id);
  }
  for (const region of church.regions) {
    for (const zone of region.zones) {
      for (const homecell of zone.homecells) {
        if (homecell.leader?.id) {
          leaderIds.add(homecell.leader.id);
        }
      }
    }
  }

  const zones = church.regions.flatMap((region) =>
    region.zones.map((zone) => {
      const zoneAssignments = structureLeaders.filter((leader) => {
        if (leader.homecellId) return leader.homecell?.zoneId === zone.id;
        return leader.zoneId === zone.id;
      });

      return {
        id: zone.id,
        name: zone.name,
        regionId: region.id,
        regionName: region.name,
        nodes: zoneAssignments
          .filter((assignment) => structureRoles.has(assignment.role))
          .map((assignment) => ({
            id: assignment.id,
            name: assignment.user.name,
            role: assignment.role as "OVERSEER" | "SUPERVISOR" | "COORDINATOR" | "HOMECELL_LEADER",
            parentLeaderId: assignment.parentLeaderId,
            regionId: assignment.regionId,
            zoneId: assignment.zoneId,
            homecellId: assignment.homecellId,
          })),
        homecells: zone.homecells.map((homecell) => {
          const attendance = attendanceMap.get(homecell.id) ?? { total: 0, present: 0 };
          const attendanceRate = attendance.total ? (attendance.present / attendance.total) * 100 : 0;
          const growth = growthMap.get(homecell.id) ?? 0;
          const leaderNames = uniqueNames([
            ...zoneAssignments
              .filter(
                (assignment) =>
                  assignment.role === Role.HOMECELL_LEADER &&
                  assignment.homecellId === homecell.id,
              )
              .map((assignment) => assignment.user.name),
            homecell.leader?.name,
          ]);

          return {
            id: homecell.id,
            name: homecell.name,
            leaderNames,
            membersCount: homecell._count.members,
            attendanceRate,
            growth,
          };
        }),
      };
    }),
  );

  return (
    <HierarchyVisual
      churchName={church.name}
      pastorName={
        church.pastor?.name ??
        (context.role === Role.PASTOR ? (loggedInUser?.name ?? "Unassigned Pastor") : "Unassigned Pastor")
      }
      leadershipMetrics={{
        loggedInName: loggedInUser?.name ?? "Unknown User",
        loggedInRole: loggedInUser?.role ?? context.role,
        totalHomecells,
        totalLeaders: leaderIds.size,
        totalRegions: church.regions.length,
        totalZones,
      }}
      summary={summary}
      zones={zones}
    />
  );
}
