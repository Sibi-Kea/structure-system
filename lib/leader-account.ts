import { Role } from "@prisma/client";

import { db } from "@/lib/db";
import { generateTemporaryPassword, hashPassword } from "@/lib/password";

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

type EnsureMemberLeaderUserInput = {
  churchId: string;
  memberId: string;
  role: Role;
};

type EnsureMemberLeaderUserResult =
  | {
      userId: string;
      email: string;
      created: boolean;
      createdEmail?: string;
      createdPassword?: string;
    }
  | { error: string };

export async function ensureMemberLeaderUser(
  input: EnsureMemberLeaderUserInput,
): Promise<EnsureMemberLeaderUserResult> {
  const member = await db.member.findFirst({
    where: {
      id: input.memberId,
      churchId: input.churchId,
      isDeleted: false,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  if (!member) {
    return { error: "Selected member is invalid." };
  }

  const generatedEmail = generatedLeaderEmailForMemberId(member.id);
  const memberEmail = (normalizeEmail(member.email) ?? generatedEmail).toLowerCase();

  const existingUser = await db.user.findUnique({
    where: { email: memberEmail },
    select: { id: true, churchId: true },
  });

  if (existingUser && existingUser.churchId && existingUser.churchId !== input.churchId) {
    return { error: "Selected member email belongs to another church user." };
  }

  const name = `${member.firstName} ${member.lastName}`.trim();

  if (existingUser) {
    await db.user.update({
      where: { id: existingUser.id },
      data: {
        churchId: input.churchId,
        role: input.role,
        isActive: true,
        name,
      },
    });

    return {
      userId: existingUser.id,
      email: memberEmail,
      created: false,
    };
  }

  const createdPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(createdPassword);
  const createdUser = await db.user.create({
    data: {
      name,
      email: memberEmail,
      passwordHash,
      passwordChangeRequired: true,
      role: input.role,
      churchId: input.churchId,
      isActive: true,
    },
    select: { id: true },
  });

  return {
    userId: createdUser.id,
    email: memberEmail,
    created: true,
    createdEmail: memberEmail,
    createdPassword,
  };
}

export async function getMemberLeaderResetContext(input: {
  churchId: string;
  memberId: string;
  memberEmail?: string | null;
  autoProvisionZonePastorLogin?: boolean;
}) {
  const candidateEmails = Array.from(
    new Set(
      [
        normalizeEmail(input.memberEmail),
        generatedLeaderEmailForMemberId(input.memberId),
      ].filter((email): email is string => Boolean(email)),
    ),
  );

  let user = candidateEmails.length
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

  const zonePastorAssignments = await db.zone.count({
    where: { churchId: input.churchId, pastorMemberId: input.memberId },
  });

  // Repair legacy/missing login records for member-based zone pastors.
  if (!user && input.autoProvisionZonePastorLogin && zonePastorAssignments > 0) {
    const ensuredUser = await ensureMemberLeaderUser({
      churchId: input.churchId,
      memberId: input.memberId,
      role: Role.PASTOR,
    });

    if (!("error" in ensuredUser)) {
      user = await db.user.findUnique({
        where: { id: ensuredUser.userId },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          name: true,
        },
      });
    }
  }

  const [structureLeaderAssignments, ledHomecells, ledZones, ledRegions, ledDepartments] = await Promise.all([
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
