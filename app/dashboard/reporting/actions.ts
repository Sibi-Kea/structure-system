"use server";

import { AuditAction, Prisma, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { REPORTING_DEADLINE_LABELS, getWeeklyReportingTimeline } from "@/lib/reporting-deadlines";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";
import { homecellReportMemberSchema } from "@/lib/validations/homecell-report";

const reportingBaseSchema = z.object({
  homecellId: z.string().cuid(),
  weekStartDate: z.string(),
  weekEndDate: z.string(),
});

const reportingMembersSchema = reportingBaseSchema.extend({
  members: z.array(homecellReportMemberSchema).min(1),
});

const reportingMemberRowSchema = reportingBaseSchema.extend({
  totalMembers: z.coerce.number().int().min(0),
  member: homecellReportMemberSchema,
});

const reportingVisitorsItemSchema = z.object({
  id: z.string().trim().max(120).optional(),
  name: z.string().trim().min(2).max(120),
  present: z.coerce.boolean().optional(),
  homecellPresent: z.boolean().nullable().optional(),
  churchPresent: z.coerce.boolean().optional(),
  churchMorningPresent: z.boolean().nullable().optional(),
  churchMorningAttendedLabel: z.string().trim().max(120).optional().or(z.literal("")),
  churchEveningPresent: z.boolean().nullable().optional(),
  churchEveningAttendedLabel: z.string().trim().max(120).optional().or(z.literal("")),
});

const reportingVisitorsSchema = reportingBaseSchema.extend({
  items: z.array(reportingVisitorsItemSchema).max(500),
});

const reportingFirstVisitorsSchema = reportingBaseSchema.extend({
  items: z.array(reportingVisitorsItemSchema).max(500),
});

const reportingVisitorRowSchema = reportingBaseSchema.extend({
  mode: z.enum(["visitors", "first-visitors"]),
  item: reportingVisitorsItemSchema,
});

const reportingSalvationItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2).max(120),
  source: z.enum(["MEMBER", "VISITOR", "FTV"]),
  location: z.enum(["HOMECELL", "CHURCH"]),
});

const reportingSalvationsSchema = reportingBaseSchema.extend({
  items: z.array(reportingSalvationItemSchema).max(500),
});

type ReportingMember = z.infer<typeof homecellReportMemberSchema>;
type ReportingVisitorsItem = z.infer<typeof reportingVisitorsItemSchema>;
type ReportingSalvationItem = z.infer<typeof reportingSalvationItemSchema>;
type ReportingSalvationSource = ReportingSalvationItem["source"];

type ParsedVisitorsAttendanceItem = {
  id: string;
  name: string;
  present: boolean;
  homecellPresent: boolean | null;
  churchPresent: boolean;
  churchMorningPresent: boolean | null;
  churchEveningPresent: boolean | null;
};

type ResolvedMemberDraft = {
  member: ReportingMember;
  homecellPresent: boolean | null;
  homecellAbsenceReason: string | null;
  homecellAbsenceNote: string | null;
  churchMorningPresent: boolean | null;
  churchMorningAttendedLabels: string[];
  churchMorningAttendedLabel: string | null;
  churchMorningAbsenceReason: string | null;
  churchMorningAbsenceNote: string | null;
  churchEveningPresent: boolean | null;
  churchEveningAttendedLabel: string | null;
  churchEveningAbsenceReason: string | null;
  churchEveningAbsenceNote: string | null;
  churchPresent: boolean;
  churchAttendedLabels: string[];
  churchAbsenceReason: string | null;
  churchAbsenceNote: string | null;
  present: boolean;
};

type ResolvedVisitorDraft = {
  id: string;
  name: string;
  present: boolean;
  homecellPresent: boolean | null;
  churchPresent: boolean;
  churchMorningPresent: boolean | null;
  churchMorningAttendedLabel: string | null;
  churchEveningPresent: boolean | null;
  churchEveningAttendedLabel: string | null;
};

type SalvationEligibility = {
  id: string;
  source: ReportingSalvationSource;
  name: string;
  eligible: boolean;
};

function toNullableText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toUniqueTextList(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function withStableId(id?: string | null) {
  const resolved = toNullableText(id);
  return resolved ?? crypto.randomUUID();
}

function withDefinedProperties<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== null && entryValue !== undefined),
  ) as Partial<T>;
}

