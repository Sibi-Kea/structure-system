import { AuditAction, Prisma, Role } from "@prisma/client";

type RawAuditFilters = {
  q?: string | null;
  action?: string | null;
  actorRole?: string | null;
  entity?: string | null;
  from?: string | null;
  to?: string | null;
  churchId?: string | null;
  page?: string | null;
};

export type AuditFilters = {
  q: string;
  action: AuditAction | null;
  actorRole: Role | null;
  entity: string;
  from: string;
  to: string;
  churchId: string;
  page: number;
  pageSize: number;
  fromDate: Date | null;
  toExclusiveDate: Date | null;
};

function normalizeText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseAction(value: string): AuditAction | null {
  if (!value) return null;
  return (Object.values(AuditAction) as string[]).includes(value) ? (value as AuditAction) : null;
}

function parseRole(value: string): Role | null {
  if (!value) return null;
  return (Object.values(Role) as string[]).includes(value) ? (value as Role) : null;
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseAuditFilters(input: RawAuditFilters, pageSize = 30): AuditFilters {
  const q = normalizeText(input.q);
  const actionRaw = normalizeText(input.action);
  const actorRoleRaw = normalizeText(input.actorRole);
  const entity = normalizeText(input.entity);
  const from = normalizeText(input.from);
  const to = normalizeText(input.to);
  const churchId = normalizeText(input.churchId);
  const page = parsePositiveInt(normalizeText(input.page), 1);
  const fromDate = parseDateKey(from);
  const toDate = parseDateKey(to);
  const toExclusiveDate = toDate ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000) : null;

  return {
    q,
    action: parseAction(actionRaw),
    actorRole: parseRole(actorRoleRaw),
    entity,
    from,
    to,
    churchId,
    page,
    pageSize,
    fromDate,
    toExclusiveDate,
  };
}

export function buildAuditWhere(input: {
  filters: AuditFilters;
  churchId?: string;
  canViewAllChurches?: boolean;
}): Prisma.AuditLogWhereInput {
  const { filters, churchId, canViewAllChurches } = input;
  const where: Prisma.AuditLogWhereInput = {};
  const targetChurchId = canViewAllChurches ? (filters.churchId || undefined) : churchId;

  if (targetChurchId) {
    where.churchId = targetChurchId;
  }

  if (filters.action) {
    where.action = filters.action;
  }

  if (filters.actorRole) {
    where.actorRole = filters.actorRole;
  }

  if (filters.entity) {
    where.entity = filters.entity;
  }

  if (filters.fromDate || filters.toExclusiveDate) {
    where.createdAt = {
      ...(filters.fromDate ? { gte: filters.fromDate } : {}),
      ...(filters.toExclusiveDate ? { lt: filters.toExclusiveDate } : {}),
    };
  }

  if (filters.q) {
    where.OR = [
      { entity: { contains: filters.q, mode: "insensitive" } },
      { entityId: { contains: filters.q, mode: "insensitive" } },
      { actor: { name: { contains: filters.q, mode: "insensitive" } } },
      { actor: { email: { contains: filters.q, mode: "insensitive" } } },
    ];
  }

  return where;
}

