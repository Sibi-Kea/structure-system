"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  submitReportingMemberRowAction,
  submitReportingMembersAction,
} from "@/app/dashboard/reporting/actions";
import { QuickAddMemberRequestPanel } from "@/components/reporting/quick-add-member-request-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type MemberItem = {
  id: string;
  name: string;
};

type ExistingMemberItem = {
  memberId: string | null;
  memberName: string;
  present?: boolean;
  absenceReason?: string | null;
  absenceNote?: string | null;
  homecellPresent?: boolean | null;
  homecellAbsenceReason?: string | null;
  homecellAbsenceNote?: string | null;
  churchPresent?: boolean;
  churchAttendedLabels?: string[];
  churchAbsenceReason?: string | null;
  churchAbsenceNote?: string | null;
  churchMorningPresent?: boolean | null;
  churchMorningAttendedLabel?: string | null;
  churchMorningAbsenceReason?: string | null;
  churchMorningAbsenceNote?: string | null;
  churchEveningPresent?: boolean | null;
  churchEveningAttendedLabel?: string | null;
  churchEveningAbsenceReason?: string | null;
  churchEveningAbsenceNote?: string | null;
};

type PendingMemberRequestItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  createdAtLabel: string;
};

type HomecellMembersReportFormProps = {
  homecellId: string;
  homecellName: string;
  weekStartDate: string;
  weekEndDate: string;
  totalMembers: number;
  members: MemberItem[];
  existingItems: ExistingMemberItem[];
  pendingMemberRequests: PendingMemberRequestItem[];
  serviceLabels: string[];
  serviceGroups?: {
    morning: string[];
    evening: string[];
    online: string[];
  };
  canSubmit: boolean;
  isLocked: boolean;
};

type MemberState = {
  memberId: string;
  memberName: string;
  homecellPresent: boolean | null;
  homecellAbsenceReason: string;
  homecellAbsenceNote: string;
  churchMorningPresent: boolean | null;
  churchMorningAttendedLabels: string[];
  churchMorningAbsenceReason: string;
  churchMorningAbsenceNote: string;
  churchEveningPresent: boolean | null;
  churchEveningAttendedLabel: string;
  churchEveningAbsenceReason: string;
  churchEveningAbsenceNote: string;
};

type MemberEditorTarget = "homecell" | "churchAttendance";

type MemberEditorState = {
  rowIndex: number;
  target: MemberEditorTarget;
  draft: MemberState;
};

type SessionOptions = {
  morning: string[];
  evening: string[];
};

function normalizeLabel(value: string) {
  return value.trim();
}

function uniqueLabels(labels: string[]) {
  return Array.from(new Set(labels.map(normalizeLabel).filter((label) => label.length > 0)));
}

function resolveSessionOptions(
  serviceLabels: string[],
  serviceGroups?: { morning: string[]; evening: string[]; online: string[] },
): SessionOptions {
  if (serviceGroups) {
    const morning = uniqueLabels([...serviceGroups.morning, ...serviceGroups.online]);
    const evening = uniqueLabels([...serviceGroups.evening, ...serviceGroups.online]);
    if (morning.length > 0 || evening.length > 0) {
      const fallback = uniqueLabels(serviceLabels);
      return {
        morning: morning.length > 0 ? morning : fallback,
        evening: evening.length > 0 ? evening : fallback,
      };
    }
  }

  const normalized = uniqueLabels(serviceLabels);
  const online = normalized.filter((label) => label.toLowerCase().includes("online"));
  const morning = uniqueLabels([...normalized.filter((label) => /\b(am|morning)\b/i.test(label)), ...online]);
  const evening = uniqueLabels([...normalized.filter((label) => /\b(pm|evening)\b/i.test(label)), ...online]);

  return {
    morning: morning.length > 0 ? morning : normalized,
    evening: evening.length > 0 ? evening : normalized,
  };
}