function resolveMemberDraft(member: ReportingMember): ResolvedMemberDraft {
  const legacyLabels = toUniqueTextList(member.churchAttendedLabels ?? []);
  const legacyChurchPresent = member.churchPresent;

  const homecellPresent = typeof member.homecellPresent === "boolean" ? member.homecellPresent : null;

  const churchMorningPresent =
    typeof member.churchMorningPresent === "boolean"
      ? member.churchMorningPresent
      : member.churchMorningPresent === null
        ? null
      : typeof legacyChurchPresent === "boolean"
        ? legacyChurchPresent
        : null;
  const churchEveningPresent =
    typeof member.churchEveningPresent === "boolean"
      ? member.churchEveningPresent
      : member.churchEveningPresent === null
        ? null
      : typeof legacyChurchPresent === "boolean"
        ? legacyChurchPresent
        : null;

  const churchMorningAttendedLabels =
    churchMorningPresent === true
      ? toUniqueTextList([
          ...(member.churchMorningAttendedLabels ?? []),
          member.churchMorningAttendedLabel,
          legacyLabels[0],
        ])
      : [];
  const eveningLabelCandidate =
    toNullableText(member.churchEveningAttendedLabel) ??
    legacyLabels.find((label) => !churchMorningAttendedLabels.includes(label)) ??
    null;

  const churchMorningAttendedLabel = churchMorningAttendedLabels[0] ?? null;
  const churchEveningAttendedLabel = churchEveningPresent === true ? eveningLabelCandidate : null;
  const churchMorningAbsenceReason =
    churchMorningPresent === false
      ? toNullableText(member.churchMorningAbsenceReason) ?? toNullableText(member.churchAbsenceReason)
      : null;
  const churchMorningAbsenceNote =
    churchMorningPresent === false
      ? toNullableText(member.churchMorningAbsenceNote) ?? toNullableText(member.churchAbsenceNote)
      : null;
  const churchEveningAbsenceReason =
    churchEveningPresent === false
      ? toNullableText(member.churchEveningAbsenceReason) ?? toNullableText(member.churchAbsenceReason)
      : null;
  const churchEveningAbsenceNote =
    churchEveningPresent === false
      ? toNullableText(member.churchEveningAbsenceNote) ?? toNullableText(member.churchAbsenceNote)
      : null;

  const churchAttendedLabels = toUniqueTextList([
    ...(churchMorningPresent === true ? churchMorningAttendedLabels : []),
    churchEveningPresent === true ? churchEveningAttendedLabel : null,
  ]);
  const churchPresent = churchMorningPresent === true || churchEveningPresent === true;
  const churchAbsenceReason =
    churchMorningPresent === false && churchEveningPresent === false
      ? churchMorningAbsenceReason ?? churchEveningAbsenceReason
      : null;
  const churchAbsenceNote =
    churchMorningPresent === false && churchEveningPresent === false
      ? churchMorningAbsenceNote ?? churchEveningAbsenceNote
      : null;
  const homecellAbsenceReason =
    homecellPresent === false ? toNullableText(member.homecellAbsenceReason) ?? toNullableText(member.absenceReason) : null;
  const homecellAbsenceNote =
    homecellPresent === false ? toNullableText(member.homecellAbsenceNote) ?? toNullableText(member.absenceNote) : null;
  const present = homecellPresent === true;

  return {
    member,
    homecellPresent,
    homecellAbsenceReason,
    homecellAbsenceNote,
    churchMorningPresent,
    churchMorningAttendedLabels,
    churchMorningAttendedLabel,
    churchMorningAbsenceReason,
    churchMorningAbsenceNote,
    churchEveningPresent,
    churchEveningAttendedLabel,
    churchEveningAbsenceReason,
    churchEveningAbsenceNote,
    churchPresent,
    churchAttendedLabels,
    churchAbsenceReason,
    churchAbsenceNote,
    present,
  };
}

function resolveVisitorDraft(item: ReportingVisitorsItem): ResolvedVisitorDraft {
  const legacyPresent = item.present ?? false;
  const homecellPresent =
    typeof item.homecellPresent === "boolean"
      ? item.homecellPresent
      : item.homecellPresent === null
        ? null
        : legacyPresent;
  const churchMorningPresent =
    typeof item.churchMorningPresent === "boolean"
      ? item.churchMorningPresent
      : item.churchMorningPresent === null
        ? null
      : typeof item.churchPresent === "boolean"
        ? item.churchPresent
        : null;
  const churchEveningPresent =
    typeof item.churchEveningPresent === "boolean"
      ? item.churchEveningPresent
      : item.churchEveningPresent === null
        ? null
      : typeof item.churchPresent === "boolean"
        ? item.churchPresent
        : null;
  const churchMorningAttendedLabel =
    churchMorningPresent === true ? toNullableText(item.churchMorningAttendedLabel) : null;
  const churchEveningAttendedLabel =
    churchEveningPresent === true ? toNullableText(item.churchEveningAttendedLabel) : null;
  const churchPresent = churchMorningPresent === true || churchEveningPresent === true;
  const present = homecellPresent === true || churchPresent;

  return {
    id: withStableId(item.id),
    name: item.name.trim(),
    present,
    homecellPresent,
    churchPresent,
    churchMorningPresent,
    churchMorningAttendedLabel,
    churchEveningPresent,
    churchEveningAttendedLabel,
  };
}

