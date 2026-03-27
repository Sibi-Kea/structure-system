import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { csvResponse } from "@/app/api/exports/_helpers";
import { getServerAuthSession } from "@/lib/auth/session";
import { buildAuditWhere, parseAuditFilters } from "@/lib/audit-query";
import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";

export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user?.id || !hasPermission(session.user.role, "users:manage")) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const canViewAllChurches = hasPermission(session.user.role, "church:view_all");
  if (!session.user.churchId && !canViewAllChurches) {
    return NextResponse.json({ message: "No church context" }, { status: 400 });
  }

  const url = new URL(request.url);
  const filters = parseAuditFilters({
    q: url.searchParams.get("q"),
    action: url.searchParams.get("action"),
    actorRole: url.searchParams.get("actorRole"),
    entity: url.searchParams.get("entity"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    churchId: url.searchParams.get("churchId"),
  });
  const where = buildAuditWhere({
    filters,
    churchId: session.user.churchId ?? undefined,
    canViewAllChurches,
  });

  const logs = await db.auditLog.findMany({
    where,
    include: {
      actor: {
        select: {
          name: true,
          email: true,
        },
      },
      church: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const rows = logs.map((log) => ({
    id: log.id,
    createdAt: log.createdAt.toISOString(),
    church: log.church?.name ?? "",
    actorName: log.actor.name,
    actorEmail: log.actor.email,
    actorRole: log.actorRole,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId ?? "",
    payload: log.payload ? JSON.stringify(log.payload as Prisma.JsonValue) : "",
  }));

  return csvResponse(toCsv(rows), `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`);
}