function initialStateFromInput(
  members: MemberItem[],
  existingItems: ExistingMemberItem[],
  sessionOptions: SessionOptions,
): MemberState[] {
  const existingById = new Map(
    existingItems
      .filter((item) => item.memberId)
      .map((item) => {
        const legacyLabels = uniqueLabels(item.churchAttendedLabels ?? []);
        const explicitMorning = item.churchMorningAttendedLabel ? normalizeLabel(item.churchMorningAttendedLabel) : "";
        const explicitEvening = item.churchEveningAttendedLabel ? normalizeLabel(item.churchEveningAttendedLabel) : "";
        const legacyMorningLabels = legacyLabels.filter((label) => sessionOptions.morning.includes(label));
        const churchMorningAttendedLabels = uniqueLabels([
          explicitMorning,
          ...(legacyMorningLabels.length > 0 ? legacyMorningLabels : legacyLabels[0] ? [legacyLabels[0]] : []),
        ]);
        const legacyEvening =
          legacyLabels.find(
            (label) => sessionOptions.evening.includes(label) && !churchMorningAttendedLabels.includes(label),
          ) ??
          legacyLabels[1] ??
          "";
        const churchEveningAttendedLabel = explicitEvening || legacyEvening;
        const legacyChurchPresent = item.churchPresent;

        const churchMorningPresent =
          typeof item.churchMorningPresent === "boolean"
            ? item.churchMorningPresent
            : item.churchMorningPresent === null
              ? null
            : typeof legacyChurchPresent === "boolean"
              ? legacyChurchPresent
              : null;

        const churchEveningPresent =
          typeof item.churchEveningPresent === "boolean"
            ? item.churchEveningPresent
            : item.churchEveningPresent === null
              ? null
            : typeof legacyChurchPresent === "boolean"
              ? legacyChurchPresent
              : null;

        return [
          item.memberId as string,
          {
            homecellPresent:
              typeof item.homecellPresent === "boolean"
                ? item.homecellPresent
                : item.homecellPresent === null
                  ? null
                  : null,
            homecellAbsenceReason: item.homecellAbsenceReason ?? item.absenceReason ?? "",
            homecellAbsenceNote: item.homecellAbsenceNote ?? item.absenceNote ?? "",
            churchMorningPresent,
            churchMorningAttendedLabels: churchMorningPresent === true ? churchMorningAttendedLabels : [],
            churchMorningAbsenceReason:
              item.churchMorningAbsenceReason ?? (churchMorningPresent === false ? item.churchAbsenceReason ?? "" : ""),
            churchMorningAbsenceNote:
              item.churchMorningAbsenceNote ?? (churchMorningPresent === false ? item.churchAbsenceNote ?? "" : ""),
            churchEveningPresent,
            churchEveningAttendedLabel: churchEveningPresent === true ? churchEveningAttendedLabel : "",
            churchEveningAbsenceReason:
              item.churchEveningAbsenceReason ?? (churchEveningPresent === false ? item.churchAbsenceReason ?? "" : ""),
            churchEveningAbsenceNote:
              item.churchEveningAbsenceNote ?? (churchEveningPresent === false ? item.churchAbsenceNote ?? "" : ""),
          },
        ];
      }),
  );

  return members.map((member) => {
    const existing = existingById.get(member.id);
    return {
      memberId: member.id,
      memberName: member.name,
      homecellPresent: existing?.homecellPresent ?? null,
      homecellAbsenceReason: existing?.homecellAbsenceReason ?? "",
      homecellAbsenceNote: existing?.homecellAbsenceNote ?? "",
      churchMorningPresent: existing?.churchMorningPresent ?? null,
      churchMorningAttendedLabels: existing?.churchMorningAttendedLabels ?? [],
      churchMorningAbsenceReason: existing?.churchMorningAbsenceReason ?? "",
      churchMorningAbsenceNote: existing?.churchMorningAbsenceNote ?? "",
      churchEveningPresent: existing?.churchEveningPresent ?? null,
      churchEveningAttendedLabel: existing?.churchEveningAttendedLabel ?? "",
      churchEveningAbsenceReason: existing?.churchEveningAbsenceReason ?? "",
      churchEveningAbsenceNote: existing?.churchEveningAbsenceNote ?? "",
    };
  });
}

