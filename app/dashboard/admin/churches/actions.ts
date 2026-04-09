"use server";

import { AuditAction, PendingMemberRequestStatus, Prisma, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canCreateAttendanceService } from "@/lib/attendance-scope";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ensureMemberLeaderUser } from "@/lib/leader-account";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";
import { churchSchema, churchServiceGroupsSchema, churchServiceLabelsSchema } from "@/lib/validations/church";

const regionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  leaderId: z.string().cuid().optional().or(z.literal("")),
});

const zoneSchema = z.object({
  name: z.string().trim().min(2).max(120),
  regionId: z.string().cuid().optional().or(z.literal("")),
  leaderId: z.string().cuid().optional().or(z.literal("")),
  pastorMemberId: z.string().cuid().optional().or(z.literal("")),
});

const homecellSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    regionId: z.string().cuid().optional().or(z.literal("")),
    zoneId: z.string().cuid().optional().or(z.literal("")),
    leaderId: z.string().cuid().optional().or(z.literal("")),
    leaderMemberId: z.string().cuid().optional().or(z.literal("")),
    meetingDay: z.string().trim().max(30).optional().or(z.literal("")),
    meetingTime: z.string().trim().max(30).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    const leaderId = value.leaderId?.trim() ?? "";
    const leaderMemberId = value.leaderMemberId?.trim() ?? "";
    if (leaderId && leaderMemberId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select either user leader or member leader, not both.",
        path: ["leaderId"],
      });
    }
  });

const memberStructureSchema = z.object({
  memberId: z.string().cuid(),
  regionId: z.string().cuid().optional().or(z.literal("")),
  zoneId: z.string().cuid().optional().or(z.literal("")),
  homecellId: z.string().cuid().optional().or(z.literal("")),
});

const zonePastorSchema = z.object({
  zoneId: z.string().cuid(),
  pastorMemberId: z.string().cuid().optional().or(z.literal("")),
});

const deleteChurchSchema = z.object({
  churchId: z.string().cuid(),
  confirmSlug: z.string().trim().min(1).max(80),
});

const deleteZoneSchema = z.object({
  zoneId: z.string().cuid(),
});

const deleteHomecellSchema = z.object({
  homecellId: z.string().cuid(),
});

const deleteStructureLeaderSchema = z.object({
  structureLeaderId: z.string().cuid(),
});

const STRUCTURE_ASSIGNABLE_ROLES = [
  Role.OVERSEER,
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.HOMECELL_LEADER,
] as const;

const structureLeaderSchema = z.object({
  userId: z.string().cuid(),
  role: z
    .nativeEnum(Role)
    .refine(
      (role) => STRUCTURE_ASSIGNABLE_ROLES.includes(role as (typeof STRUCTURE_ASSIGNABLE_ROLES)[number]),
      { message: "Invalid structure role." },
    ),
  regionId: z.string().cuid().optional().or(z.literal("")),
  zoneId: z.string().cuid().optional().or(z.literal("")),
  homecellId: z.string().cuid().optional().or(z.literal("")),
  parentLeaderId: z.string().cuid().optional().or(z.literal("")),
});

type ActionResult = {
  success: boolean;
  message: string;
};

function toNullable(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeChurchSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function forbiddenResult() {
  return {
    success: false,
    message: "You are not allowed to manage structures.",
  };
}

function parseServiceLabelsText(raw: string) {
  const labels = raw
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(labels));
}

type HomecellLeaderResolution =
  | {
      userId: string | null;
      promotedMemberId: string | null;
      createdEmail?: string;
      createdPassword?: string;
    }
  | { error: string };

