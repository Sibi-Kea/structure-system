import { Role } from "@prisma/client";

import { db } from "@/lib/db";

const LEADERSHIP_USER_ROLES = new Set<Role>([
  Role.PASTOR,
  Role.OVERSEER,
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.HOMECELL_LEADER,
  Role.CHURCH_ADMIN,
]);

function normalizeEmail(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function generatedLeaderEmailForMemberId(memberId: string) {
  return `member.${memberId.slice(-10)}@churchflow.local`.toLowerCase();
}

export async function getMemberLeaderResetContext(input: {
  churchId: string;
  memberId: string;
  memberEmail?: string | null;
}) {
  const candidateEmails = Array.from(
    new Set(
      [
        normalizeEmail(input.memberEmail),
        generatedLeaderEmailForMemberId(input.memberId),
      ].filter((email): email is string => Boolean(email)),
    ),
  );

  const user = candidateEmails.length
    ? await db.user.findFirst({
        where: {
          churchId: input.churchId,
          email: { in: candidateEmails },
        },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          name: true,
        },
      })
    : null;

  const [
    zonePastorAssignments,
    structureLeaderAssignments,
    ledHomecells,
    ledZones,
    ledRegions,
    ledDepartments,
  ] = await Promise.all([
    db.zone.count({
      where: { churchId: input.churchId, pastorMemberId: input.memberId },
    }),
    user
      ? db.structureLeader.count({
          where: { churchId: input.churchId, userId: user.id },
        })
      : Promise.resolve(0),
    user
      ? db.homecell.count({
          where: { churchId: input.churchId, leaderId: user.id },
        })
      : Promise.resolve(0),
    user
      ? db.zone.count({
          where: { churchId: input.churchId, leaderId: user.id },
        })
      : Promise.resolve(0),
    user
      ? db.region.count({
          where: { churchId: input.churchId, leaderId: user.id },
        })
      : Promise.resolve(0),
    user
      ? db.department.count({
          where: { churchId: input.churchId, leaderId: user.id },
        })
      : Promise.resolve(0),
  ]);

  const hasLeadershipAssignment =
    zonePastorAssignments > 0 ||
    structureLeaderAssignments > 0 ||
    ledHomecells > 0 ||
    ledZones > 0 ||
    ledRegions > 0 ||
    ledDepartments > 0 ||
    Boolean(user && LEADERSHIP_USER_ROLES.has(user.role));

  return {
    candidateEmails,
    user,
    hasLeadershipAssignment,
    assignments: {
      zonePastorAssignments,
      structureLeaderAssignments,
      ledHomecells,
      ledZones,
      ledRegions,
      ledDepartments,
    },
  };
}