function isHomecellSelectionComplete(row: MemberState) {
  if (row.homecellPresent === true) return true;
  if (row.homecellPresent === false) return row.homecellAbsenceReason.trim().length > 0;
  return false;
}

function isChurchMorningSessionComplete(row: MemberState) {
  return row.churchMorningPresent === true
    ? row.churchMorningAttendedLabels.length > 0
    : row.churchMorningPresent === false
      ? row.churchMorningAbsenceReason.trim().length > 0
      : false;
}

function isChurchEveningSessionComplete(row: MemberState) {
  return row.churchEveningPresent === true
    ? row.churchEveningAttendedLabel.trim().length > 0
    : row.churchEveningPresent === false
      ? row.churchEveningAbsenceReason.trim().length > 0
      : false;
}

function isChurchSelectionComplete(row: MemberState) {
  return isChurchMorningSessionComplete(row) && isChurchEveningSessionComplete(row);
}

function memberRowFingerprint(row: MemberState) {
  return JSON.stringify({
    memberId: row.memberId,
    homecellPresent: row.homecellPresent,
    homecellAbsenceReason: row.homecellAbsenceReason,
    homecellAbsenceNote: row.homecellAbsenceNote,
    churchMorningPresent: row.churchMorningPresent,
    churchMorningAttendedLabels: row.churchMorningAttendedLabels,
    churchMorningAbsenceReason: row.churchMorningAbsenceReason,
    churchMorningAbsenceNote: row.churchMorningAbsenceNote,
    churchEveningPresent: row.churchEveningPresent,
    churchEveningAttendedLabel: row.churchEveningAttendedLabel,
    churchEveningAbsenceReason: row.churchEveningAbsenceReason,
    churchEveningAbsenceNote: row.churchEveningAbsenceNote,
  });
}

function isChurchMorningDraftValid(row: MemberState) {
  if (row.churchMorningPresent === null) return true;
  return isChurchMorningSessionComplete(row);
}

function isChurchEveningDraftValid(row: MemberState) {
  if (row.churchEveningPresent === null) return true;
  return isChurchEveningSessionComplete(row);
}

function hasAnyChurchDraftSection(row: MemberState) {
  return row.churchMorningPresent !== null || row.churchEveningPresent !== null;
}

function homecellStatusLabel(row: MemberState) {
  if (row.homecellPresent === true) return "P";
  if (row.homecellPresent === false) return "A";
  return "-";
}

type ChurchStatusTone = "pending" | "absent" | "present";

function getChurchStatus(row: MemberState): { label: string; tone: ChurchStatusTone } {
  if (row.churchMorningPresent === false && row.churchEveningPresent === false) {
    return { label: "A", tone: "absent" };
  }

  if (row.churchMorningPresent === true || row.churchEveningPresent === true) {
    return { label: "P", tone: "present" };
  }

  return { label: "-", tone: "pending" };
}