async function resolveHomecellLeaderUser(input: {
  churchId: string;
  leaderId: string | null;
  leaderMemberId: string | null;
}): Promise<HomecellLeaderResolution> {
  const { churchId, leaderId, leaderMemberId } = input;

  if (leaderId && leaderMemberId) {
    return { error: "Select either an existing user leader or a member leader." };
  }

  if (!leaderId && !leaderMemberId) {
    return { userId: null, promotedMemberId: null };
  }

  if (leaderId) {
    const leaderUser = await db.user.findFirst({
      where: { id: leaderId, churchId, isActive: true },
      select: { id: true, role: true },
    });
    if (!leaderUser) {
      return { error: "Selected leader user is invalid." };
    }

    if (leaderUser.role !== Role.HOMECELL_LEADER) {
      await db.user.update({
        where: { id: leaderUser.id },
        data: { role: Role.HOMECELL_LEADER },
      });
    }

    return { userId: leaderUser.id, promotedMemberId: null };
  }

  const member = await db.member.findFirst({
    where: { id: leaderMemberId ?? "", churchId, isDeleted: false },
    select: { id: true },
  });
  if (!member) {
    return { error: "Selected leader member is invalid." };
  }

  const ensuredUser = await ensureMemberLeaderUser({
    churchId,
    memberId: member.id,
    role: Role.HOMECELL_LEADER,
  });
  if ("error" in ensuredUser) {
    return { error: ensuredUser.error };
  }

  return {
    userId: ensuredUser.userId,
    promotedMemberId: member.id,
    createdEmail: ensuredUser.createdEmail,
    createdPassword: ensuredUser.createdPassword,
  };
}

export async function createChurchAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "church:create")) {
    return { success: false, message: "You are not allowed to create churches." };
  }

  const nameRaw = String(formData.get("name") ?? "");
  const rawSlug = String(formData.get("slug") ?? "");
  const normalizedSlug = normalizeChurchSlug(rawSlug) || normalizeChurchSlug(nameRaw);

  const parsed = churchSchema.safeParse({
    name: nameRaw,
    slug: normalizedSlug,
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    address: String(formData.get("address") ?? ""),
    pastorUserId: "",
  });
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    if (firstIssue?.path?.[0] === "name") {
      return { success: false, message: "Church name must be at least 3 characters." };
    }
    if (firstIssue?.path?.[0] === "slug") {
      return {
        success: false,
        message: "Church slug must be at least 3 characters (letters, numbers, hyphens).",
      };
    }
    return {
      success: false,
      message: "Church details are invalid. Check name, slug, and email format.",
    };
  }

  try {
    const church = await db.church.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        email: toNullable(parsed.data.email),
        phone: toNullable(parsed.data.phone),
        address: toNullable(parsed.data.address),
        createdById: context.userId,
      },
    });

    // Keep super admin context consistent after first-time setup.
    if (context.role === Role.SUPER_ADMIN) {
      await db.user.updateMany({
        where: {
          id: context.userId,
          role: Role.SUPER_ADMIN,
          churchId: null,
        },
        data: {
          churchId: church.id,
        },
      });
    }

    await logAudit({
      churchId: church.id,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.CREATE,
      entity: "Church",
      entityId: church.id,
    });

    revalidatePath("/dashboard/admin/churches");
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/membership");
    revalidatePath("/dashboard/members");
    return { success: true, message: "Church created." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, message: "Church name or slug already exists." };
    }
    return { success: false, message: "Could not create church. Please try again." };
  }
}

