"use server";

import { AuditAction, PendingMemberRequestStatus, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { resolveAttendanceScope } from "@/lib/attendance-scope";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { resolveMemberScope } from "@/lib/member-scope";
import { memberNoteSchema, memberSchema, pendingMemberRequestSchema } from "@/lib/validations/member";

function nullableValue(value?: string) {
  if (!value || value.trim().length === 0) return null;
  return value;
}

function scopedHomecellIds(input: { isFullAccess: boolean; homecellIds: string[] }) {
  return input.isFullAccess ? [] : input.homecellIds.length > 0 ? input.homecellIds : ["__no_scope__"];
}

type MemberActionResult = { success: boolean; message: string; memberId?: string };
type PendingMemberRequestActionResult = { success: boolean; message: string; requestId?: string; memberId?: string };
type ImportMembersActionResult = { success: boolean; message: string; created: number; failed: number; errors: string[] };

const importMemberRowSchema = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  dateJoined: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid dateJoined value." }),
  phone: z.string().trim().max(25).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  homecellName: z.string().trim().max(120).optional().or(z.literal("")),
  membershipStatus: z.enum(["ACTIVE", "INACTIVE", "VISITOR"]).optional().or(z.literal("")),
});

const importMembersSchema = z.object({
  rows: z.array(importMemberRowSchema).min(1).max(500),
  defaultHomecellId: z.string().cuid().optional().or(z.literal("")),
});

function canApprovePendingMemberRequest(role: Role) {
  return role === Role.PASTOR || role === Role.SUPER_ADMIN;
}

export async function createMemberAction(formData: FormData): Promise<MemberActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return { success: false, message: "You are not allowed to create members." };
  }

  const churchId = assertChurch(context.churchId);
  const scope = await resolveMemberScope({
    churchId,
    userId: context.userId,
    role: context.role,
  });
  const parsed = memberSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Please correct the member form fields." };
  }

  const data = parsed.data;
  const targetHomecellId = nullableValue(data.homecellId);

  if (!scope.isFullAccess) {
    if (!targetHomecellId || !scope.homecellIds.includes(targetHomecellId)) {
      return { success: false, message: "Select a homecell inside your assigned structure scope." };
    }
  }

  const member = await db.member.create({
    data: {
      churchId,
      firstName: data.firstName,
      lastName: data.lastName,
      gender: data.gender,
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      phone: nullableValue(data.phone),
      email: nullableValue(data.email),
      address: nullableValue(data.address),
      maritalStatus: data.maritalStatus ? data.maritalStatus : null,
      occupation: nullableValue(data.occupation),
      dateJoined: new Date(data.dateJoined),
      salvationStatus: data.salvationStatus,
      baptismStatus: data.baptismStatus,
      holySpiritBaptismStatus: data.holySpiritBaptismStatus,
      jimJohn316Status: data.jimJohn316Status,
      jimSgtStatus: data.jimSgtStatus,
      jimDiscStatus: data.jimDiscStatus,
      jimNltStatus: data.jimNltStatus,
      involvementNotes: nullableValue(data.involvementNotes),
      membershipStatus: data.membershipStatus,
      departmentId: nullableValue(data.departmentId),
      homecellId: targetHomecellId,
      emergencyContactName: nullableValue(data.emergencyContactName),
      emergencyContactPhone: nullableValue(data.emergencyContactPhone),
      profilePhotoUrl: nullableValue(data.profilePhotoUrl),
    },
  });

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.CREATE,
    entity: "Member",
    entityId: member.id,
  });

  revalidatePath("/dashboard/members");
  return { success: true, message: "Member created successfully.", memberId: member.id };
}

