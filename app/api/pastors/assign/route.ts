import { AuditAction, Prisma, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logAudit } from "@/lib/audit";
import { getServerAuthSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureMemberLeaderUser } from "@/lib/leader-account";
import { hasPermission } from "@/lib/rbac";

const payloadSchema = z
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

function unauthorized() {
  return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user?.id || !hasPermission(session.user.role, "members:manage")) {
    return unauthorized();
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = payloadSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Pastor assignment payload is invalid." }, { status: 400 });
  }

  const requestedChurchId = toNullable(parsed.data.churchId ?? "");
  const defaultChurchId = session.user.churchId;
  const targetChurchId = hasPermission(session.user.role, "church:create")
    ? requestedChurchId ?? defaultChurchId
    : defaultChurchId;

  if (!targetChurchId) {
    return NextResponse.json({ success: false, message: "No church selected." }, { status: 400 });
  }

  const targetChurch = await db.church.findUnique({
    where: { id: targetChurchId },
    select: { id: true },
  });
  if (!targetChurch) {
    return NextResponse.json({ success: false, message: "Selected church is invalid." }, { status: 400 });
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
    return NextResponse.json(
      { success: false, message: "Selected member is invalid for the selected church." },
      { status: 400 },
    );
  }

  if (parsed.data.zoneMode === "EXISTING") {
    const zoneId = toNullable(parsed.data.zoneId ?? "");
    const zone = await db.zone.findFirst({
      where: { id: zoneId ?? "", churchId: targetChurchId },
      select: { id: true, name: true },
    });
    if (!zone) {
      return NextResponse.json(
        { success: false, message: "Selected zone is invalid for the selected church." },
        { status: 400 },
      );
    }

    const pastorLoginResult = await ensureMemberLeaderUser({
      churchId: targetChurchId,
      memberId: member.id,
      role: Role.PASTOR,
    });
    if ("error" in pastorLoginResult) {
      return NextResponse.json({ success: false, message: pastorLoginResult.error }, { status: 400 });
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
      return NextResponse.json(
        { success: false, message: "Selected zone already has a pastor assigned. Choose an unoccupied zone." },
        { status: 409 },
      );
    }

    await logAudit({
      churchId: targetChurchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
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

    if (pastorLoginResult.createdEmail) {
      if (session.user.role === Role.SUPER_ADMIN && pastorLoginResult.createdPassword) {
        return NextResponse.json({
          success: true,
          message: `${member.firstName} ${member.lastName} assigned to ${zone.name}. Temporary login ${pastorLoginResult.createdEmail} / ${pastorLoginResult.createdPassword}. Password reset is required at first sign-in.`,
        });
      }
      return NextResponse.json({
        success: true,
        message: `${member.firstName} ${member.lastName} assigned to ${zone.name}. Login: ${pastorLoginResult.createdEmail}. Temporary password is visible to Super Admin only.`,
      });
    }

    return NextResponse.json({
      success: true,
      message: `${member.firstName} ${member.lastName} assigned to ${zone.name}.`,
    });
  }

  const newZoneName = (parsed.data.newZoneName ?? "").trim();
  const existingZone = await db.zone.findFirst({
    where: { churchId: targetChurchId, name: newZoneName },
    select: { id: true },
  });
  if (existingZone) {
    return NextResponse.json(
      { success: false, message: "Could not create zone. Name may already exist in that church." },
      { status: 409 },
    );
  }

  const pastorLoginResult = await ensureMemberLeaderUser({
    churchId: targetChurchId,
    memberId: member.id,
    role: Role.PASTOR,
  });
  if ("error" in pastorLoginResult) {
    return NextResponse.json({ success: false, message: pastorLoginResult.error }, { status: 400 });
  }

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
      actorUserId: session.user.id,
      actorRole: session.user.role,
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

    if (pastorLoginResult.createdEmail) {
      if (session.user.role === Role.SUPER_ADMIN && pastorLoginResult.createdPassword) {
        return NextResponse.json({
          success: true,
          message: `Zone ${zone.name} created and pastor assigned. Temporary login ${pastorLoginResult.createdEmail} / ${pastorLoginResult.createdPassword}. Password reset is required at first sign-in.`,
        });
      }
      return NextResponse.json({
        success: true,
        message: `Zone ${zone.name} created and pastor assigned. Login: ${pastorLoginResult.createdEmail}. Temporary password is visible to Super Admin only.`,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Zone ${zone.name} created and pastor assigned.`,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { success: false, message: "Could not create zone. Name may already exist in that church." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { success: false, message: "Could not create zone. Please try again." },
      { status: 500 },
    );
  }
}
