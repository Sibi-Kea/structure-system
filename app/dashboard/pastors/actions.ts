"use server";

import { AuditAction } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";

type ActionResult = {
  success: boolean;
  message: string;
};

const assignZonePastorPopupSchema = z
  .object({
    churchId: z.string().cuid().optional().or(z.literal("")),
    memberId: z.string().cuid(),
    zoneMode: z.enum(["EXISTING", "NEW"]),
    zoneId: z.string().cuid().optional().or(z.literal("")),
    newZoneName: z.string().trim().max(120).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.zoneMode === "EXISTING" && !(value.zoneId?.trim() ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select an existing zone.",
        path: ["zoneId"],
      });
    }
    if (value.zoneMode === "NEW" && (value.newZoneName?.trim().length ?? 0) < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide a new zone name with at least 2 characters.",
        path: ["newZoneName"],
      });
    }
  });

function toNullable(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export async function assignZonePastorFromPopupAction(formData: FormData): Promise<ActionResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "members:manage")) {
    return { success: false, message: "You are not allowed to assign zone pastors." };
  }

  const parsed = assignZonePastorPopupSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { success: false, message: "Pastor assignment payload is invalid." };
  }

  const defaultChurchId = assertChurch(context.churchId);
  const requestedChurchId = toNullable(parsed.data.churchId ?? "");
  const targetChurchId = hasPermission(context.role, "church:create")
    ? requestedChurchId ?? defaultChurchId
    : defaultChurchId;

  const targetChurch = await db.church.findUnique({
    where: { id: targetChurchId },
    select: { id: true },
  });
  if (!targetChurch) {
    return { success: false, message: "Selected church is invalid." };
  }

  const member = await db.member.findFirst({
    where: {
      id: parsed.data.memberId,
      churchId: targetChurchId,
      isDeleted: false,
    },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!member) {
    return { success: false, message: "Selected member is invalid for the selected church." };
  }

  if (parsed.data.zoneMode === "EXISTING") {
    const zoneId = toNullable(parsed.data.zoneId ?? "");
    const zone = await db.zone.findFirst({
      where: { id: zoneId ?? "", churchId: targetChurchId },
      select: { id: true, name: true },
    });
    if (!zone) {
      return { success: false, message: "Selected zone is invalid for the selected church." };
    }

    const updated = await db.zone.updateMany({
      where: {
        id: zone.id,
        churchId: targetChurchId,
        pastorMemberId: null,
      },
      data: { pastorMemberId: member.id },
    });
    if (!updated.count) {
      return { success: false, message: "Selected zone already has a pastor assigned. Choose an unoccupied zone." };
    }

    await logAudit({
      churchId: targetChurchId,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.UPDATE,
      entity: "ZonePastor",
      entityId: zone.id,
      payload: {
        zoneMode: "EXISTING",
        zoneName: zone.name,
        pastorMemberId: member.id,
      },
    });

    revalidatePath("/dashboard/pastors");
    revalidatePath("/dashboard/admin/churches");
    revalidatePath("/dashboard/settings");
    return { success: true, message: `${member.firstName} ${member.lastName} assigned to ${zone.name}.` };
  }

  const newZoneName = (parsed.data.newZoneName ?? "").trim();
  try {
    const zone = await db.zone.create({
      data: {
        churchId: targetChurchId,
        name: newZoneName,
        pastorMemberId: member.id,
      },
      select: { id: true, name: true },
    });

    await logAudit({
      churchId: targetChurchId,
      actorUserId: context.userId,
      actorRole: context.role,
      action: AuditAction.CREATE,
      entity: "Zone",
      entityId: zone.id,
      payload: {
        source: "PastorPopup",
        pastorMemberId: member.id,
      },
    });

    revalidatePath("/dashboard/pastors");
    revalidatePath("/dashboard/admin/churches");
    revalidatePath("/dashboard/settings");
    return { success: true, message: `Zone ${zone.name} created and pastor assigned.` };
  } catch {
    return { success: false, message: "Could not create zone. Name may already exist in that church." };
  }
}
