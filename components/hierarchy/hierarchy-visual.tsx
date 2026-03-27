"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { cn, formatPercent, getInitials, toStartCase } from "@/lib/utils";

type StructureRole = "OVERSEER" | "SUPERVISOR" | "COORDINATOR" | "HOMECELL_LEADER";

type StructureNode = {
  id: string;
  name: string;
  role: StructureRole;
  parentLeaderId: string | null;
  regionId: string | null;
  zoneId: string | null;
  homecellId: string | null;
};

type HomecellSummary = {
  id: string;
  name: string;
  leaderNames: string[];
  membersCount: number;
  attendanceRate: number;
  growth: number;
};

type ZoneTree = {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
  nodes: StructureNode[];
  homecells: HomecellSummary[];
};

type ZoneBranch = {
  overseer: StructureNode | null;
  supervisor: StructureNode | null;
  coordinator: StructureNode | null;
  homecellLeader: StructureNode | null;
};

type HierarchyVisualProps = {
  churchName: string;
  pastorName: string;
  leadershipMetrics: {
    loggedInName: string;
    loggedInRole: string;
    totalHomecells: number;
    totalLeaders: number;
    totalRegions: number;
    totalZones: number;
  };
  summary: {
    pastors: string[];
    overseers: string[];
    supervisors: string[];
    coordinators: string[];
    homecellLeaders: string[];
  };
  zones: ZoneTree[];
};

const ROLE_ORDER: StructureRole[] = ["OVERSEER", "SUPERVISOR", "COORDINATOR", "HOMECELL_LEADER"];

function namesOrFallback(names: string[]) {
  return names.length ? names.join(", ") : "Unassigned";
}

function roleWeight(role: StructureRole) {
  if (role === "OVERSEER") return 1;
  if (role === "SUPERVISOR") return 2;
  if (role === "COORDINATOR") return 3;
  return 4;
}

function buildChildrenMap(nodes: StructureNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const map = new Map<string, StructureNode[]>();
  for (const node of nodes) {
    if (!node.parentLeaderId || !ids.has(node.parentLeaderId)) continue;
    const current = map.get(node.parentLeaderId) ?? [];
    current.push(node);
    map.set(node.parentLeaderId, current);
  }
  for (const [parentId, children] of map.entries()) {
    map.set(
      parentId,
      [...children].sort(
        (a, b) => roleWeight(a.role) - roleWeight(b.role) || a.name.localeCompare(b.name),
      ),
    );
  }
  return map;
}

function getRoots(nodes: StructureNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  return [...nodes]
    .filter((node) => !node.parentLeaderId || !ids.has(node.parentLeaderId))
    .sort((a, b) => roleWeight(a.role) - roleWeight(b.role) || a.name.localeCompare(b.name));
}

function findFirstDescendantByRole(
  rootId: string,
  role: StructureRole,
  childrenByParent: Map<string, StructureNode[]>,
) {
  const queue = [...(childrenByParent.get(rootId) ?? [])];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    if (node.role === role) return node;
    queue.push(...(childrenByParent.get(node.id) ?? []));
  }
  return null;
}

function collectDescendants(id: string, childrenByParent: Map<string, StructureNode[]>) {
  const out: StructureNode[] = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const children = childrenByParent.get(current) ?? [];
    for (const child of children) {
      out.push(child);
      stack.push(child.id);
    }
  }
  return out;
}

function buildBranches(nodes: StructureNode[]) {
  const childrenByParent = buildChildrenMap(nodes);
  const roots = getRoots(nodes);
  const overseerRoots = roots.filter((node) => node.role === "OVERSEER");
  const seeds = overseerRoots.length > 0 ? overseerRoots : roots;

  return seeds.map((seed) => {
    const overseer =
      (seed.role === "OVERSEER" ? seed : null) ??
      findFirstDescendantByRole(seed.id, "OVERSEER", childrenByParent);
    const supervisor =
      (seed.role === "SUPERVISOR" ? seed : null) ??
      findFirstDescendantByRole(overseer?.id ?? seed.id, "SUPERVISOR", childrenByParent) ??
      findFirstDescendantByRole(seed.id, "SUPERVISOR", childrenByParent);
    const coordinator =
      (seed.role === "COORDINATOR" ? seed : null) ??
      findFirstDescendantByRole(supervisor?.id ?? overseer?.id ?? seed.id, "COORDINATOR", childrenByParent) ??
      findFirstDescendantByRole(seed.id, "COORDINATOR", childrenByParent);
    const homecellLeader =
      (seed.role === "HOMECELL_LEADER" ? seed : null) ??
      findFirstDescendantByRole(
        coordinator?.id ?? supervisor?.id ?? overseer?.id ?? seed.id,
        "HOMECELL_LEADER",
        childrenByParent,
      ) ??
      findFirstDescendantByRole(seed.id, "HOMECELL_LEADER", childrenByParent);

    return {
      overseer,
      supervisor,
      coordinator,
      homecellLeader,
    };
  });
}