export async function deleteChurchAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "church:create")) {
    return { success: false, message: "You are not allowed to delete churches." };
  }

  const parsed = deleteChurchSchema.safeParse({
    churchId: String(formData.get("churchId") ?? ""),
    confirmSlug: String(formData.get("confirmSlug") ?? ""),
  });
  if (!parsed.success) {
    return { success: false, message: "Delete request is invalid." };
  }

  const church = await db.church.findUnique({
    where: { id: parsed.data.churchId },
    select: { id: true, name: true, slug: true },
  });
  if (!church) {
    return { success: false, message: "Selected church was not found." };
  }

  const confirmSlug = parsed.data.confirmSlug.trim().toLowerCase();
  if (confirmSlug !== church.slug.toLowerCase()) {
    return { success: false, message: `Type the exact slug (${church.slug}) to confirm deletion.` };
  }

  try {
    await db.$transaction(async (tx) => {
      // Church relation on audit logs is not cascading; clear links before delete.
      await tx.auditLog.updateMany({
        where: { churchId: church.id },
        data: { churchId: null },
      });

      // User.churchId is non-cascading by design; unlink users before delete.
      await tx.user.updateMany({
        where: { churchId: church.id },
        data: { churchId: null },
      });

      await tx.church.delete({
        where: { id: church.id },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { success: false, message: "Church cannot be deleted due to remaining linked records." };
    }
    return { success: false, message: "Could not delete church. Please try again." };
  }

  await logAudit({
    churchId: null,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.DELETE,
    entity: "Church",
    entityId: church.id,
    payload: {
      deletedChurchName: church.name,
      deletedChurchSlug: church.slug,
    },
  });

  revalidatePath("/dashboard/admin/churches");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/membership");
  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/hierarchy");
  return { success: true, message: `Church ${church.name} deleted.` };
}

export async function updateChurchServiceLabelsAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  const canManageServiceLabels =
    hasPermission(context.role, "attendance:manage") && canCreateAttendanceService(context.role);
  if (!canManageServiceLabels) {
    return { success: false, message: "You are not allowed to manage church services." };
  }

  const fallbackChurchId = assertChurch(context.churchId);
  const requestedChurchId = String(formData.get("churchId") ?? fallbackChurchId);
  const targetChurchId = hasPermission(context.role, "church:create")
    ? requestedChurchId
    : fallbackChurchId;
  const morningRaw = String(formData.get("morningLabelsText") ?? "");
  const eveningRaw = String(formData.get("eveningLabelsText") ?? "");
  const onlineRaw = String(formData.get("onlineLabelsText") ?? "");
  const hasGroupedPayload = Boolean(morningRaw || eveningRaw || onlineRaw);
  const labelsRaw = String(formData.get("labelsText") ?? "");

  if (hasGroupedPayload) {
    const parsed = churchServiceGroupsSchema.safeParse({
      churchId: targetChurchId,
      morningLabels: parseServiceLabelsText(morningRaw),
      eveningLabels: parseServiceLabelsText(eveningRaw),
      onlineLabels: parseServiceLabelsText(onlineRaw),
    });
    if (!parsed.success) {
      return {
        success: false,
        message: "Provide at least one morning/evening/online label (2-120 chars), max 20 per group.",
      };
    }

    const targetChurch = await db.church.findUnique({
      where: { id: parsed.data.churchId },
      select: { id: true },
    });
    if (!targetChurch) {
      return { success: false, message: "Selected church is invalid." };
    }

    await db.church.update({
      where: { id: targetChurchId },
      data: {
        attendanceMorningServiceLabels: parsed.data.morningLabels,
        attendanceEveningServiceLabels: parsed.data.eveningLabels,
        attendanceOnlineServiceLabels: parsed.data.onlineLabels,
        attendanceServiceLabels: Array.from(
          new Set([
            ...parsed.data.morningLabels,
            ...parsed.data.eveningLabels,
            ...parsed.data.onlineLabels,
          ]),
        ),
      },
    });

    await logAudit({
      churchId: targetChurchId,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.UPDATE,
      entity: "ChurchAttendanceServiceLabels",
      entityId: targetChurchId,
      payload: {
        morningLabels: parsed.data.morningLabels,
        eveningLabels: parsed.data.eveningLabels,
        onlineLabels: parsed.data.onlineLabels,
      },
    });
  } else {
    const parsed = churchServiceLabelsSchema.safeParse({
      churchId: targetChurchId,
      labels: parseServiceLabelsText(labelsRaw),
    });
    if (!parsed.success) {
      return {
        success: false,
        message: "Provide at least one service label (2-120 chars), maximum 20.",
      };
    }

    const targetChurch = await db.church.findUnique({
      where: { id: parsed.data.churchId },
      select: { id: true },
    });
    if (!targetChurch) {
      return { success: false, message: "Selected church is invalid." };
    }

    await db.church.update({
      where: { id: targetChurchId },
      data: {
        attendanceServiceLabels: parsed.data.labels,
      },
    });

    await logAudit({
      churchId: targetChurchId,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.UPDATE,
      entity: "ChurchAttendanceServiceLabels",
      entityId: targetChurchId,
      payload: { labels: parsed.data.labels },
    });
  }

  revalidatePath("/dashboard/admin/churches");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/attendance");
  return { success: true, message: "Church attendance services updated." };
}

function scopeMatchesParent(input: {
  regionId: string | null;
  zoneId: string | null;
  homecellId: string | null;
  parentRegionId: string | null;
  parentZoneId: string | null;
  parentHomecellId: string | null;
}) {
  const {
    regionId,
    zoneId,
    homecellId,
    parentRegionId,
    parentZoneId,
    parentHomecellId,
  } = input;

  if (homecellId) {
    if (parentHomecellId === homecellId) return true;
    if (zoneId && parentZoneId === zoneId && !parentHomecellId) return true;
    if (regionId && parentRegionId === regionId && !parentZoneId && !parentHomecellId) return true;
    return false;
  }

  if (zoneId) {
    if (parentZoneId === zoneId && !parentHomecellId) return true;
    if (regionId && parentRegionId === regionId && !parentZoneId && !parentHomecellId) return true;
    return false;
  }

  if (regionId) {
    return parentRegionId === regionId && !parentZoneId && !parentHomecellId;
  }

  return false;
}

export async function createRegionAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return forbiddenResult();
  }
  const churchId = assertChurch(context.churchId);

  const parsed = regionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Region details are invalid." };
  }

  try {
    const region = await db.region.create({
      data: {
        churchId,
        name: parsed.data.name,
        leaderId: toNullable(parsed.data.leaderId ?? ""),
      },
    });

    await logAudit({
      churchId,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.CREATE,
      entity: "Region",
      entityId: region.id,
    });

    revalidatePath("/dashboard/admin/churches");
    revalidatePath("/dashboard/hierarchy");
    return { success: true, message: "Region created." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, message: "Region already exists or leader is already assigned." };
    }
    return { success: false, message: "Could not create region. Please try again." };
  }
}

