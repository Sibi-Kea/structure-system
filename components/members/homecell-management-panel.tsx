"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { assignMemberStructureAction, createHomecellAction } from "@/app/dashboard/admin/churches/actions";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Option = {
  id: string;
  name: string;
};

type LeaderOption = Option & {
  role: string;
};

type HomecellManagementPanelProps = {
  leaders: LeaderOption[];
  regions: Option[];
  zones: Option[];
  homecells: Option[];
  members: Option[];
};

async function runAction(
  action: () => Promise<{ success: boolean; message: string }>,
  onSuccess: () => void,
) {
  const result = await action();
  if (!result.success) {
    toast.error(result.message);
    return;
  }

  toast.success(result.message);
  onSuccess();
}

export function HomecellManagementPanel({
  leaders,
  regions,
  zones,
  homecells,
  members,
}: HomecellManagementPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [leaderSource, setLeaderSource] = useState<"MEMBER" | "USER">("MEMBER");
  const [leaderUserId, setLeaderUserId] = useState("");
  const [leaderMemberId, setLeaderMemberId] = useState("");
  const leaderOptions = leaders;

  return (
    <Card>
      <CardTitle>Homecell Setup</CardTitle>
      <CardDescription className="mt-1">
        Create homecells, assign a leader, and place members into the right homecell. When a member is chosen as
        leader, their login account is created automatically.
      </CardDescription>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">Create Homecell</p>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              if (leaderSource === "USER") {
                formData.set("leaderId", leaderUserId);
                formData.set("leaderMemberId", "");
              } else {
                formData.set("leaderMemberId", leaderMemberId);
                formData.set("leaderId", "");
              }
              startTransition(async () => {
                await runAction(() => createHomecellAction(formData), () => {
                  event.currentTarget.reset();
                  setLeaderSource("MEMBER");
                  setLeaderUserId("");
                  setLeaderMemberId("");
                  router.refresh();
                });
              });
            }}
          >
            <Input name="name" placeholder="Homecell name" />
            <Select name="regionId" defaultValue="">
              <option value="">Auto from zone / none</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>
            <Select name="zoneId" defaultValue="">
              <option value="">No zone</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </Select>
            <Select value={leaderSource} onChange={(event) => setLeaderSource(event.target.value as "MEMBER" | "USER")}>
              <option value="MEMBER">Leader from member list</option>
              <option value="USER">Leader from existing users</option>
            </Select>
            {leaderSource === "USER" ? (
              <Select value={leaderUserId} onChange={(event) => setLeaderUserId(event.target.value)}>
                <option value="">No leader yet</option>
                {leaderOptions.map((leader) => (
                  <option key={leader.id} value={leader.id}>
                    {leader.name} ({leader.role})
                  </option>
                ))}
              </Select>
            ) : (
              <Select value={leaderMemberId} onChange={(event) => setLeaderMemberId(event.target.value)}>
                <option value="">No leader yet</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <Input name="meetingDay" placeholder="Meeting day" />
              <Input name="meetingTime" placeholder="Meeting time (18:30)" />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Create Homecell"}
            </Button>
          </form>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">Add Members To Homecell</p>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              startTransition(async () => {
                await runAction(() => assignMemberStructureAction(formData), () => {
                  event.currentTarget.reset();
                  router.refresh();
                });
              });
            }}
          >
            <Select name="memberId" defaultValue="">
              <option value="">Select member</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
            <Select name="homecellId" defaultValue="">
              <option value="">Select homecell</option>
              {homecells.map((homecell) => (
                <option key={homecell.id} value={homecell.id}>
                  {homecell.name}
                </option>
              ))}
            </Select>
            <input type="hidden" name="regionId" value="" />
            <input type="hidden" name="zoneId" value="" />
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Assign Member"}
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