export async function importMembersAction(payload: unknown): Promise<ImportMembersActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return { success: false, message: "You are not allowed to import members.", created: 0, failed: 0, errors: [] };
  }

  const churchId = assertChurch(context.churchId);
  const scope = await resolveMemberScope({
    churchId,
    userId: context.userId,
    role: context.role,
  });

  const parsed = importMembersSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      message: "Import payload is invalid. Check required CSV columns and values.",
      created: 0,
      failed: 0,
      errors: ["Invalid import payload."],
    };
  }

  const scopeHomecellList = scopedHomecellIds(scope);
  const homecells = await db.homecell.findMany({
    where: {
      churchId,
      ...(scope.isFullAccess ? {} : { id: { in: scopeHomecellList } }),
    },
    select: { id: true, name: true },
  });

  const homecellByName = new Map(
    homecells.map((homecell) => [homecell.name.trim().toLowerCase(), homecell.id]),
  );
  const scopedHomecellSet = new Set(homecells.map((homecell) => homecell.id));

  const defaultHomecellId = nullableValue(parsed.data.defaultHomecellId);
  if (defaultHomecellId && !scopedHomecellSet.has(defaultHomecellId)) {
    return {
      success: false,
      message: "Default homecell is not valid for your church scope.",
      created: 0,
      failed: parsed.data.rows.length,
      errors: ["Default homecell is invalid or outside your structure scope."],
    };
  }

  let created = 0;
  const errors: string[] = [];

  for (const [index, row] of parsed.data.rows.entries()) {
    const explicitHomecellName = row.homecellName?.trim() ?? "";
    const resolvedHomecellId = explicitHomecellName
      ? (homecellByName.get(explicitHomecellName.toLowerCase()) ?? null)
      : defaultHomecellId;

    if (explicitHomecellName && !resolvedHomecellId) {
      errors.push(`Row ${index + 2}: homecell '${explicitHomecellName}' was not found in your scope.`);
      continue;
    }

    if (!scope.isFullAccess && !resolvedHomecellId) {
      errors.push(`Row ${index + 2}: homecell is required for your structure scope.`);
      continue;
    }

    if (!scope.isFullAccess && resolvedHomecellId && !scopedHomecellSet.has(resolvedHomecellId)) {
      errors.push(`Row ${index + 2}: selected homecell is outside your structure scope.`);
      continue;
    }

    try {
      await db.member.create({
        data: {
          churchId,
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          gender: row.gender,
          phone: nullableValue(row.phone),
          email: nullableValue(row.email),
          dateJoined: new Date(row.dateJoined),
          membershipStatus: row.membershipStatus || "ACTIVE",
          homecellId: resolvedHomecellId ?? null,
        },
      });
      created += 1;
    } catch {
      errors.push(`Row ${index + 2}: could not be imported.`);
    }
  }

  const failed = parsed.data.rows.length - created;

  if (created > 0) {
    await logAudit({
      churchId,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.CREATE,
      entity: "MemberImport",
      payload: {
        totalRows: parsed.data.rows.length,
        created,
        failed,
      },
    });

    revalidatePath("/dashboard/members");
  }

  if (created === 0) {
    return {
      success: false,
      message: "No members were imported.",
      created,
      failed,
      errors: errors.slice(0, 20),
    };
  }

  return {
    success: true,
    message: failed > 0 ? `Imported ${created} members. ${failed} row(s) failed.` : `Imported ${created} members.`,
    created,
    failed,
    errors: errors.slice(0, 20),
  };
}

export async function createPendingMemberRequestAction(
  payload: unknown,
): Promise<PendingMemberRequestActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "homecell_reports:submit")) {
    return { success: false, message: "You are not allowed to add reporting members." };
  }

  const churchId = assertChurch(context.churchId);
  const parsed = pendingMemberRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, message: "Please correct the quick member form fields." };
  }

  const scope = await resolveAttendanceScope({
    churchId,
    userId: context.userId,
    role: context.role,
  });
  if (!scope.isFullAccess && !scope.homecellIds.includes(parsed.data.homecellId)) {
    return { success: false, message: "Select a homecell inside your assigned reporting scope." };
  }

  const data = parsed.data;
  const normalizedEmail = nullableValue(data.email)?.toLowerCase() ?? null;
  const normalizedPhone = nullableValue(data.phone);

  const homecell = await db.homecell.findFirst({
    where: {
      id: data.homecellId,
      churchId,
      ...(scope.isFullAccess ? {} : { id: { in: scope.homecellIds.length > 0 ? scope.homecellIds : ["__no_scope__"] } }),
    },
    select: {
      id: true,
      name: true,
    },
  });
  if (!homecell) {
    return { success: false, message: "Selected homecell is invalid." };
  }

  const duplicatePendingRequest = await db.pendingMemberRequest.findFirst({
    where: {
      churchId,
      homecellId: data.homecellId,
      status: PendingMemberRequestStatus.PENDING,
      firstName: { equals: data.firstName, mode: "insensitive" },
      lastName: { equals: data.lastName, mode: "insensitive" },
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    },
    select: { id: true },
  });
  if (duplicatePendingRequest) {
    return { success: false, message: "A matching member request is already pending pastor approval." };
  }

  const duplicateMember = await db.member.findFirst({
    where: {
      churchId,
      homecellId: data.homecellId,
      isDeleted: false,
      firstName: { equals: data.firstName, mode: "insensitive" },
      lastName: { equals: data.lastName, mode: "insensitive" },
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    },
    select: { id: true },
  });
  if (duplicateMember) {
    return { success: false, message: "This person already exists in the approved member list." };
  }

  const request = await db.pendingMemberRequest.create({
    data: {
      churchId,
      homecellId: data.homecellId,
      requestedById: context.userId,
      firstName: data.firstName,
      lastName: data.lastName,
      gender: data.gender,
      phone: normalizedPhone,
      email: normalizedEmail,
      dateJoined: new Date(data.dateJoined),
    },
  });

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.CREATE,
    entity: "PendingMemberRequest",
    entityId: request.id,
    payload: {
      homecellId: homecell.id,
      homecellName: homecell.name,
    },
  });

  revalidatePath("/dashboard/reporting");
  revalidatePath("/dashboard/members");
  return {
    success: true,
    message: `${data.firstName} ${data.lastName} sent for pastor approval.`,
    requestId: request.id,
  };
}