export async function createZoneAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return forbiddenResult();
  }
  const churchId = assertChurch(context.churchId);

  const parsed = zoneSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Zone details are invalid." };
  }

  const regionId = toNullable(parsed.data.regionId ?? "");
  const pastorMemberId = toNullable(parsed.data.pastorMemberId ?? "");
  if (regionId) {
    const region = await db.region.findFirst({
      where: { id: regionId, churchId },
      select: { id: true },
    });
    if (!region) {
      return { success: false, message: "Selected region is invalid." };
    }
  }
  if (pastorMemberId) {
    const pastorMember = await db.member.findFirst({
      where: { id: pastorMemberId, churchId, isDeleted: false },
      select: { id: true },
    });
    if (!pastorMember) {
      return { success: false, message: "Selected pastor member is invalid." };
    }
  }

  const existingZone = await db.zone.findFirst({
    where: { churchId, name: parsed.data.name },
    select: { id: true },
  });
  if (existingZone) {
    return { success: false, message: "Zone already exists or leader is already assigned." };
  }

  const pastorLoginResult = pastorMemberId
    ? await ensureMemberLeaderUser({
        churchId,
        memberId: pastorMemberId,
        role: Role.PASTOR,
      })
    : null;

  if (pastorLoginResult && "error" in pastorLoginResult) {
    return { success: false, message: pastorLoginResult.error };
  }

  try {
    const zone = await db.zone.create({
      data: {
        churchId,
        name: parsed.data.name,
        regionId,
        leaderId: toNullable(parsed.data.leaderId ?? ""),
        pastorMemberId,
      },
    });

    await logAudit({
      churchId,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.CREATE,
      entity: "Zone",
      entityId: zone.id,
    });

    revalidatePath("/dashboard/admin/churches");
    revalidatePath("/dashboard/hierarchy");
    revalidatePath("/dashboard/pastors");

    if (pastorLoginResult?.createdEmail) {
      if (context.role === Role.SUPER_ADMIN && pastorLoginResult.createdPassword) {
        return {
          success: true,
          message: `Zone created. Temporary pastor login ${pastorLoginResult.createdEmail} / ${pastorLoginResult.createdPassword}. Password reset is required at first sign-in.`,
        };
      }
      return {
        success: true,
        message: `Zone created. Pastor login: ${pastorLoginResult.createdEmail}. Temporary password is visible to Super Admin only.`,
      };
    }

    return { success: true, message: "Zone created." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, message: "Zone already exists or leader is already assigned." };
    }
    return { success: false, message: "Could not create zone. Please try again." };
  }
}