function getBranchNode(branch: ZoneBranch, role: StructureRole) {
  if (role === "OVERSEER") return branch.overseer;
  if (role === "SUPERVISOR") return branch.supervisor;
  if (role === "COORDINATOR") return branch.coordinator;
  return branch.homecellLeader;
}

function deriveZoneAttendance(zone: ZoneTree) {
  const weightedMembers = zone.homecells.reduce((total, homecell) => total + Math.max(homecell.membersCount, 1), 0);
  const attendanceWeight = zone.homecells.reduce(
    (total, homecell) => total + homecell.attendanceRate * Math.max(homecell.membersCount, 1),
    0,
  );
  return weightedMembers ? attendanceWeight / weightedMembers : 0;
}

function NodeCard({
  node,
  active,
  onClick,
}: {
  node: StructureNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mx-auto flex h-[124px] w-[172px] flex-col items-center justify-center rounded-xl border px-3 py-2 text-center",
        active ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50",
      )}
    >
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-xs font-semibold text-slate-700">
        {getInitials(node.name)}
      </div>
      <p className="text-sm leading-tight font-medium text-slate-900">{node.name}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{toStartCase(node.role)}</p>
    </button>
  );
}

function EmptyNodeCard({ role }: { role: StructureRole }) {
  return (
    <div className="mx-auto flex h-[124px] w-[172px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-3 text-center text-xs text-slate-400">
      No {toStartCase(role)}
    </div>
  );
}