function normalizeVisitorsItems(items: ReportingVisitorsItem[]) {
  return items.map(resolveVisitorDraft);
}

function normalizeSalvationItems(items: ReportingSalvationItem[]) {
  return items.map((item) => ({
    id: item.id.trim(),
    name: item.name.trim(),
    source: item.source,
    location: item.location,
  }));
}

function parseVisitorsAttendanceItems(value: Prisma.JsonValue | null | undefined): ParsedVisitorsAttendanceItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];

    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const legacyPresent = typeof source.present === "boolean" ? source.present : true;
    const homecellPresent =
      typeof source.homecellPresent === "boolean"
        ? source.homecellPresent
        : source.homecellPresent === null
          ? null
          : legacyPresent;
    const churchMorningPresent =
      typeof source.churchMorningPresent === "boolean"
        ? source.churchMorningPresent
        : source.churchMorningPresent === null
          ? null
        : typeof source.churchPresent === "boolean"
          ? source.churchPresent
          : null;
    const churchEveningPresent =
      typeof source.churchEveningPresent === "boolean"
        ? source.churchEveningPresent
        : source.churchEveningPresent === null
          ? null
        : typeof source.churchPresent === "boolean"
          ? source.churchPresent
          : null;
    const churchPresent = churchMorningPresent === true || churchEveningPresent === true;
    const present = homecellPresent === true || churchPresent;
    if (!id || !name) return [];

    return [{ id, name, present, homecellPresent, churchPresent, churchMorningPresent, churchEveningPresent }];
  });
}

function salvationEligibilityKey(source: ReportingSalvationSource, id: string) {
  return `${source}:${id}`;
}