export async function assignZonePastorAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return forbiddenResult();
  }
  const churchId = assertChurch(context.churchId);

  const parsed = zonePastorSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Zone pastor payload is invalid." };
  }

  const pastorMemberId = toNullable(parsed.data.pastorMemberId ?? "");
  const zone = await db.zone.findFirst({
    where: { id: parsed.data.zoneId, churchId },
    select: { id: true, regionId: true, pastorMemberId: true },
  });
  if (!zone) {
    return { success: false, message: "Selected zone is invalid." };
  }

  let pastorLoginResult:
    | {
        userId: string;
        email: string;
        created: boolean;
        createdEmail?: string;
        createdPassword?: string;
      }
    | null = null;

  if (pastorMemberId) {
    const pastorMember = await db.member.findFirst({
      where: { id: pastorMemberId, churchId, isDeleted: false },
      select: { id: true },
    });
    if (!pastorMember) {
      return { success: false, message: "Selected pastor member is invalid." };
    }

    if (zone.pastorMemberId && zone.pastorMemberId !== pastorMemberId) {
      return { success: false, message: "Selected zone already has a pastor assigned. Clear it first." };
    }

    const ensuredPastorLogin = await ensureMemberLeaderUser({
      churchId,
      memberId: pastorMemberId,
      role: Role.PASTOR,
    });
    if ("error" in ensuredPastorLogin) {
      return { success: false, message: ensuredPastorLogin.error };
    }
    pastorLoginResult = ensuredPastorLogin;

    const updated = await db.zone.updateMany({
      where: {
        id: zone.id,
        churchId,
        pastorMemberId: zone.pastorMemberId ? pastorMemberId : null,
      },
      data: { pastorMemberId },
    });
    if (!updated.count) {
      return { success: false, message: "Selected zone already has a pastor assigned. Clear it first." };
    }
  } else {
    await db.zone.update({
      where: { id: zone.id },
      data: { pastorMemberId: null },
    });
  }

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.UPDATE,
    entity: "ZonePastor",
    entityId: zone.id,
    payload: { pastorMemberId },
  });

  revalidatePath("/dashboard/admin/churches");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/hierarchy");
  revalidatePath("/dashboard/pastors");

  if (pastorLoginResult?.createdEmail) {
    if (context.role === Role.SUPER_ADMIN && pastorLoginResult.createdPassword) {
      return {
        success: true,
        message: `Zone pastor assigned. Temporary login ${pastorLoginResult.createdEmail} / ${pastorLoginResult.createdPassword}. Password reset is required at first sign-in.`,
      };
    }
    return {
      success: true,
      message: `Zone pastor assigned. Login: ${pastorLoginResult.createdEmail}. Temporary password is visible to Super Admin only.`,
    };
  }

  return { success: true, message: pastorMemberId ? "Zone pastor assigned." : "Zone pastor cleared." };
}

export async function createHomecellAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return forbiddenResult();
  }
  const churchId = assertChurch(context.churchId);

  const parsed = homecellSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Homecell details are invalid." };
  }

  const leaderResult = await resolveHomecellLeaderUser({
    churchId,
    leaderId: toNullable(parsed.data.leaderId ?? ""),
    leaderMemberId: toNullable(parsed.data.leaderMemberId ?? ""),
  });
  if ("error" in leaderResult) {
    return { success: false, message: leaderResult.error };
  }

  const zoneId = toNullable(parsed.data.zoneId ?? "");
  const regionIdInput = toNullable(parsed.data.regionId ?? "");
  const zone = zoneId
    ? await db.zone.findFirst({
        where: { id: zoneId, churchId },
        select: { id: true, regionId: true },
      })
    : null;

  if (zoneId && !zone) {
    return { success: false, message: "Selected zone is invalid." };
  }

  const regionId = zone?.regionId ?? regionIdInput;
  if (regionId) {
    const region = await db.region.findFirst({
      where: { id: regionId, churchId },
      select: { id: true },
    });
    if (!region) {
      return { success: false, message: "Selected region is invalid." };
    }
  }

  try {
    const homecell = await db.homecell.create({
      data: {
        churchId,
        name: parsed.data.name,
        regionId,
        zoneId: zone?.id ?? zoneId,
        leaderId: leaderResult.userId,
        meetingDay: toNullable(parsed.data.meetingDay ?? ""),
        meetingTime: toNullable(parsed.data.meetingTime ?? ""),
      },
    });

    if (leaderResult.userId) {
      const existingStructureLeader = await db.structureLeader.findFirst({
        where: {
          churchId,
          userId: leaderResult.userId,
          role: Role.HOMECELL_LEADER,
          homecellId: homecell.id,
        },
        select: { id: true },
      });

      if (!existingStructureLeader) {
        await db.structureLeader.create({
          data: {
            churchId,
            userId: leaderResult.userId,
            role: Role.HOMECELL_LEADER,
            regionId: homecell.regionId,
            zoneId: homecell.zoneId,
            homecellId: homecell.id,
          },
        });
      }
    }

    if (leaderResult.promotedMemberId) {
      await db.member.update({
        where: { id: leaderResult.promotedMemberId, churchId },
        data: {
          regionId: homecell.regionId,
          zoneId: homecell.zoneId,
          homecellId: homecell.id,
        },
      });
    }

    await logAudit({
      churchId,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.CREATE,
      entity: "Homecell",
      entityId: homecell.id,
      payload: {
        leaderUserId: leaderResult.userId,
        leaderMemberId: leaderResult.promotedMemberId,
      },
    });

    revalidatePath("/dashboard/admin/churches");
    revalidatePath("/dashboard/hierarchy");
    revalidatePath("/dashboard/members");
    if (leaderResult.createdEmail) {
      if (context.role === Role.SUPER_ADMIN && leaderResult.createdPassword) {
        return {
          success: true,
          message: `Homecell created. Temporary leader login ${leaderResult.createdEmail} / ${leaderResult.createdPassword}. Password reset is required at first sign-in.`,
        };
      }
      return {
        success: true,
        message: `Homecell created. Leader login: ${leaderResult.createdEmail}. Temporary password is visible to Super Admin only.`,
      };
    }
    return { success: true, message: "Homecell created." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, message: "Homecell already exists or leader is already assigned." };
    }
    return { success: false, message: "Could not create homecell. Please try again." };
  }
}