export async function approvePendingMemberRequestAction(
  requestId: string,
): Promise<PendingMemberRequestActionResult> {
  const context = await requireChurchContext();
  if (!canApprovePendingMemberRequest(context.role)) {
    return { success: false, message: "Only Pastor can approve reporting member requests." };
  }

  const churchId = assertChurch(context.churchId);
  const request = await db.pendingMemberRequest.findFirst({
    where: {
      id: requestId,
      churchId,
    },
    select: {
      id: true,
      status: true,
      approvedMemberId: true,
      homecellId: true,
      firstName: true,
      lastName: true,
      gender: true,
      phone: true,
      email: true,
      dateJoined: true,
    },
  });
  if (!request) {
    return { success: false, message: "Pending member request not found." };
  }
  if (request.status !== PendingMemberRequestStatus.PENDING) {
    return {
      success: false,
      message: request.approvedMemberId
        ? "This member request was already approved."
        : "This member request is no longer pending.",
      memberId: request.approvedMemberId ?? undefined,
    };
  }

  const duplicateMember = await db.member.findFirst({
    where: {
      churchId,
      homecellId: request.homecellId,
      isDeleted: false,
      firstName: { equals: request.firstName, mode: "insensitive" },
      lastName: { equals: request.lastName, mode: "insensitive" },
      ...(request.email ? { email: request.email } : {}),
      ...(request.phone ? { phone: request.phone } : {}),
    },
    select: { id: true },
  });
  if (duplicateMember) {
    await db.pendingMemberRequest.update({
      where: { id: request.id },
      data: {
        status: PendingMemberRequestStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: context.userId,
        approvedMemberId: duplicateMember.id,
      },
    });

    revalidatePath("/dashboard/members");
    revalidatePath("/dashboard/reporting");
    return {
      success: true,
      message: "Matching approved member already existed. Request marked as approved.",
      memberId: duplicateMember.id,
    };
  }

  const approvedAt = new Date();
  const member = await db.$transaction(async (tx) => {
    const createdMember = await tx.member.create({
      data: {
        churchId,
        homecellId: request.homecellId,
        firstName: request.firstName,
        lastName: request.lastName,
        gender: request.gender,
        phone: request.phone,
        email: request.email,
        dateJoined: request.dateJoined,
        membershipStatus: "ACTIVE",
      },
    });

    await tx.pendingMemberRequest.update({
      where: { id: request.id },
      data: {
        status: PendingMemberRequestStatus.APPROVED,
        approvedAt,
        approvedById: context.userId,
        approvedMemberId: createdMember.id,
      },
    });

    return createdMember;
  });

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.CREATE,
    entity: "Member",
    entityId: member.id,
    payload: { source: "PendingMemberRequest", requestId: request.id },
  });

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.UPDATE,
    entity: "PendingMemberRequest",
    entityId: request.id,
    payload: { approvedMemberId: member.id },
  });

  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/reporting");
  return {
    success: true,
    message: `${member.firstName} ${member.lastName} approved and added to members.`,
    memberId: member.id,
  };
}