async function getSalvationEligibilitySet({
  churchId,
  homecellId,
  weekStartDate,
}: {
  churchId: string;
  homecellId: string;
  weekStartDate: Date;
}) {
  const [members, report] = await Promise.all([
    db.member.findMany({
      where: {
        churchId,
        homecellId,
        isDeleted: false,
        membershipStatus: "ACTIVE",
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    }),
    db.homecellReport.findUnique({
      where: {
        churchId_homecellId_weekStartDate: {
          churchId,
          homecellId,
          weekStartDate,
        },
      },
      select: {
        memberItems: {
          select: {
            memberId: true,
            homecellPresent: true,
            churchPresent: true,
            churchMorningPresent: true,
            churchEveningPresent: true,
          },
        },
        visitorItems: true,
        firstTimeVisitorItems: true,
      },
    }),
  ]);

  const memberPresenceById = new Map(
    (report?.memberItems ?? [])
      .filter((item) => item.memberId)
      .map((item) => {
        const churchPresent = item.churchPresent || item.churchMorningPresent || item.churchEveningPresent;
        return [item.memberId as string, item.homecellPresent || churchPresent];
      }),
  );

  const eligibility = new Map<string, SalvationEligibility>();
  for (const member of members) {
    const name = `${member.firstName} ${member.lastName}`.trim();
    eligibility.set(salvationEligibilityKey("MEMBER", member.id), {
      id: member.id,
      source: "MEMBER",
      name,
      eligible: memberPresenceById.get(member.id) ?? false,
    });
  }

  for (const visitor of parseVisitorsAttendanceItems(report?.visitorItems)) {
    const eligible = visitor.homecellPresent || visitor.churchPresent;
    eligibility.set(salvationEligibilityKey("VISITOR", visitor.id), {
      id: visitor.id,
      source: "VISITOR",
      name: visitor.name,
      eligible,
    });
  }

  for (const firstVisitor of parseVisitorsAttendanceItems(report?.firstTimeVisitorItems)) {
    const eligible = firstVisitor.homecellPresent || firstVisitor.churchPresent;
    eligibility.set(salvationEligibilityKey("FTV", firstVisitor.id), {
      id: firstVisitor.id,
      source: "FTV",
      name: firstVisitor.name,
      eligible,
    });
  }

  return eligibility;
}

type ReportingWriteContextResult =
  | {
      success: true;
      churchId: string;
      userId: string;
      role: Role;
      weekStartDate: Date;
      weekEndDate: Date;
      existingReport: { id: string; isLocked: boolean } | null;
    }
  | {
      success: false;
      message: string;
    };

async function resolveReportingWriteContext(
  data: z.infer<typeof reportingBaseSchema>,
): Promise<ReportingWriteContextResult> {
  const context = await requireChurchContext();
  if (!hasPermission(context.role, "homecell_reports:submit")) {
    return { success: false, message: "You cannot submit homecell member reporting." };
  }

  const churchId = assertChurch(context.churchId);
  const rawWeekStartDate = new Date(data.weekStartDate);
  if (Number.isNaN(rawWeekStartDate.getTime())) {
    return { success: false, message: "Invalid report week dates." };
  }
  const timeline = getWeeklyReportingTimeline(rawWeekStartDate);
  const weekStartDate = timeline.weekStartDate;
  const weekEndDate = timeline.weekEndDate;

  const homecell = await db.homecell.findFirst({
    where: {
      id: data.homecellId,
      churchId,
    },
    select: {
      id: true,
      leaderId: true,
    },
  });
  if (!homecell) {
    return { success: false, message: "Selected homecell is invalid." };
  }

  if (context.role === Role.HOMECELL_LEADER && homecell.leaderId !== context.userId) {
    return { success: false, message: "You can only submit reports for your assigned homecell." };
  }

  const existingReport = await db.homecellReport.findUnique({
    where: {
      churchId_homecellId_weekStartDate: {
        churchId,
        homecellId: data.homecellId,
        weekStartDate,
      },
    },
    select: {
      id: true,
      isLocked: true,
    },
  });

  const now = new Date();
  if (now >= timeline.lockAt) {
    if (existingReport && !existingReport.isLocked) {
      await db.homecellReport.update({
        where: { id: existingReport.id, churchId },
        data: { isLocked: true },
      });
    }

    return {
      success: false,
      message: `Reporting for this week is closed from ${REPORTING_DEADLINE_LABELS.lockAt}. Continue with the new week.`,
    };
  }

  if (existingReport?.isLocked) {
    return { success: false, message: "This week report is locked. Ask a supervisor/overseer to unlock it first." };
  }

  return {
    success: true,
    churchId,
    userId: context.userId,
    role: context.role,
    weekStartDate,
    weekEndDate,
    existingReport,
  };
}

function validateMemberDraft(resolved: ResolvedMemberDraft, options: { allowPending: boolean }) {
  if (!options.allowPending) {
    if (resolved.homecellPresent === null) return "Each member must have homecell attendance submitted.";
    if (resolved.churchMorningPresent === null) return "Each member must have morning church attendance submitted.";
    if (resolved.churchEveningPresent === null) return "Each member must have evening church attendance submitted.";
  }

  if (
    options.allowPending &&
    resolved.homecellPresent === null &&
    resolved.churchMorningPresent === null &&
    resolved.churchEveningPresent === null
  ) {
    return "Set homecell, morning, or evening attendance before submitting this member.";
  }

  if (resolved.homecellPresent === false && !resolved.homecellAbsenceReason) {
    return "Each homecell absence needs its own reason.";
  }
  if (resolved.churchMorningPresent === false && !resolved.churchMorningAbsenceReason) {
    return "Each morning absence needs its own reason.";
  }
  if (resolved.churchEveningPresent === false && !resolved.churchEveningAbsenceReason) {
    return "Each evening absence needs its own reason.";
  }
  if (resolved.churchMorningPresent === true && resolved.churchMorningAttendedLabels.length === 0) {
    return "Each member must have at least one morning service or online option selected.";
  }
  if (resolved.churchEveningPresent === true && !resolved.churchEveningAttendedLabel) {
    return "Each member must have one evening service or online option selected.";
  }

  return null;
}

function validateVisitorDraft(
  resolved: ResolvedVisitorDraft,
  options: { allowPending: boolean; label: string },
) {
  if (!options.allowPending) {
    if (resolved.homecellPresent === null) return `Each ${options.label} needs homecell attendance submitted.`;
    if (resolved.churchMorningPresent === null) return `Each ${options.label} needs morning church attendance submitted.`;
    if (resolved.churchEveningPresent === null) return `Each ${options.label} needs evening church attendance submitted.`;
  }

  if (
    options.allowPending &&
    resolved.homecellPresent === null &&
    resolved.churchMorningPresent === null &&
    resolved.churchEveningPresent === null
  ) {
    return `Set homecell, morning, or evening attendance before submitting this ${options.label}.`;
  }

  if (resolved.churchMorningPresent === true && !resolved.churchMorningAttendedLabel) {
    return `Each ${options.label} needs one morning service or online selection, or mark morning absent.`;
  }
  if (resolved.churchEveningPresent === true && !resolved.churchEveningAttendedLabel) {
    return `Each ${options.label} needs one evening service or online selection, or mark evening absent.`;
  }

  return null;
}

async function ensureDraftReport(args: {
  churchId: string;
  userId: string;
  homecellId: string;
  weekStartDate: Date;
  weekEndDate: Date;
  existingReport: { id: string; isLocked: boolean } | null;
  totalMembers?: number;
}) {
  if (args.existingReport) {
    return args.existingReport.id;
  }

  const report = await db.homecellReport.create({
    data: {
      churchId: args.churchId,
      homecellId: args.homecellId,
      submittedById: args.userId,
      weekStartDate: args.weekStartDate,
      weekEndDate: args.weekEndDate,
      isLocked: false,
      totalMembers: args.totalMembers ?? 0,
      membersPresent: 0,
      membersAbsent: 0,
      visitors: 0,
      firstTimeVisitors: 0,
      visitorItems: [],
      firstTimeVisitorItems: [],
      salvationItems: [],
    },
    select: { id: true },
  });

  return report.id;
}

export async function submitReportingMembersAction(payload: unknown) {
  const parsed = reportingMembersSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, message: "Invalid reporting payload." };
  }

  const resolvedContext = await resolveReportingWriteContext(parsed.data);
  if (!resolvedContext.success) {
    return resolvedContext;
  }

  const { churchId, userId, role, weekStartDate, weekEndDate, existingReport } = resolvedContext;

  const resolvedMembers = parsed.data.members.map(resolveMemberDraft);
  const validationError = resolvedMembers.map((resolved) => validateMemberDraft(resolved, { allowPending: false })).find(Boolean);
  if (validationError) {
    return { success: false, message: validationError };
  }

  const presentCount = resolvedMembers.filter((resolved) => resolved.homecellPresent === true).length;
  const absentCount = resolvedMembers.filter((resolved) => resolved.homecellPresent === false).length;

  if (!existingReport) {
    const report = await db.homecellReport.create({
      data: {
        churchId,
        homecellId: parsed.data.homecellId,
        submittedById: userId,
        weekStartDate,
        weekEndDate,
        isLocked: false,
        totalMembers: parsed.data.members.length,
        membersPresent: presentCount,
        membersAbsent: absentCount,
        visitors: 0,
        firstTimeVisitors: 0,
        prayerRequests: null,
        offeringCollected: null,
        memberItems: {
          create: resolvedMembers.map((resolved) => {
            const { member } = resolved;
            return {
              churchId,
              memberId: member.memberId ?? null,
              memberName: member.memberName,
              present: resolved.present,
              absenceReason: resolved.homecellAbsenceReason,
              absenceNote: resolved.homecellAbsenceNote,
              homecellPresent: resolved.homecellPresent,
              homecellAbsenceReason: resolved.homecellAbsenceReason,
              homecellAbsenceNote: resolved.homecellAbsenceNote,
              churchPresent: resolved.churchPresent,
              churchAttendedLabels: resolved.churchAttendedLabels,
              churchAbsenceReason: resolved.churchAbsenceReason,
              churchAbsenceNote: resolved.churchAbsenceNote,
              churchMorningPresent: resolved.churchMorningPresent,
              churchMorningAttendedLabel: resolved.churchMorningAttendedLabel,
              churchMorningAbsenceReason: resolved.churchMorningAbsenceReason,
              churchMorningAbsenceNote: resolved.churchMorningAbsenceNote,
              churchEveningPresent: resolved.churchEveningPresent,
              churchEveningAttendedLabel: resolved.churchEveningAttendedLabel,
              churchEveningAbsenceReason: resolved.churchEveningAbsenceReason,
              churchEveningAbsenceNote: resolved.churchEveningAbsenceNote,
            };
          }),
        },
      },
    });

    await logAudit({
      churchId,
      actorUserId: userId,
      actorRole: role,
      action: AuditAction.CREATE,
      entity: "HomecellReport",
      entityId: report.id,
    });
  } else {
    await db.$transaction([
      db.homecellReport.update({
        where: { id: existingReport.id, churchId },
        data: {
          submittedById: userId,
          weekEndDate,
          totalMembers: parsed.data.members.length,
          membersPresent: presentCount,
          membersAbsent: absentCount,
        },
      }),
      db.homecellReportItem.deleteMany({
        where: {
          churchId,
          reportId: existingReport.id,
        },
      }),
      db.homecellReportItem.createMany({
        data: resolvedMembers.map((resolved) => {
          const { member } = resolved;
          return {
            churchId,
            reportId: existingReport.id,
            memberId: member.memberId ?? null,
            memberName: member.memberName,
            present: resolved.present,
            absenceReason: resolved.homecellAbsenceReason,
            absenceNote: resolved.homecellAbsenceNote,
            homecellPresent: resolved.homecellPresent,
            homecellAbsenceReason: resolved.homecellAbsenceReason,
            homecellAbsenceNote: resolved.homecellAbsenceNote,
            churchPresent: resolved.churchPresent,
            churchAttendedLabels: resolved.churchAttendedLabels,
            churchAbsenceReason: resolved.churchAbsenceReason,
            churchAbsenceNote: resolved.churchAbsenceNote,
            churchMorningPresent: resolved.churchMorningPresent,
            churchMorningAttendedLabel: resolved.churchMorningAttendedLabel,
            churchMorningAbsenceReason: resolved.churchMorningAbsenceReason,
            churchMorningAbsenceNote: resolved.churchMorningAbsenceNote,
            churchEveningPresent: resolved.churchEveningPresent,
            churchEveningAttendedLabel: resolved.churchEveningAttendedLabel,
            churchEveningAbsenceReason: resolved.churchEveningAbsenceReason,
            churchEveningAbsenceNote: resolved.churchEveningAbsenceNote,
          };
        }),
      }),
    ]);

    await logAudit({
      churchId,
      actorUserId: userId,
      actorRole: role,
      action: AuditAction.UPDATE,
      entity: "HomecellReport",
      entityId: existingReport.id,
    });
  }

  revalidatePath("/dashboard/reporting");
  revalidatePath("/dashboard/homecells/reports");
  return {
    success: true,
    message: existingReport
      ? "Weekly report updated for pastor review."
      : "Weekly report submitted for pastor review.",
  };
}