export async function assignMemberStructureAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return forbiddenResult();
  }
  const churchId = assertChurch(context.churchId);

  const parsed = memberStructureSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Invalid assignment payload." };
  }

  const member = await db.member.findFirst({
    where: { id: parsed.data.memberId, churchId, isDeleted: false },
    select: { id: true },
  });
  if (!member) {
    return { success: false, message: "Member not found." };
  }

  const zoneIdInput = toNullable(parsed.data.zoneId ?? "");
  const homecellIdInput = toNullable(parsed.data.homecellId ?? "");
  const regionIdInput = toNullable(parsed.data.regionId ?? "");

  const zone = zoneIdInput
    ? await db.zone.findFirst({
        where: { id: zoneIdInput, churchId },
        select: { id: true, regionId: true },
      })
    : null;
  if (zoneIdInput && !zone) {
    return { success: false, message: "Selected zone is invalid." };
  }

  const homecell = homecellIdInput
    ? await db.homecell.findFirst({
        where: { id: homecellIdInput, churchId },
        select: { id: true, zoneId: true, regionId: true },
      })
    : null;
  if (homecellIdInput && !homecell) {
    return { success: false, message: "Selected homecell is invalid." };
  }

  const resolvedZoneId = homecell?.zoneId ?? zone?.id ?? zoneIdInput;
  const resolvedRegionId = homecell?.regionId ?? zone?.regionId ?? regionIdInput;

  await db.member.update({
    where: { id: parsed.data.memberId, churchId },
    data: {
      regionId: resolvedRegionId,
      zoneId: resolvedZoneId,
      homecellId: homecell?.id ?? homecellIdInput,
    },
  });

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.UPDATE,
    entity: "MemberStructure",
    entityId: parsed.data.memberId,
    payload: {
      regionId: resolvedRegionId,
      zoneId: resolvedZoneId,
      homecellId: homecell?.id ?? homecellIdInput,
    },
  });

  revalidatePath("/dashboard/admin/churches");
  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/hierarchy");
  return { success: true, message: "Member assigned to structure." };
}