export async function updateMemberAction(
  memberId: string,
  formData: FormData,
): Promise<MemberActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return { success: false, message: "You are not allowed to edit members." };
  }

  const churchId = assertChurch(context.churchId);
  const scope = await resolveMemberScope({
    churchId,
    userId: context.userId,
    role: context.role,
  });
  const scopeHomecellIds = scopedHomecellIds(scope);
  const scopedMember = await db.member.findFirst({
    where: {
      id: memberId,
      churchId,
      isDeleted: false,
      ...(scope.isFullAccess ? {} : { homecellId: { in: scopeHomecellIds } }),
    },
    select: { id: true },
  });
  if (!scopedMember) {
    return { success: false, message: "Member not found in your structure scope." };
  }

  const parsed = memberSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Please correct the member form fields." };
  }

  const data = parsed.data;
  const targetHomecellId = nullableValue(data.homecellId);
  if (!scope.isFullAccess) {
    if (!targetHomecellId || !scope.homecellIds.includes(targetHomecellId)) {
      return { success: false, message: "Select a homecell inside your assigned structure scope." };
    }
  }

  await db.member.update({
    where: { id: memberId, churchId },
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      gender: data.gender,
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      phone: nullableValue(data.phone),
      email: nullableValue(data.email),
      address: nullableValue(data.address),
      maritalStatus: data.maritalStatus ? data.maritalStatus : null,
      occupation: nullableValue(data.occupation),
      dateJoined: new Date(data.dateJoined),
      salvationStatus: data.salvationStatus,
      baptismStatus: data.baptismStatus,
      holySpiritBaptismStatus: data.holySpiritBaptismStatus,
      jimJohn316Status: data.jimJohn316Status,
      jimSgtStatus: data.jimSgtStatus,
      jimDiscStatus: data.jimDiscStatus,
      jimNltStatus: data.jimNltStatus,
      involvementNotes: nullableValue(data.involvementNotes),
      membershipStatus: data.membershipStatus,
      departmentId: nullableValue(data.departmentId),
      homecellId: targetHomecellId,
      emergencyContactName: nullableValue(data.emergencyContactName),
      emergencyContactPhone: nullableValue(data.emergencyContactPhone),
      profilePhotoUrl: nullableValue(data.profilePhotoUrl),
    },
  });

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.UPDATE,
    entity: "Member",
    entityId: memberId,
  });

  revalidatePath("/dashboard/members");
  revalidatePath(`/dashboard/members/${memberId}`);
  return { success: true, message: "Member updated successfully." };
}

export async function softDeleteMemberAction(memberId: string): Promise<MemberActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return { success: false, message: "You are not allowed to archive members." };
  }

  const churchId = assertChurch(context.churchId);
  const scope = await resolveMemberScope({
    churchId,
    userId: context.userId,
    role: context.role,
  });
  const scopeHomecellIds = scopedHomecellIds(scope);
  const scopedMember = await db.member.findFirst({
    where: {
      id: memberId,
      churchId,
      isDeleted: false,
      ...(scope.isFullAccess ? {} : { homecellId: { in: scopeHomecellIds } }),
    },
    select: { id: true },
  });
  if (!scopedMember) {
    return { success: false, message: "Member not found in your structure scope." };
  }

  await db.member.update({
    where: { id: memberId, churchId },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      membershipStatus: "INACTIVE",
    },
  });

  await logAudit({
    churchId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: AuditAction.DELETE,
    entity: "Member",
    entityId: memberId,
  });

  revalidatePath("/dashboard/members");
  return { success: true, message: "Member archived." };
}

export async function addMemberNoteAction(formData: FormData): Promise<MemberActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:notes")) {
    return { success: false, message: "Only authorized roles can add pastoral notes." };
  }

  const churchId = assertChurch(context.churchId);
  const scope = await resolveMemberScope({
    churchId,
    userId: context.userId,
    role: context.role,
  });
  const scopeHomecellIds = scopedHomecellIds(scope);
  const parsed = memberNoteSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Invalid note content." };
  }

  const scopedMember = await db.member.findFirst({
    where: {
      id: parsed.data.memberId,
      churchId,
      isDeleted: false,
      ...(scope.isFullAccess ? {} : { homecellId: { in: scopeHomecellIds } }),
    },
    select: { id: true },
  });
  if (!scopedMember) {
    return { success: false, message: "Member not found in your structure scope." };
  }

  await db.memberNote.create({
    data: {
      churchId,
      memberId: parsed.data.memberId,
      authorId: context.userId,
      content: parsed.data.content,
    },
  });

  revalidatePath(`/dashboard/members/${parsed.data.memberId}`);
  return { success: true, message: "Pastoral note saved." };
}
