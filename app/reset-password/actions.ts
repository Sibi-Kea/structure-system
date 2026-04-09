"use server";

import { AuditAction } from "@prisma/client";
import { z } from "zod";

import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requireAuth } from "@/lib/tenant";

const resetPasswordSchema = z
  .object({
    password: z.string().min(12, "Password must be at least 12 characters.").max(128),
    confirmPassword: z.string().min(12).max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export async function completePasswordResetAction(formData: FormData) {
  const session = await requireAuth();

  if (!session.user.passwordChangeRequired) {
    return { success: false, message: "Password reset is not required for this account." };
  }

  const parsed = resetPasswordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid password." };
  }

  const nextHash = await hashPassword(parsed.data.password);

  await db.user.update({
    where: { id: session.user.id },
    data: {
      passwordHash: nextHash,
      passwordChangeRequired: false,
    },
  });

  await logAudit({
    churchId: session.user.churchId,
    actorUserId: session.user.id,
    actorRole: session.user.role,
    action: AuditAction.UPDATE,
    entity: "UserPasswordReset",
    entityId: session.user.id,
  });

  return { success: true, message: "Password updated. Please sign in again." };
}