export async function submitReportingMemberRowAction(payload: unknown) {
  const parsed = reportingMemberRowSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, message: "Invalid member reporting payload." };
  }

  const resolvedContext = await resolveReportingWriteContext(parsed.data);
  if (!resolvedContext.success) {
    return resolvedContext;
  }

  const { churchId, userId, role, weekStartDate, weekEndDate, existingReport } = resolvedContext;
  const resolved = resolveMemberDraft(parsed.data.member);
  const validationError = validateMemberDraft(resolved, { allowPending: true });
  if (validationError) {
    return { success: false, message: validationError };
  }

  const reportId = await ensureDraftReport({
    churchId,
    userId,
    homecellId: parsed.data.homecellId,
    weekStartDate,
    weekEndDate,
    existingReport,
    totalMembers: parsed.data.totalMembers,
  });

  await db.$transaction([
    db.homecellReport.update({
      where: { id: reportId, churchId },
      data: {
        submittedById: userId,
        weekEndDate,
        totalMembers: parsed.data.totalMembers,
      },
    }),
    db.homecellReportItem.deleteMany({
      where: {
        churchId,
        reportId,
        memberId: resolved.member.memberId ?? null,
      },
    }),
    db.homecellReportItem.create({
      data: {
        church: { connect: { id: churchId } },
        report: { connect: { id: reportId } },
        ...(resolved.member.memberId ? { member: { connect: { id: resolved.member.memberId } } } : {}),
        memberName: resolved.member.memberName,
        present: resolved.present,
        churchPresent: resolved.churchPresent,
        churchAttendedLabels: resolved.churchAttendedLabels,
        ...withDefinedProperties({
          absenceReason: resolved.homecellAbsenceReason,
          absenceNote: resolved.homecellAbsenceNote,
          homecellPresent: resolved.homecellPresent,
          homecellAbsenceReason: resolved.homecellAbsenceReason,
          homecellAbsenceNote: resolved.homecellAbsenceNote,
          churchAbsenceReason: resolved.churchAbsenceReason,
          churchAbsenceNote: resolved.churchAbsenceNote,
          churchMorningPresent: resolved.churchMorningPresent,
          churchMorningAttendedLabel: resolved.churchMorningAttendedLabel,
          churchMorningAbsenceReason: resolved.churchMorningAbsenceReason,
          churchMorningAbsenceNote: resolved.churchMorningAbsenceNote,
          churchEveningPresent: resolved.churchEveningPresent,
          churchEveningAttendedLabel: resolved.churchEveningAttendedLabel,
          churchEveningAbsenceReason: resolved.churchEveningAbsenceReason,
          churchEveningAbsenceNote: resolved.churchEveningAbsenceNote,
        }),
      },
    }),
  ]);

  const [membersPresent, membersAbsent] = await Promise.all([
    db.homecellReportItem.count({
      where: {
        churchId,
        reportId,
        homecellPresent: true,
      },
    }),
    db.homecellReportItem.count({
      where: {
        churchId,
        reportId,
        homecellPresent: false,
      },
    }),
  ]);

  await db.homecellReport.update({
    where: { id: reportId, churchId },
    data: {
      totalMembers: parsed.data.totalMembers,
      membersPresent,
      membersAbsent,
    },
  });

  await logAudit({
    churchId,
    actorUserId: userId,
    actorRole: role,
    action: existingReport ? AuditAction.UPDATE : AuditAction.CREATE,
    entity: "HomecellReport",
    entityId: reportId,
    payload: { tab: "members", memberId: resolved.member.memberId ?? null },
  });

  revalidatePath("/dashboard/reporting");
  revalidatePath("/dashboard/homecells/reports");
  return { success: true, message: `${resolved.member.memberName} attendance saved.` };
}