export async function assignStructureLeaderAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return forbiddenResult();
  }
  const churchId = assertChurch(context.churchId);

  const parsed = structureLeaderSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Invalid structure leadership payload." };
  }

  const roleOrder = new Map<Role, number>([
    [Role.OVERSEER, 1],
    [Role.SUPERVISOR, 2],
    [Role.COORDINATOR, 3],
    [Role.HOMECELL_LEADER, 4],
  ]);

  const homecellIdInput = toNullable(parsed.data.homecellId ?? "");
  const zoneIdInput = toNullable(parsed.data.zoneId ?? "");
  const regionIdInput = toNullable(parsed.data.regionId ?? "");
  const parentLeaderId = toNullable(parsed.data.parentLeaderId ?? "");

  const selectedScopeCount = Number(Boolean(homecellIdInput)) + Number(Boolean(zoneIdInput)) + Number(Boolean(regionIdInput));
  if (selectedScopeCount !== 1) {
    return { success: false, message: "Select exactly one structure scope: region, zone, or homecell." };
  }

  const leaderUser = await db.user.findFirst({
    where: { id: parsed.data.userId, churchId, isActive: true },
    select: { id: true, role: true, name: true },
  });
  if (!leaderUser) {
    return { success: false, message: "Selected leader is invalid." };
  }
  if (leaderUser.role !== parsed.data.role) {
    return {
      success: false,
      message: `Selected user is ${leaderUser.role}, expected ${parsed.data.role}.`,
    };
  }

  let regionId: string | null = null;
  let zoneId: string | null = null;
  let homecellId: string | null = null;

  if (homecellIdInput) {
    const homecell = await db.homecell.findFirst({
      where: { id: homecellIdInput, churchId },
      select: { id: true, zoneId: true, regionId: true },
    });
    if (!homecell) {
      return { success: false, message: "Selected homecell is invalid." };
    }
    homecellId = homecell.id;
    zoneId = homecell.zoneId;
    regionId = homecell.regionId;
  } else if (zoneIdInput) {
    const zone = await db.zone.findFirst({
      where: { id: zoneIdInput, churchId },
      select: { id: true, regionId: true },
    });
    if (!zone) {
      return { success: false, message: "Selected zone is invalid." };
    }
    zoneId = zone.id;
    regionId = zone.regionId;
  } else if (regionIdInput) {
    const region = await db.region.findFirst({
      where: { id: regionIdInput, churchId },
      select: { id: true },
    });
    if (!region) {
      return { success: false, message: "Selected region is invalid." };
    }
    regionId = region.id;
  }

  const duplicate = await db.structureLeader.findFirst({
    where: {
      churchId,
      userId: parsed.data.userId,
      role: parsed.data.role,
      regionId,
      zoneId,
      homecellId,
    },
    select: { id: true },
  });
  if (duplicate) {
    return { success: false, message: "This leader is already assigned at this scope." };
  }

  let parentLeader:
    | {
        id: string;
        role: Role;
        userId: string;
        regionId: string | null;
        zoneId: string | null;
        homecellId: string | null;
      }
    | null = null;

  if (parentLeaderId) {
    parentLeader = await db.structureLeader.findFirst({
      where: { id: parentLeaderId, churchId },
      select: {
        id: true,
        role: true,
        userId: true,
        regionId: true,
        zoneId: true,
        homecellId: true,
      },
    });

    if (!parentLeader) {
      return { success: false, message: "Parent leader not found." };
    }
    if (parentLeader.userId === parsed.data.userId) {
      return { success: false, message: "A leader cannot report to themselves." };
    }
    if (
      !scopeMatchesParent({
        regionId,
        zoneId,
        homecellId,
        parentRegionId: parentLeader.regionId,
        parentZoneId: parentLeader.zoneId,
        parentHomecellId: parentLeader.homecellId,
      })
    ) {
      return { success: false, message: "Parent leader must be in the same structure branch." };
    }
  }

  if (parsed.data.role === Role.OVERSEER && parentLeaderId) {
    return { success: false, message: "Overseer must be the root for a structure branch." };
  }

  if (parsed.data.role !== Role.OVERSEER && !parentLeaderId) {
    return { success: false, message: "Select a parent leader for this assignment." };
  }

  if (parentLeader) {
    const childRank = roleOrder.get(parsed.data.role);
    const parentRank = roleOrder.get(parentLeader.role);
    if (!childRank || !parentRank || childRank <= parentRank) {
      return { success: false, message: "Parent role must be above child role in the hierarchy." };
    }
  }

  try {
    const assignment = await db.structureLeader.create({
      data: {
        churchId,
        userId: parsed.data.userId,
        role: parsed.data.role,
        regionId,
        zoneId,
        homecellId,
        parentLeaderId,
      },
    });

    await logAudit({
      churchId,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.CREATE,
      entity: "StructureLeader",
      entityId: assignment.id,
      payload: {
        userId: parsed.data.userId,
        role: parsed.data.role,
        regionId,
        zoneId,
        homecellId,
        parentLeaderId,
      },
    });

    revalidatePath("/dashboard/admin/churches");
    revalidatePath("/dashboard/hierarchy");
    return { success: true, message: "Structure leader assigned." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, message: "This leader is already assigned at this scope." };
    }
    return { success: false, message: "Unable to assign structure leader. Please try again." };
  }
}