export function HierarchyVisual({
  churchName,
  pastorName,
  leadershipMetrics,
  summary,
  zones,
}: HierarchyVisualProps) {
  const [selectedZoneId, setSelectedZoneId] = useState(zones[0]?.id ?? "");
  const [showSelectedOnly, setShowSelectedOnly] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(zones[0]?.nodes[0]?.id ?? null);

  const activeZone = zones.find((zone) => zone.id === selectedZoneId) ?? zones[0] ?? null;
  const activeNodes = activeZone?.nodes ?? [];
  const activeNodeMap = new Map(activeNodes.map((node) => [node.id, node]));
  const activeChildrenByParent = buildChildrenMap(activeNodes);

  const resolvedSelectedNodeId =
    selectedNodeId && activeNodeMap.has(selectedNodeId) ? selectedNodeId : activeNodes[0]?.id ?? null;
  const selectedNode = resolvedSelectedNodeId ? activeNodeMap.get(resolvedSelectedNodeId) ?? null : null;
  const selectedDescendants = selectedNode ? collectDescendants(selectedNode.id, activeChildrenByParent) : [];

  const subtreeCounts = (selectedNode ? [selectedNode, ...selectedDescendants] : []).reduce(
    (count, node) => {
      if (node.role === "OVERSEER") count.overseers += 1;
      if (node.role === "SUPERVISOR") count.supervisors += 1;
      if (node.role === "COORDINATOR") count.coordinators += 1;
      if (node.role === "HOMECELL_LEADER") count.homecellLeaders += 1;
      return count;
    },
    { overseers: 0, supervisors: 0, coordinators: 0, homecellLeaders: 0 },
  );

  const visibleZones = showSelectedOnly && activeZone ? [activeZone] : zones;

  function selectZone(zoneId: string) {
    setSelectedZoneId(zoneId);
    const zone = zones.find((entry) => entry.id === zoneId);
    setSelectedNodeId(zone?.nodes[0]?.id ?? null);
  }

  function handleNodeClick(zoneId: string, nodeId: string) {
    setSelectedZoneId(zoneId);
    setSelectedNodeId(nodeId);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>{churchName} Structure Overview</CardTitle>
        <CardDescription className="mt-1">Read-only pastor-to-homecell hierarchy view.</CardDescription>
      </Card>

      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <Badge>Logged In</Badge>
            <p className="mt-2 text-sm text-slate-900">{leadershipMetrics.loggedInName}</p>
            <p className="text-xs text-slate-500">{toStartCase(leadershipMetrics.loggedInRole)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <Badge>Total Homecells</Badge>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{leadershipMetrics.totalHomecells}</p>
            <p className="text-xs text-slate-500">
              {leadershipMetrics.totalRegions} regions | {leadershipMetrics.totalZones} zones
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <Badge>Total Leaders</Badge>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{leadershipMetrics.totalLeaders}</p>
            <p className="text-xs text-slate-500">Across overseer, supervisor, coordinator, and homecell leader</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <Badge>Hierarchy Chain</Badge>
            <p className="mt-2 text-sm text-slate-700">
              Pastor to Overseer to Supervisor to Coordinator to Homecell Leader
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Select
            value={selectedZoneId}
            onChange={(event) => selectZone(event.target.value)}
            disabled={zones.length === 0}
          >
            {zones.length === 0 ? (
              <option value="">No zones configured yet</option>
            ) : (
              zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name} ({zone.regionName})
                </option>
              ))
            )}
          </Select>
          <Button type="button" variant="outline" onClick={() => setShowSelectedOnly((value) => !value)}>
            <Eye className="mr-2 h-4 w-4" />
            {showSelectedOnly ? "Show All Zones" : "Show Selected Zone Only"}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <Badge>Pastor</Badge>
            <p className="mt-2 text-sm text-slate-700">{namesOrFallback(summary.pastors)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <Badge>Overseer</Badge>
            <p className="mt-2 text-sm text-slate-700">{namesOrFallback(summary.overseers)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <Badge>Supervisor</Badge>
            <p className="mt-2 text-sm text-slate-700">{namesOrFallback(summary.supervisors)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <Badge>Coordinator</Badge>
            <p className="mt-2 text-sm text-slate-700">{namesOrFallback(summary.coordinators)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <Badge>Homecell Leader</Badge>
            <p className="mt-2 text-sm text-slate-700">{namesOrFallback(summary.homecellLeaders)}</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {visibleZones.map((zone) => {
            const branches = buildBranches(zone.nodes);
            const columns = Math.max(branches.length, 1);
            const zoneAttendance = deriveZoneAttendance(zone);
            const gridStyle = { gridTemplateColumns: `repeat(${columns}, minmax(170px, 1fr))` };

            return (
              <Card key={zone.id} className="space-y-3 border-l-4 border-l-sky-300">
                <div>
                  <h3 className="text-2xl font-semibold text-slate-900">{zone.name}</h3>
                  <p className="text-sm text-slate-500">
                    {zone.regionName} | {zone.homecells.length} homecells | {formatPercent(zoneAttendance)} attendance
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedZoneId(zone.id);
                        setSelectedNodeId(zone.nodes[0]?.id ?? null);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-center"
                    >
                      <p className="text-sm font-medium text-slate-900">{pastorName}</p>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Pastor</p>
                    </button>
                  </div>
                  <div className="flex justify-center">
                    <span className="h-4 w-px bg-slate-300" />
                  </div>

                  {ROLE_ORDER.map((role, roleIndex) => {
                    const showRowLine = roleIndex > 0 || columns > 1;
                    const slots = branches.length > 0 ? branches : [null];

                    return (
                      <div key={`${zone.id}-${role}`} className="relative pb-2">
                        {showRowLine ? (
                          <div className="pointer-events-none absolute top-0 right-4 left-4 border-t border-slate-300" />
                        ) : null}
                        <div className="pt-3">
                          <div className="grid gap-4" style={gridStyle}>
                            {slots.map((branch, index) => {
                              const node = branch ? getBranchNode(branch, role) : null;
                              return (
                                <div
                                  key={`${zone.id}-${role}-${index}`}
                                  className="relative flex min-h-[142px] items-center justify-center pt-2"
                                >
                                  <span className="absolute top-0 h-3 w-px bg-slate-300" />
                                  {node ? (
                                    <NodeCard
                                      node={node}
                                      active={zone.id === activeZone?.id && node.id === selectedNode?.id}
                                      onClick={() => handleNodeClick(zone.id, node.id)}
                                    />
                                  ) : (
                                    <EmptyNodeCard role={role} />
                                  )}
                                  {role !== "HOMECELL_LEADER" && node ? (
                                    <span className="absolute bottom-0 h-3 w-px bg-slate-300" />
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>

        <Card className="h-fit xl:sticky xl:top-6">
          <CardTitle>Node Details</CardTitle>
          {selectedNode ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                <p className="font-semibold text-slate-900">{selectedNode.name}</p>
                <p className="text-slate-600">{toStartCase(selectedNode.role)}</p>
                <p className="mt-1 text-slate-500">
                  Zone: {activeZone?.name ?? "N/A"} | Region: {activeZone?.regionName ?? "N/A"}
                </p>
                <p className="mt-1 text-slate-500">
                  Direct reports: {activeChildrenByParent.get(selectedNode.id)?.length ?? 0}
                </p>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <p>Overseers: {subtreeCounts.overseers}</p>
                <p>Supervisors: {subtreeCounts.supervisors}</p>
                <p>Coordinators: {subtreeCounts.coordinators}</p>
                <p>Homecell Leaders: {subtreeCounts.homecellLeaders}</p>
              </div>
            </div>
          ) : (
            <CardDescription className="mt-4">Select a node from the hierarchy board.</CardDescription>
          )}
        </Card>
      </div>
    </div>
  );
}