export async function submitReportingVisitorsAction(payload: unknown) {
  const parsed = reportingVisitorsSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, message: "Invalid visitors reporting payload." };
  }

  const resolvedContext = await resolveReportingWriteContext(parsed.data);
  if (!resolvedContext.success) {
    return resolvedContext;
  }

  const { churchId, userId, role, weekStartDate, weekEndDate, existingReport } = resolvedContext;
  const visitorItems = normalizeVisitorsItems(parsed.data.items);
  const validationError = visitorItems
    .map((item) => validateVisitorDraft(item, { allowPending: false, label: "visitor" }))
    .find(Boolean);
  if (validationError) {
    return { success: false, message: validationError };
  }

  const visitorsPresentCount = visitorItems.filter((item) => item.homecellPresent || item.churchPresent).length;

  if (!existingReport) {
    const report = await db.homecellReport.create({
      data: {
        churchId,
        homecellId: parsed.data.homecellId,
        submittedById: userId,
        weekStartDate,
        weekEndDate,
        isLocked: false,
        totalMembers: 0,
        membersPresent: 0,
        membersAbsent: 0,
        visitors: visitorsPresentCount,
        firstTimeVisitors: 0,
        visitorItems,
        firstTimeVisitorItems: [],
        salvationItems: [],
      },
    });

    await logAudit({
      churchId,
      actorUserId: userId,
      actorRole: role,
      action: AuditAction.CREATE,
      entity: "HomecellReport",
      entityId: report.id,
      payload: { tab: "visitors" },
    });
  } else {
    await db.homecellReport.update({
      where: { id: existingReport.id, churchId },
      data: {
        submittedById: userId,
        weekEndDate,
        visitors: visitorsPresentCount,
        visitorItems,
      },
    });

    await logAudit({
      churchId,
      actorUserId: userId,
      actorRole: role,
      action: AuditAction.UPDATE,
      entity: "HomecellReport",
      entityId: existingReport.id,
      payload: { tab: "visitors" },
    });
  }

  revalidatePath("/dashboard/reporting");
  revalidatePath("/dashboard/homecells/reports");
  return {
    success: true,
    message: existingReport
      ? "Visitors report updated for pastor review."
      : "Visitors report submitted for pastor review.",
  };
}