export async function deleteStructureLeaderAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return forbiddenResult();
  }
  const churchId = assertChurch(context.churchId);

  const parsed = deleteStructureLeaderSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Invalid structure delete payload." };
  }

  const node = await db.structureLeader.findFirst({
    where: { id: parsed.data.structureLeaderId, churchId },
    select: { id: true, parentLeaderId: true },
  });
  if (!node) {
    return { success: false, message: "Structure leader assignment not found." };
  }

  await db.$transaction([
    db.structureLeader.updateMany({
      where: { churchId, parentLeaderId: node.id },
      data: { parentLeaderId: node.parentLeaderId },
    }),
    db.structureLeader.delete({
      where: { id: node.id },
    }),
  ]);

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.DELETE,
    entity: "StructureLeader",
    entityId: node.id,
    payload: { parentLeaderId: node.parentLeaderId },
  });

  revalidatePath("/dashboard/admin/churches");
  revalidatePath("/dashboard/hierarchy");
  return { success: true, message: "Structure leader deleted." };
}

export async function deleteZoneAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return forbiddenResult();
  }
  const churchId = assertChurch(context.churchId);

  const parsed = deleteZoneSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Invalid zone delete payload." };
  }

  const zone = await db.zone.findFirst({
    where: { id: parsed.data.zoneId, churchId },
    select: { id: true, name: true },
  });
  if (!zone) {
    return { success: false, message: "Zone not found." };
  }

  const [homecellsCount, membersCount, structureAssignmentsCount] = await Promise.all([
    db.homecell.count({
      where: { churchId, zoneId: zone.id },
    }),
    db.member.count({
      where: { churchId, zoneId: zone.id, isDeleted: false },
    }),
    db.structureLeader.count({
      where: { churchId, zoneId: zone.id },
    }),
  ]);

  if (homecellsCount > 0 || membersCount > 0 || structureAssignmentsCount > 0) {
    return {
      success: false,
      message:
        "Cannot delete zone while it still has homecells, active members, or structure assignments. Reassign first.",
    };
  }

  await db.zone.delete({
    where: { id: zone.id },
  });

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.DELETE,
    entity: "Zone",
    entityId: zone.id,
    payload: { zoneName: zone.name },
  });

  revalidatePath("/dashboard/admin/churches");
  revalidatePath("/dashboard/hierarchy");
  revalidatePath("/dashboard/pastors");
  revalidatePath("/dashboard/members");
  return { success: true, message: `Zone ${zone.name} deleted.` };
}

export async function deleteHomecellAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return forbiddenResult();
  }
  const churchId = assertChurch(context.churchId);

  const parsed = deleteHomecellSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Invalid homecell delete payload." };
  }

  const homecell = await db.homecell.findFirst({
    where: { id: parsed.data.homecellId, churchId },
    select: { id: true, name: true },
  });
  if (!homecell) {
    return { success: false, message: "Homecell not found." };
  }

  const [membersCount, pendingRequestsCount, reportsCount, structureAssignmentsCount] = await Promise.all([
    db.member.count({
      where: { churchId, homecellId: homecell.id, isDeleted: false },
    }),
    db.pendingMemberRequest.count({
      where: {
        churchId,
        homecellId: homecell.id,
        status: PendingMemberRequestStatus.PENDING,
      },
    }),
    db.homecellReport.count({
      where: { churchId, homecellId: homecell.id },
    }),
    db.structureLeader.count({
      where: { churchId, homecellId: homecell.id },
    }),
  ]);

  if (membersCount > 0 || pendingRequestsCount > 0 || reportsCount > 0 || structureAssignmentsCount > 0) {
    return {
      success: false,
      message:
        "Cannot delete homecell while it has members, pending requests, reports, or structure assignments. Reassign first.",
    };
  }

  await db.homecell.delete({
    where: { id: homecell.id },
  });

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.DELETE,
    entity: "Homecell",
    entityId: homecell.id,
    payload: { homecellName: homecell.name },
  });

  revalidatePath("/dashboard/admin/churches");
  revalidatePath("/dashboard/hierarchy");
  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/reporting");
  return { success: true, message: `Homecell ${homecell.name} deleted.` };
}
