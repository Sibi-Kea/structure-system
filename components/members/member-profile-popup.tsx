"use client";

import Link from "next/link";
import { Eye, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

type ProfilePopupVariant = "link" | "button" | "icon";

type MemberProfilePopupProps = {
  memberId: string;
  memberName?: string;
  label?: string;
  variant?: ProfilePopupVariant;
};

type MemberDetails = {
  id: string;
  firstName: string;
  lastName: string;
  viewMode: "FULL" | "LIMITED";
  membershipStatus: "ACTIVE" | "INACTIVE" | "VISITOR";
  gender: string;
  dateJoined: string;
  dateOfBirth?: string | null;
  phone: string | null;
  email: string | null;
  address?: string | null;
  maritalStatus?: string | null;
  occupation?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  homecell: { name: string } | null;
  department: { name: string } | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function statusClasses(status: MemberDetails["membershipStatus"]) {
  if (status === "ACTIVE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "INACTIVE") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function MemberProfilePopup({
  memberId,
  memberName,
  label = "Open profile",
  variant = "link",
}: MemberProfilePopupProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [member, setMember] = useState<MemberDetails | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !loading) return;

    const controller = new AbortController();

    fetch(`/api/members/${memberId}`, {
      method: "GET",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? "Failed to load member profile.");
        }
        return (await response.json()) as MemberDetails;
      })
      .then((data) => setMember(data))
      .catch((fetchError: Error) => {
        if (fetchError.name === "AbortError") return;
        setError(fetchError.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [loading, memberId, open]);

  function openProfile() {
    setMember(null);
    setError(null);
    setLoading(true);
    setOpen(true);
  }
  const portalRoot = typeof window === "undefined" ? null : document.body;

  return (
    <>
      {variant === "button" ? (
        <Button type="button" variant="outline" className="h-10 px-4" onClick={openProfile}>
          {label}
        </Button>
      ) : variant === "icon" ? (
        <button
          type="button"
          onClick={openProfile}
          aria-label={label}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
        >
          <Eye className="h-4 w-4" />
        </button>
      ) : (
        <button type="button" onClick={openProfile} className="text-sm font-medium text-sky-700 hover:underline">
          {label}
        </button>
      )}

      {open && portalRoot
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/35 p-4">
              <button
                type="button"
                aria-label="Close profile popup"
                className="absolute inset-0"
                onClick={() => setOpen(false)}
              />
              <div className="relative z-[10000] w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{memberName ?? "Member profile"}</h3>
                    <p className="mt-1 text-sm text-slate-600">Profile details</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
                    aria-label="Close profile popup"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="max-h-[80vh] overflow-y-auto p-5">
                  {loading ? (
                    <p className="text-sm text-slate-600">Loading member profile...</p>
                  ) : error ? (
                    <p className="text-sm text-red-600">{error}</p>
                  ) : member ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold text-slate-900">
                          {member.firstName} {member.lastName}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses(member.membershipStatus)}`}
                        >
                          {member.membershipStatus}
                        </span>
                      </div>

                      <div className="grid gap-3 text-sm md:grid-cols-2">
                        <p>
                          <span className="font-medium text-slate-900">Phone:</span> {member.phone ?? "-"}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Email:</span> {member.email ?? "-"}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Gender:</span> {member.gender}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Date joined:</span> {formatDate(member.dateJoined)}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Homecell:</span> {member.homecell?.name ?? "-"}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Department:</span> {member.department?.name ?? "-"}
                        </p>
                        {member.viewMode === "FULL" ? (
                          <>
                            <p>
                              <span className="font-medium text-slate-900">Date of birth:</span> {formatDate(member.dateOfBirth)}
                            </p>
                            <p>
                              <span className="font-medium text-slate-900">Marital status:</span> {member.maritalStatus ?? "-"}
                            </p>
                            <p>
                              <span className="font-medium text-slate-900">Occupation:</span> {member.occupation ?? "-"}
                            </p>
                            <p>
                              <span className="font-medium text-slate-900">Emergency contact:</span>{" "}
                              {member.emergencyContactName ?? "-"}
                            </p>
                            <p>
                              <span className="font-medium text-slate-900">Emergency phone:</span>{" "}
                              {member.emergencyContactPhone ?? "-"}
                            </p>
                            <p className="md:col-span-2">
                              <span className="font-medium text-slate-900">Address:</span> {member.address ?? "-"}
                            </p>
                          </>
                        ) : (
                          <p className="md:col-span-2 text-xs text-slate-500">
                            Limited member view for leadership role.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">No member data found.</p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                  <Link href={`/dashboard/members/${memberId}`}>
                    <Button type="button">Full profile</Button>
                  </Link>
                </div>
              </div>
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}
