"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { approvePendingMemberRequestAction } from "@/app/dashboard/members/actions";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type PendingMemberApprovalItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  homecellName: string;
  requestedByName: string;
  createdAtLabel: string;
};

type PendingMemberApprovalPanelProps = {
  requests: PendingMemberApprovalItem[];
};

export function PendingMemberApprovalPanel({ requests }: PendingMemberApprovalPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  if (requests.length === 0) return null;

  return (
    <Card>
      <CardTitle>Pending Pastor Approval</CardTitle>
      <CardDescription className="mt-1">
        Quick-add member requests from reporting stay here until Pastor approves them into the main members table.
      </CardDescription>

      <div className="mt-4 space-y-3">
        {requests.map((request) => {
          const isCurrent = isPending && activeRequestId === request.id;
          return (
            <div
              key={request.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-slate-900">{request.name}</p>
                <p className="text-xs text-slate-500">
                  Homecell: {request.homecellName} | Requested by: {request.requestedByName} | {request.createdAtLabel}
                </p>
                <p className="text-xs text-slate-500">
                  {[request.phone, request.email].filter(Boolean).join(" | ") || "No contact captured"}
                </p>
              </div>

              <Button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setActiveRequestId(request.id);
                  startTransition(async () => {
                    const result = await approvePendingMemberRequestAction(request.id);
                    if (!result.success) {
                      toast.error(result.message);
                      setActiveRequestId(null);
                      return;
                    }

                    toast.success(result.message);
                    router.refresh();
                  });
                }}
              >
                {isCurrent ? "Approving..." : "Approve"}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
