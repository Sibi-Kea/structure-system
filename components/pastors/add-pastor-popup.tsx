"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type ChurchOption = {
  id: string;
  name: string;
};

type MemberOption = {
  id: string;
  churchId: string;
  name: string;
};

type ZoneOption = {
  id: string;
  churchId: string;
  name: string;
};

type AddPastorPopupProps = {
  canManage: boolean;
  churches: ChurchOption[];
  members: MemberOption[];
  zones: ZoneOption[];
  defaultChurchId: string;
};

export function AddPastorPopup({
  canManage,
  churches,
  members,
  zones,
  defaultChurchId,
}: AddPastorPopupProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [churchId, setChurchId] = useState(defaultChurchId);
  const [memberId, setMemberId] = useState("");
  const [zoneMode, setZoneMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [zoneId, setZoneId] = useState("");
  const [newZoneName, setNewZoneName] = useState("");

  const churchMembers = useMemo(
    () => members.filter((member) => member.churchId === churchId),
    [churchId, members],
  );
  const churchZones = useMemo(
    () => zones.filter((zone) => zone.churchId === churchId),
    [churchId, zones],
  );

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function resetForm() {
    setChurchId(defaultChurchId);
    setMemberId("");
    setZoneMode("EXISTING");
    setZoneId("");
    setNewZoneName("");
  }

  function closePopup() {
    setOpen(false);
    resetForm();
  }

  function submit() {
    if (!memberId) {
      toast.error("Please select a member pastor.");
      return;
    }
    if (zoneMode === "EXISTING" && !zoneId) {
      toast.error("Please select an existing zone.");
      return;
    }
    if (zoneMode === "NEW" && newZoneName.trim().length < 2) {
      toast.error("Please enter a new zone name.");
      return;
    }

    const formData = new FormData();
    formData.set("churchId", churchId);
    formData.set("memberId", memberId);
    formData.set("zoneMode", zoneMode);
    formData.set("zoneId", zoneMode === "EXISTING" ? zoneId : "");
    formData.set("newZoneName", zoneMode === "NEW" ? newZoneName.trim() : "");

    startTransition(async () => {
      const response = await fetch("/api/pastors/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          churchId: formData.get("churchId"),
          memberId: formData.get("memberId"),
          zoneMode: formData.get("zoneMode"),
          zoneId: formData.get("zoneId"),
          newZoneName: formData.get("newZoneName"),
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { success?: boolean; message?: string }
        | null;

      if (!response.ok || !result?.success) {
        toast.error(result?.message ?? "Could not assign pastor.");
        return;
      }
      if (!result.success) {
        toast.error(result.message ?? "Could not assign pastor.");
        return;
      }
      toast.success(result.message ?? "Pastor saved.");
      closePopup();
      router.refresh();
    });
  }

  if (!canManage) return null;
  const portalRoot = typeof window === "undefined" ? null : document.body;

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Add Pastor
      </Button>

      {open && portalRoot
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/45 p-3 sm:p-4">
              <button type="button" aria-label="Close add pastor popup" className="absolute inset-0" onClick={closePopup} />
              <div className="relative z-[10000] flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Add Pastor</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Select member, church, and assign to an existing zone or a new zone.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closePopup}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
                    aria-label="Close add pastor popup"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                  <Select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
                    <option value="">Select member pastor</option>
                    {churchMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={churchId}
                    onChange={(event) => {
                      const nextChurchId = event.target.value;
                      setChurchId(nextChurchId);
                      setMemberId("");
                      setZoneId("");
                    }}
                  >
                    {churches.map((church) => (
                      <option key={church.id} value={church.id}>
                        {church.name}
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={zoneMode}
                    onChange={(event) => {
                      const mode = event.target.value as "EXISTING" | "NEW";
                      setZoneMode(mode);
                      setZoneId("");
                      setNewZoneName("");
                    }}
                  >
                    <option value="EXISTING">Assign to existing zone</option>
                    <option value="NEW">Create new zone</option>
                  </Select>

                  {zoneMode === "EXISTING" ? (
                    <Select value={zoneId} onChange={(event) => setZoneId(event.target.value)}>
                      <option value="">Select zone</option>
                      {churchZones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={newZoneName}
                      onChange={(event) => setNewZoneName(event.target.value)}
                      placeholder="New zone name"
                    />
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                  <Button type="button" variant="outline" onClick={closePopup} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={submit} disabled={isPending}>
                    {isPending ? "Saving..." : "Save Pastor"}
                  </Button>
                </div>
              </div>
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}