export function HomecellMembersReportForm({
  homecellId,
  homecellName,
  weekStartDate,
  weekEndDate,
  totalMembers,
  members,
  existingItems,
  pendingMemberRequests,
  serviceLabels,
  serviceGroups,
  canSubmit,
  isLocked,
}: HomecellMembersReportFormProps) {
  const [isSavingRow, startSaveRowTransition] = useTransition();
  const [isSubmittingReport, startSubmitReportTransition] = useTransition();
  const sessionOptions = useMemo(
    () => resolveSessionOptions(serviceLabels, serviceGroups),
    [serviceGroups, serviceLabels],
  );
  const combinedServiceLabels = useMemo(
    () => uniqueLabels([...serviceLabels, ...sessionOptions.morning, ...sessionOptions.evening]),
    [serviceLabels, sessionOptions.evening, sessionOptions.morning],
  );
  const initialRows = useMemo(
    () => initialStateFromInput(members, existingItems, sessionOptions),
    [existingItems, members, sessionOptions],
  );
  const [rows, setRows] = useState(initialRows);
  const [rowEditor, setRowEditor] = useState<MemberEditorState | null>(null);

  useEffect(() => {
    if (!rowEditor) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [rowEditor]);

  const canEdit = canSubmit && !isLocked;
  const isBusy = isSavingRow || isSubmittingReport;
  const homecellPresentCount = rows.filter((row) => row.homecellPresent === true).length;
  const homecellAbsentCount = rows.filter((row) => row.homecellPresent === false).length;
  const homecellNotSetCount = rows.filter((row) => row.homecellPresent === null).length;
  const churchConfiguredCount = rows.filter((row) => isChurchSelectionComplete(row)).length;

  const openRowEditor = (rowIndex: number, target: MemberEditorTarget) => {
    const row = rows[rowIndex];
    if (!row) return;
    setRowEditor({ rowIndex, target, draft: { ...row } });
  };

  const closeRowEditor = () => setRowEditor(null);

  const updateEditorDraft = (updater: (current: MemberState) => MemberState) => {
    setRowEditor((current) => {
      if (!current) return current;
      return { ...current, draft: updater(current.draft) };
    });
  };

  const currentEditorRow = rowEditor ? rows[rowEditor.rowIndex] : null;
  const isRowEditorDirty =
    rowEditor && currentEditorRow
      ? memberRowFingerprint(currentEditorRow) !== memberRowFingerprint(rowEditor.draft)
      : false;

  const saveRowEditor = () => {
    if (!rowEditor) return;
    if (!isRowEditorDirty) {
      closeRowEditor();
      return;
    }

    const nextRow = rowEditor.draft;
    startSaveRowTransition(async () => {
      const result = await submitReportingMemberRowAction({
        homecellId,
        weekStartDate,
        weekEndDate,
        totalMembers,
        member: toMemberPayload(nextRow),
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      setRows((current) =>
        current.map((row) => (row.memberId === nextRow.memberId ? nextRow : row)),
      );
      closeRowEditor();
      toast.success(result.message);
    });
  };

  const canSaveRowEditor = rowEditor
    ? rowEditor.target === "homecell"
      ? isHomecellSelectionComplete(rowEditor.draft)
      : hasAnyChurchDraftSection(rowEditor.draft) &&
        isChurchMorningDraftValid(rowEditor.draft) &&
        isChurchEveningDraftValid(rowEditor.draft)
    : false;

  const toMemberPayload = (row: MemberState) => {
    const churchAttendedLabels = uniqueLabels([
      ...(row.churchMorningPresent === true ? row.churchMorningAttendedLabels : []),
      row.churchEveningPresent === true ? row.churchEveningAttendedLabel : "",
    ]);
    const churchPresent = churchAttendedLabels.length > 0;

    return {
      memberId: row.memberId,
      memberName: row.memberName,
      absenceReason: row.homecellAbsenceReason,
      absenceNote: row.homecellAbsenceNote,
      homecellPresent: row.homecellPresent,
      homecellAbsenceReason: row.homecellAbsenceReason,
      homecellAbsenceNote: row.homecellAbsenceNote,
      churchPresent,
      churchAttendedLabels,
      churchAbsenceReason: churchPresent ? "" : row.churchMorningAbsenceReason || row.churchEveningAbsenceReason,
      churchAbsenceNote: churchPresent ? "" : row.churchMorningAbsenceNote || row.churchEveningAbsenceNote,
      churchMorningPresent: row.churchMorningPresent,
      churchMorningAttendedLabels: row.churchMorningAttendedLabels,
      churchMorningAttendedLabel: row.churchMorningAttendedLabels[0] ?? "",
      churchMorningAbsenceReason: row.churchMorningAbsenceReason,
      churchMorningAbsenceNote: row.churchMorningAbsenceNote,
      churchEveningPresent: row.churchEveningPresent,
      churchEveningAttendedLabel: row.churchEveningAttendedLabel,
      churchEveningAbsenceReason: row.churchEveningAbsenceReason,
      churchEveningAbsenceNote: row.churchEveningAbsenceNote,
    };
  };

  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canEdit) return;

          if (rows.some((row) => row.homecellPresent === null)) {
            toast.error("Select Home Cell P or A for each member.");
            return;
          }
          if (rows.some((row) => row.homecellPresent === false && !row.homecellAbsenceReason.trim())) {
            toast.error("Each Home Cell absence needs a reason.");
            return;
          }
          if (rows.some((row) => row.churchMorningPresent === null)) {
            toast.error("Submit morning church attendance for each member.");
            return;
          }
          if (rows.some((row) => row.churchEveningPresent === null)) {
            toast.error("Submit evening church attendance for each member.");
            return;
          }
          if (rows.some((row) => row.churchMorningPresent === false && !row.churchMorningAbsenceReason.trim())) {
            toast.error("Each morning church absence needs a reason.");
            return;
          }
          if (rows.some((row) => row.churchEveningPresent === false && !row.churchEveningAbsenceReason.trim())) {
            toast.error("Each evening church absence needs a reason.");
            return;
          }
          if (rows.some((row) => row.churchMorningPresent === true && row.churchMorningAttendedLabels.length === 0)) {
            toast.error("Select at least one morning church attendance option for each member.");
            return;
          }
          if (rows.some((row) => row.churchEveningPresent === true && !row.churchEveningAttendedLabel)) {
            toast.error("Select an evening church attendance option for each member.");
            return;
          }

          startSubmitReportTransition(async () => {
            const result = await submitReportingMembersAction({
              homecellId,
              weekStartDate,
              weekEndDate,
              members: rows.map(toMemberPayload),
            });
            if (!result.success) {
              toast.error(result.message);
              return;
            }
            toast.success(result.message);
          });
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base font-semibold text-slate-900">Members</p>
          <div className="text-sm text-slate-600">
            HC: <span className="font-medium text-emerald-700">{homecellPresentCount}</span> P /{" "}
            <span className="font-medium text-red-700">{homecellAbsentCount}</span> A /{" "}
            <span className="font-medium text-amber-700">{homecellNotSetCount}</span> pending
            {" | "}
            CA: <span className="font-medium text-emerald-700">{churchConfiguredCount}</span> set /{" "}
            <span className="font-medium text-slate-700">{rows.length - churchConfiguredCount}</span> pending
          </div>
        </div>

        <div className="space-y-3">
        {rows.map((row, index) => {
          const churchStatus = getChurchStatus(row);

          return (
            <div key={row.memberId} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {index + 1}. {row.memberName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    HC <span className="font-semibold text-slate-700">{homecellStatusLabel(row)}</span>
                    {" | "}
                    CA <span className="font-semibold text-slate-700">{churchStatus.label}</span>
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={!canEdit || isBusy}
                    onClick={() => openRowEditor(index, "homecell")}
                    className={cn(
                      "flex h-12 w-12 flex-col items-center justify-center rounded-xl border text-[10px] font-semibold uppercase tracking-wide transition",
                      row.homecellPresent === true
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : row.homecellPresent === false
                          ? "border-red-500 bg-red-50 text-red-700"
                          : "border-slate-300 bg-white text-slate-700",
                    )}
                  >
                    <span>HC</span>
                    <span className="text-xs">{homecellStatusLabel(row)}</span>
                  </button>

                  <button
                    type="button"
                    disabled={!canEdit || isBusy}
                    onClick={() => openRowEditor(index, "churchAttendance")}
                    className={cn(
                      "flex h-12 min-w-12 flex-col items-center justify-center rounded-xl border px-2 text-[10px] font-semibold uppercase tracking-wide transition",
                      churchStatus.tone === "present"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : churchStatus.tone === "absent"
                          ? "border-red-500 bg-red-50 text-red-700"
                          : "border-slate-300 bg-white text-slate-700",
                    )}
                  >
                    <span>CA</span>
                    <span className="text-[10px]">{churchStatus.label}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}

          {rows.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
              No active members in this homecell yet.
            </p>
          ) : null}
        </div>

        <QuickAddMemberRequestPanel
          homecellId={homecellId}
          homecellName={homecellName}
          canCreate={canSubmit}
          pendingRequests={pendingMemberRequests}
        />

        {isLocked ? <p className="text-sm text-amber-700">This weekly report is locked and cannot be edited.</p> : null}
        {!canSubmit ? <p className="text-sm text-slate-500">You have view-only access for member reporting.</p> : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="submit" disabled={!canEdit || isBusy || rows.length === 0}>
            {isSubmittingReport ? "Submitting..." : "Submit for Pastor"}
          </Button>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Exit
          </Link>
        </div>
      </form>

      {rowEditor && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/35 p-4">
            <button type="button" className="absolute inset-0" aria-label="Close row editor" onClick={closeRowEditor} />
            <div className="relative z-[10000] w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h4 className="text-base font-semibold text-slate-900">
              {rowEditor.target === "homecell" ? "Home Cell" : "Church Attendance"}
            </h4>
            <p className="mt-1 text-sm text-slate-600">{rowEditor.draft.memberName}</p>

            {rowEditor.target === "homecell" ? (
              <div className={cn("mt-4 space-y-4", isBusy && "pointer-events-none opacity-70")}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateEditorDraft((item) => ({
                        ...item,
                        homecellPresent: true,
                        homecellAbsenceReason: "",
                        homecellAbsenceNote: "",
                      }))
                    }
                    className={cn(
                      "inline-flex h-12 min-w-16 items-center justify-center rounded-xl border px-4 text-sm font-semibold",
                      rowEditor.draft.homecellPresent === true
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-300 text-slate-700",
                    )}
                  >
                    P
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateEditorDraft((item) => ({
                        ...item,
                        homecellPresent: false,
                      }))
                    }
                    className={cn(
                      "inline-flex h-12 min-w-16 items-center justify-center rounded-xl border px-4 text-sm font-semibold",
                      rowEditor.draft.homecellPresent === false
                        ? "border-red-500 bg-red-50 text-red-700"
                        : "border-slate-300 text-slate-700",
                    )}
                  >
                    A
                  </button>
                </div>

                {rowEditor.draft.homecellPresent === false ? (
                  <div className="space-y-2">
                    <Select
                      value={rowEditor.draft.homecellAbsenceReason}
                      onChange={(event) =>
                        updateEditorDraft((item) => ({
                          ...item,
                          homecellAbsenceReason: event.target.value,
                        }))
                      }
                    >
                      <option value="">Reason required</option>
                      <option value="Travel">Travel</option>
                      <option value="Sick">Sick</option>
                      <option value="Work">Work</option>
                      <option value="Family">Family</option>
                      <option value="Other">Other</option>
                    </Select>
                    <Input
                      value={rowEditor.draft.homecellAbsenceNote}
                      onChange={(event) =>
                        updateEditorDraft((item) => ({
                          ...item,
                          homecellAbsenceNote: event.target.value,
                        }))
                      }
                      placeholder="Note"
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={cn("mt-4 space-y-4", isBusy && "pointer-events-none opacity-70")}>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Services</p>
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {combinedServiceLabels.map((label) => (
                        <button
                          key={`service-${label}`}
                          type="button"
                          onClick={() =>
                            updateEditorDraft((item) => {
                              const isMorningLabel = sessionOptions.morning.includes(label);
                              const isEveningLabel = sessionOptions.evening.includes(label);
                              const next = { ...item };

                              if (isMorningLabel) {
                                const nextLabels = item.churchMorningAttendedLabels.includes(label)
                                  ? item.churchMorningAttendedLabels.filter((value) => value !== label)
                                  : [...item.churchMorningAttendedLabels, label];
                                const uniqueMorningLabels = uniqueLabels(nextLabels);
                                next.churchMorningPresent = uniqueMorningLabels.length > 0 ? true : null;
                                next.churchMorningAttendedLabels = uniqueMorningLabels;
                                next.churchMorningAbsenceReason = "";
                                next.churchMorningAbsenceNote = "";
                              }

                              if (isEveningLabel) {
                                const isSameEveningSelection =
                                  item.churchEveningPresent === true && item.churchEveningAttendedLabel === label;
                                next.churchEveningPresent = isSameEveningSelection ? null : true;
                                next.churchEveningAttendedLabel = isSameEveningSelection ? "" : label;
                                next.churchEveningAbsenceReason = "";
                                next.churchEveningAbsenceNote = "";
                              }

                              // Service selection exits absent mode so rows cannot be absent + present together.
                              if (next.churchMorningPresent === true || next.churchEveningPresent === true) {
                                if (next.churchMorningPresent === false) {
                                  next.churchMorningPresent = null;
                                }
                                if (next.churchEveningPresent === false) {
                                  next.churchEveningPresent = null;
                                }
                              }

                              return next;
                            })
                          }
                          className={cn(
                            "inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium",
                            (rowEditor.draft.churchMorningPresent === true &&
                              rowEditor.draft.churchMorningAttendedLabels.includes(label)) ||
                              (rowEditor.draft.churchEveningPresent === true &&
                                rowEditor.draft.churchEveningAttendedLabel === label)
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-slate-300 text-slate-700",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Absent</p>
                  <div className="mt-3 space-y-2">
                    <div className="flex">
                      <button
                        type="button"
                        onClick={() =>
                          updateEditorDraft((item) => ({
                            ...item,
                            churchMorningPresent: false,
                            churchMorningAttendedLabels: [],
                            churchEveningPresent: false,
                            churchEveningAttendedLabel: "",
                          }))
                        }
                        className={cn(
                          "inline-flex min-h-10 w-full items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold",
                          rowEditor.draft.churchMorningPresent === false &&
                            rowEditor.draft.churchEveningPresent === false
                            ? "border-red-500 bg-red-50 text-red-700"
                            : "border-slate-300 text-slate-700",
                        )}
                        aria-pressed={
                          rowEditor.draft.churchMorningPresent === false &&
                          rowEditor.draft.churchEveningPresent === false
                        }
                      >
                        ABSENT
                      </button>
                    </div>

                    {rowEditor.draft.churchMorningPresent === false &&
                    rowEditor.draft.churchEveningPresent === false ? (
                      <>
                        <p className="text-xs text-slate-500">Add a reason and note for absent sessions.</p>
                        <Select
                          value={
                            rowEditor.draft.churchMorningPresent === false
                              ? rowEditor.draft.churchMorningAbsenceReason
                              : rowEditor.draft.churchEveningAbsenceReason
                          }
                          onChange={(event) =>
                            updateEditorDraft((item) => {
                              const nextReason = event.target.value;
                              return {
                                ...item,
                                churchMorningAbsenceReason:
                                  item.churchMorningPresent === false ? nextReason : item.churchMorningAbsenceReason,
                                churchEveningAbsenceReason:
                                  item.churchEveningPresent === false ? nextReason : item.churchEveningAbsenceReason,
                              };
                            })
                          }
                        >
                          <option value="">Reason required</option>
                          <option value="Travel">Travel</option>
                          <option value="Sick">Sick</option>
                          <option value="Work">Work</option>
                          <option value="Family">Family</option>
                          <option value="Other">Other</option>
                        </Select>
                        <Input
                          value={
                            rowEditor.draft.churchMorningPresent === false
                              ? rowEditor.draft.churchMorningAbsenceNote
                              : rowEditor.draft.churchEveningAbsenceNote
                          }
                          onChange={(event) =>
                            updateEditorDraft((item) => {
                              const nextNote = event.target.value;
                              return {
                                ...item,
                                churchMorningAbsenceNote:
                                  item.churchMorningPresent === false ? nextNote : item.churchMorningAbsenceNote,
                                churchEveningAbsenceNote:
                                  item.churchEveningPresent === false ? nextNote : item.churchEveningAbsenceNote,
                              };
                            })
                          }
                          placeholder="Absence note"
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeRowEditor} disabled={isBusy}>
                Cancel
              </Button>
              <Button type="button" onClick={saveRowEditor} disabled={!canSaveRowEditor || isBusy}>
                {isSavingRow ? "Saving..." : "Save"}
              </Button>
            </div>
            </div>
          </div>
          ,
          document.body,
        )
        : null}
    </>
  );
}
