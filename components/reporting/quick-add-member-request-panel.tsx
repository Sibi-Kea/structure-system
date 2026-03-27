"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { createPendingMemberRequestAction } from "@/app/dashboard/members/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type PendingMemberRequestItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  createdAtLabel: string;
};

type QuickAddMemberRequestPanelProps = {
  homecellId: string;
  homecellName: string;
  canCreate: boolean;
  pendingRequests: PendingMemberRequestItem[];
};

const initialFormState = {
  firstName: "",
  lastName: "",
  gender: "MALE",
  phone: "",
  email: "",
  dateJoined: new Date().toISOString().slice(0, 10),
};

export function QuickAddMemberRequestPanel({
  homecellId,
  homecellName,
  canCreate,
  pendingRequests,
}: QuickAddMemberRequestPanelProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [formState, setFormState] = useState(initialFormState);
  const [requests, setRequests] = useState(pendingRequests);

  useEffect(() => {
    setRequests(pendingRequests);
  }, [pendingRequests]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function resetForm() {
    setFormState(initialFormState);
  }

  function closeModal() {
    if (isPending) return;
    setOpen(false);
    resetForm();
  }

  function submitRequest() {
    startTransition(async () => {
      const result = await createPendingMemberRequestAction({
        homecellId,
        firstName: formState.firstName,
        lastName: formState.lastName,
        gender: formState.gender,
        phone: formState.phone,
        email: formState.email,
        dateJoined: formState.dateJoined,
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      setRequests((current) => [
        {
          id: result.requestId ?? crypto.randomUUID(),
          name: `${formState.firstName} ${formState.lastName}`.trim(),
          phone: formState.phone.trim() || null,
          email: formState.email.trim() || null,
          createdAtLabel: "Just now",
        },
        ...current,
      ]);
      setOpen(false);
      resetForm();
    });
  }
  const portalRoot = typeof window === "undefined" ? null : document.body;

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">Quick Add Member</p>
            <p className="text-sm text-slate-600">
              Add a member request for <span className="font-medium text-slate-900">{homecellName}</span>. Pastor must
              approve it before it appears in the members table.
            </p>
          </div>
          <Button type="button" onClick={() => setOpen(true)} disabled={!canCreate || isPending}>
            <Plus className="mr-2 h-4 w-4" />
            Add Member
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending Pastor Approval</p>
          {requests.length > 0 ? (
            <div className="space-y-2">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{request.name}</p>
                    <p className="text-xs text-slate-500">
                      {[request.phone, request.email].filter(Boolean).join(" | ") || "No contact captured"}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                    {request.createdAtLabel}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No pending member requests for this homecell.</p>
          )}
        </div>
      </div>

      {open && portalRoot
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/35 p-4">
              <button type="button" className="absolute inset-0" aria-label="Close quick add member form" onClick={closeModal} />
              <div className="relative z-[10000] w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900">Quick Add Member</h4>
                    <p className="mt-1 text-sm text-slate-600">
                      This creates a pending request for <span className="font-medium text-slate-900">{homecellName}</span>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isPending}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
                    aria-label="Close quick add member form"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div
                  className="mt-4 space-y-4"
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (!isPending) {
                      submitRequest();
                    }
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-700">First name</label>
                      <Input
                        value={formState.firstName}
                        onChange={(event) => setFormState((current) => ({ ...current, firstName: event.target.value }))}
                        placeholder="First name"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-700">Last name</label>
                      <Input
                        value={formState.lastName}
                        onChange={(event) => setFormState((current) => ({ ...current, lastName: event.target.value }))}
                        placeholder="Last name"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-700">Gender</label>
                      <Select
                        value={formState.gender}
                        onChange={(event) => setFormState((current) => ({ ...current, gender: event.target.value }))}
                      >
                        <option value="MALE">Male</option>
                        <option value="FEMALE">Female</option>
                        <option value="OTHER">Other</option>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-700">Date joined</label>
                      <Input
                        type="date"
                        value={formState.dateJoined}
                        onChange={(event) => setFormState((current) => ({ ...current, dateJoined: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-700">Phone</label>
                      <Input
                        value={formState.phone}
                        onChange={(event) => setFormState((current) => ({ ...current, phone: event.target.value }))}
                        placeholder="Optional phone"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-700">Email</label>
                      <Input
                        type="email"
                        value={formState.email}
                        onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
                        placeholder="Optional email"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" onClick={closeModal} disabled={isPending}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={submitRequest} disabled={isPending}>
                      {isPending ? "Sending..." : "Send for Approval"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}
