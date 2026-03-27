import { AuditAction, Prisma, Role } from "@prisma/client";
import Link from "next/link";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { buildAuditWhere, parseAuditFilters } from "@/lib/audit-query";
import { db } from "@/lib/db";
import { formatDateTimeInAppTimezone, getAppTimezone } from "@/lib/datetime";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";

type SearchParams = {
  q?: string;
  action?: string;
  actorRole?: string;
  entity?: string;
  from?: string;
  to?: string;
  churchId?: string;
  page?: string;
};

function buildQueryString(input: {
  q: string;
  action: string;
  actorRole: string;
  entity: string;
  from: string;
  to: string;
  churchId: string;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.action) params.set("action", input.action);
  if (input.actorRole) params.set("actorRole", input.actorRole);
  if (input.entity) params.set("entity", input.entity);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.churchId) params.set("churchId", input.churchId);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  return params.toString();
}

function formatPayload(payload: Prisma.JsonValue | null) {
  if (!payload) return "";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireChurchContext();
  const canViewAudit = hasPermission(context.role, "users:manage");

  if (!canViewAudit) {
    return (
      <Card>
        <CardTitle>Audit Logs Restricted</CardTitle>
        <CardDescription className="mt-1">
          Only pastors, church admins, and super admins can access audit logs.
        </CardDescription>
      </Card>
    );
  }

  const canViewAllChurches = hasPermission(context.role, "church:view_all");
  const scopedChurchId = canViewAllChurches ? undefined : assertChurch(context.churchId);
  const params = await searchParams;
  const filters = parseAuditFilters({
    q: params.q,
    action: params.action,
    actorRole: params.actorRole,
    entity: params.entity,
    from: params.from,
    to: params.to,
    churchId: params.churchId,
    page: params.page,
  });
  const where = buildAuditWhere({
    filters,
    churchId: scopedChurchId,
    canViewAllChurches,
  });
  const scopeWhere: Prisma.AuditLogWhereInput = canViewAllChurches
    ? filters.churchId
      ? { churchId: filters.churchId }
      : {}
    : { churchId: scopedChurchId };

  const [logs, total, entityGroups, churches] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: {
        actor: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({
      by: ["entity"],
      where: scopeWhere,
      _count: { _all: true },
      orderBy: { entity: "asc" },
    }),
    canViewAllChurches
      ? db.church.findMany({
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const entities = entityGroups.map((row) => row.entity).filter((value): value is string => Boolean(value));
  const activeAction = filters.action ?? "";
  const activeActorRole = filters.actorRole ?? "";
  const timezoneLabel = getAppTimezone();
  const exportQuery = buildQueryString({
    q: filters.q,
    action: activeAction,
    actorRole: activeActorRole,
    entity: filters.entity,
    from: filters.from,
    to: filters.to,
    churchId: filters.churchId,
  });

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Audit Logs</CardTitle>
            <CardDescription className="mt-1">
              Review system activity, filter records, and export the current result set.
            </CardDescription>
          </div>
          <Link
            href={exportQuery ? `/api/exports/audit?${exportQuery}` : "/api/exports/audit"}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Export CSV
          </Link>
        </div>
      </Card>

      <Card>
        <form method="get" className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <input
            type="text"
            name="q"
            defaultValue={filters.q}
            placeholder="Search actor, entity, or id"
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
          />
          <select
            name="action"
            defaultValue={activeAction}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
          >
            <option value="">All actions</option>
            {Object.values(AuditAction).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            name="actorRole"
            defaultValue={activeActorRole}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
          >
            <option value="">All roles</option>
            {Object.values(Role).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            name="entity"
            defaultValue={filters.entity}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
          >
            <option value="">All entities</option>
            {entities.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
          />
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
          />
          {canViewAllChurches ? (
            <select
              name="churchId"
              defaultValue={filters.churchId}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            >
              <option value="">All churches</option>
              {churches.map((church) => (
                <option key={church.id} value={church.id}>
                  {church.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700"
            >
              Apply
            </button>
            <Link
              href="/dashboard/audit"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <Card>
        <CardDescription className="mb-3">
          Showing {logs.length} of {total} logs. Times shown in {timezoneLabel}.
        </CardDescription>
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Time</TableHeaderCell>
                <TableHeaderCell>Actor</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Action</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Entity ID</TableHeaderCell>
                <TableHeaderCell>Payload</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.map((log) => {
                const payloadText = formatPayload(log.payload as Prisma.JsonValue | null);
                return (
                  <TableRow key={log.id}>
                    <TableCell>{formatDateTimeInAppTimezone(log.createdAt)}</TableCell>
                    <TableCell>
                      <p className="font-medium text-slate-800">{log.actor.name}</p>
                      <p className="text-xs text-slate-500">{log.actor.email}</p>
                    </TableCell>
                    <TableCell>{log.actorRole}</TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell>{log.entity}</TableCell>
                    <TableCell>{log.entityId ?? "-"}</TableCell>
                    <TableCell className="max-w-md">
                      {payloadText ? (
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-sky-700">View</summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-100 p-2 text-[11px] text-slate-700">
                            {payloadText}
                          </pre>
                        </details>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-slate-500">
                    No audit logs found for the selected filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4">
          <Pagination
            page={filters.page}
            totalPages={totalPages}
            buildHref={(page) => {
              const query = buildQueryString({
                q: filters.q,
                action: activeAction,
                actorRole: activeActorRole,
                entity: filters.entity,
                from: filters.from,
                to: filters.to,
                churchId: filters.churchId,
                page,
              });
              return query ? `/dashboard/audit?${query}` : "/dashboard/audit";
            }}
          />
        </div>
      </Card>
    </div>
  );
}