export async function submitReportingFirstVisitorsAction(payload: unknown) {
  const parsed = reportingFirstVisitorsSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, message: "Invalid first-time visitors reporting payload." };
  }

  const resolvedContext = await resolveReportingWriteContext(parsed.data);
  if (!resolvedContext.success) {
    return resolvedContext;
  }

  const { churchId, userId, role, weekStartDate, weekEndDate, existingReport } = resolvedContext;
  const firstTimeVisitorItems = normalizeVisitorsItems(parsed.data.items);
  const validationError = firstTimeVisitorItems
    .map((item) => validateVisitorDraft(item, { allowPending: false, label: "first-time visitor" }))
    .find(Boolean);
  if (validationError) {
    return {
      success: false,
      message: validationError,
    };
  }

  const firstVisitorsPresentCount = firstTimeVisitorItems.filter(
    (item) => item.homecellPresent || item.churchPresent,
  ).length;

  if (!existingReport) {
    const report = await db.homecellReport.create({
      data: {
        churchId,
        homecellId: parsed.data.homecellId,
        submittedById: userId,
        weekStartDate,
        weekEndDate,
        isLocked: false,
        totalMembers: 0,
        membersPresent: 0,
        membersAbsent: 0,
        visitors: 0,
        firstTimeVisitors: firstVisitorsPresentCount,
        visitorItems: [],
        firstTimeVisitorItems,
        salvationItems: [],
      },
    });

    await logAudit({
      churchId,
      actorUserId: userId,
      actorRole: role,
      action: AuditAction.CREATE,
      entity: "HomecellReport",
      entityId: report.id,
      payload: { tab: "first-visitors" },
    });
  } else {
    await db.homecellReport.update({
      where: { id: existingReport.id, churchId },
      data: {
        submittedById: userId,
        weekEndDate,
        firstTimeVisitors: firstVisitorsPresentCount,
        firstTimeVisitorItems,
      },
    });

    await logAudit({
      churchId,
      actorUserId: userId,
      actorRole: role,
      action: AuditAction.UPDATE,
      entity: "HomecellReport",
      entityId: existingReport.id,
      payload: { tab: "first-visitors" },
    });
  }

  revalidatePath("/dashboard/reporting");
  revalidatePath("/dashboard/homecells/reports");
  return {
    success: true,
    message: existingReport
      ? "First-time visitors report updated for pastor review."
      : "First-time visitors report submitted for pastor review.",
  };
}

export async function submitReportingVisitorRowAction(payload: unknown) {
  const parsed = reportingVisitorRowSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, message: "Invalid visitor reporting payload." };
  }

  const resolvedContext = await resolveReportingWriteContext(parsed.data);
  if (!resolvedContext.success) {
    return resolvedContext;
  }

  const { churchId, userId, role, weekStartDate, weekEndDate, existingReport } = resolvedContext;
  const resolved = resolveVisitorDraft(parsed.data.item);
  const label = parsed.data.mode === "visitors" ? "visitor" : "first-time visitor";
  const validationError = validateVisitorDraft(resolved, { allowPending: true, label });
  if (validationError) {
    return { success: false, message: validationError };
  }

  const reportId = await ensureDraftReport({
    churchId,
    userId,
    homecellId: parsed.data.homecellId,
    weekStartDate,
    weekEndDate,
    existingReport,
  });

  const report = await db.homecellReport.findUnique({
    where: { id: reportId, churchId },
    select: {
      visitorItems: true,
      firstTimeVisitorItems: true,
    },
  });

  const currentItems = normalizeVisitorsItems(
    ((parsed.data.mode === "visitors" ? report?.visitorItems : report?.firstTimeVisitorItems) as ReportingVisitorsItem[] | null) ??
      [],
  );
  const nextItems = [
    ...currentItems.filter((item) => item.id !== resolved.id),
    resolved,
  ].sort((a, b) => a.name.localeCompare(b.name));

  const visitorsCount = parsed.data.mode === "visitors"
    ? nextItems.filter((item) => item.homecellPresent === true || item.churchPresent).length
    : (report?.visitorItems && Array.isArray(report.visitorItems)
        ? normalizeVisitorsItems(report.visitorItems as ReportingVisitorsItem[]).filter(
            (item) => item.homecellPresent === true || item.churchPresent,
          ).length
        : 0);
  const firstVisitorsCount = parsed.data.mode === "first-visitors"
    ? nextItems.filter((item) => item.homecellPresent === true || item.churchPresent).length
    : (report?.firstTimeVisitorItems && Array.isArray(report.firstTimeVisitorItems)
        ? normalizeVisitorsItems(report.firstTimeVisitorItems as ReportingVisitorsItem[]).filter(
            (item) => item.homecellPresent === true || item.churchPresent,
          ).length
        : 0);

  await db.homecellReport.update({
    where: { id: reportId, churchId },
    data: {
      submittedById: userId,
      weekEndDate,
      visitors: visitorsCount,
      firstTimeVisitors: firstVisitorsCount,
      ...(parsed.data.mode === "visitors"
        ? { visitorItems: nextItems }
        : { firstTimeVisitorItems: nextItems }),
    },
  });

  await logAudit({
    churchId,
    actorUserId: userId,
    actorRole: role,
    action: existingReport ? AuditAction.UPDATE : AuditAction.CREATE,
    entity: "HomecellReport",
    entityId: reportId,
    payload: { tab: parsed.data.mode, itemId: resolved.id },
  });

  revalidatePath("/dashboard/reporting");
  revalidatePath("/dashboard/homecells/reports");
  return { success: true, message: `${resolved.name} attendance saved.` };
}

export async function submitReportingSalvationsAction(payload: unknown) {
  const parsed = reportingSalvationsSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, message: "Invalid salvations reporting payload." };
  }

  const resolvedContext = await resolveReportingWriteContext(parsed.data);
  if (!resolvedContext.success) {
    return resolvedContext;
  }

  const { churchId, userId, role, weekStartDate, weekEndDate, existingReport } = resolvedContext;
  const salvationItems = normalizeSalvationItems(parsed.data.items);
  const eligibilitySet = await getSalvationEligibilitySet({
    churchId,
    homecellId: parsed.data.homecellId,
    weekStartDate,
  });

  const ineligibleSelection = salvationItems.find((item) => {
    const eligibility = eligibilitySet.get(salvationEligibilityKey(item.source, item.id));
    return !eligibility?.eligible;
  });
  if (ineligibleSelection) {
    return {
      success: false,
      message: `${ineligibleSelection.name} can only be marked in salvations after being present at homecell or church.`,
    };
  }

  if (!existingReport) {
    const report = await db.homecellReport.create({
      data: {
        churchId,
        homecellId: parsed.data.homecellId,
        submittedById: userId,
        weekStartDate,
        weekEndDate,
        isLocked: false,
        totalMembers: 0,
        membersPresent: 0,
        membersAbsent: 0,
        visitors: 0,
        firstTimeVisitors: 0,
        visitorItems: [],
        firstTimeVisitorItems: [],
        salvationItems,
      },
    });

    await logAudit({
      churchId,
      actorUserId: userId,
      actorRole: role,
      action: AuditAction.CREATE,
      entity: "HomecellReport",
      entityId: report.id,
      payload: { tab: "salvations" },
    });
  } else {
    await db.homecellReport.update({
      where: { id: existingReport.id, churchId },
      data: {
        submittedById: userId,
        weekEndDate,
        salvationItems,
      },
    });

    await logAudit({
      churchId,
      actorUserId: userId,
      actorRole: role,
      action: AuditAction.UPDATE,
      entity: "HomecellReport",
      entityId: existingReport.id,
      payload: { tab: "salvations" },
    });
  }

  revalidatePath("/dashboard/reporting");
  revalidatePath("/dashboard/homecells/reports");
  return { success: true, message: existingReport ? "Salvations report updated." : "Salvations report submitted." };
}
