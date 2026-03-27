"use client";

import { Copy, Home, Link2, MoreVertical, Upload, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { assignMemberStructureAction, createHomecellAction } from "@/app/dashboard/admin/churches/actions";
import { importMembersAction } from "@/app/dashboard/members/actions";
import { MemberForm } from "@/components/members/member-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Option = {
  id: string;
  name: string;
};

type ImportRow = {
  firstName: string;
  lastName: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  dateJoined: string;
  phone?: string;
  email?: string;
  homecellName?: string;
  membershipStatus?: "ACTIVE" | "INACTIVE" | "VISITOR";
};

type MembersTableMenuProps = {
  departments: Option[];
  homecells: Option[];
  members: Option[];
  leaders: Array<Option & { role: string }>;
  regions: Option[];
  zones: Option[];
  canSetupHomecells: boolean;
};

const RECOMMENDED_HEADERS = [
  { key: "firstName", required: true },
  { key: "lastName", required: true },
  { key: "gender", required: true },
  { key: "dateJoined", required: true },
  { key: "phone", required: false },
  { key: "email", required: false },
  { key: "homecellName", required: false },
  { key: "membershipStatus", required: false },
] as const;
const RECOMMENDED_HEADER_LINE = RECOMMENDED_HEADERS.map((item) => item.key).join(",");
const TEMPLATE_EXAMPLE_ROW = "John,Doe,MALE,2026-03-01,+1-555-0101,john@example.com,Homecell Alpha,ACTIVE";

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function parseGender(value: string): "MALE" | "FEMALE" | "OTHER" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "male" || normalized === "m") return "MALE";
  if (normalized === "female" || normalized === "f") return "FEMALE";
  return "OTHER";
}

function parseMembershipStatus(value: string): "ACTIVE" | "INACTIVE" | "VISITOR" | undefined {
  const normalized = value.trim().toUpperCase();
  if (normalized === "ACTIVE" || normalized === "INACTIVE" || normalized === "VISITOR") {
    return normalized;
  }
  return undefined;
}

function parseRows(text: string): { rows: ImportRow[]; error?: string } {
  const matrix = parseCsv(text).filter((line) => line.some((value) => value.trim().length > 0));
  if (matrix.length < 2) {
    return { rows: [], error: "CSV needs a header row and at least one data row." };
  }

  const header = matrix[0].map(normalizeHeader);
  const columnIndex = {
    firstName: header.indexOf("firstname"),
    lastName: header.indexOf("lastname"),
    gender: header.indexOf("gender"),
    dateJoined: header.indexOf("datejoined"),
    phone: header.indexOf("phone"),
    email: header.indexOf("email"),
    homecellName: header.indexOf("homecellname"),
    homecellAlt: header.indexOf("homecell"),
    membershipStatus: header.indexOf("membershipstatus"),
  };

  if (
    columnIndex.firstName < 0 ||
    columnIndex.lastName < 0 ||
    columnIndex.gender < 0 ||
    columnIndex.dateJoined < 0
  ) {
    return {
      rows: [],
      error: "Required headers: firstName,lastName,gender,dateJoined",
    };
  }

  const rows: ImportRow[] = matrix.slice(1).map((line) => {
    const homecellValueIndex = columnIndex.homecellName >= 0 ? columnIndex.homecellName : columnIndex.homecellAlt;
    return {
      firstName: (line[columnIndex.firstName] ?? "").trim(),
      lastName: (line[columnIndex.lastName] ?? "").trim(),
      gender: parseGender(line[columnIndex.gender] ?? ""),
      dateJoined: (line[columnIndex.dateJoined] ?? "").trim(),
      phone: (line[columnIndex.phone] ?? "").trim(),
      email: (line[columnIndex.email] ?? "").trim().toLowerCase(),
      homecellName: homecellValueIndex >= 0 ? (line[homecellValueIndex] ?? "").trim() : "",
      membershipStatus:
        columnIndex.membershipStatus >= 0
          ? parseMembershipStatus(line[columnIndex.membershipStatus] ?? "")
          : undefined,
    };
  });

  return { rows };
}

function ModalContainer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const portalRoot = typeof window === "undefined" ? null : document.body;
  if (!portalRoot) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/35 p-4">
      <button type="button" className="absolute inset-0" aria-label="Close popup" onClick={onClose} />
      <div className="relative z-[10000] w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
            aria-label="Close popup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    portalRoot,
  );
}

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

export function MembersTableMenu({
  departments,
  homecells,
  members,
  leaders,
  regions,
  zones,
  canSetupHomecells,
}: MembersTableMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addHomecellOpen, setAddHomecellOpen] = useState(false);
  const [assignHomecellOpen, setAssignHomecellOpen] = useState(false);

  const [csvText, setCsvText] = useState("");
  const [defaultHomecellId, setDefaultHomecellId] = useState("");
  const [lastErrors, setLastErrors] = useState<string[]>([]);

  const [leaderSource, setLeaderSource] = useState<"MEMBER" | "USER">("MEMBER");
  const [leaderUserId, setLeaderUserId] = useState("");
  const [leaderMemberId, setLeaderMemberId] = useState("");
  const [assignMemberId, setAssignMemberId] = useState("");
  const [assignHomecellId, setAssignHomecellId] = useState("");

  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const parsedCount = useMemo(() => {
    if (!csvText.trim()) return 0;
    const rows = parseCsv(csvText).filter((line) => line.some((value) => value.trim().length > 0));
    return rows.length > 1 ? rows.length - 1 : 0;
  }, [csvText]);

  useEffect(() => {
    if (!addOpen && !importOpen && !addHomecellOpen && !assignHomecellOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [addHomecellOpen, addOpen, assignHomecellOpen, importOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  async function readFile(file: File) {
    const text = await file.text();
    setCsvText(text);
  }

  function handleImport() {
    const parsed = parseRows(csvText);
    if (parsed.error) {
      toast.error(parsed.error);
      return;
    }

    startTransition(async () => {
      const result = await importMembersAction({
        rows: parsed.rows,
        defaultHomecellId,
      });

      setLastErrors(result.errors);
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      if (result.failed === 0) {
        setCsvText("");
        setImportOpen(false);
      }
    });
  }

  function useTemplate() {
    setCsvText(`${RECOMMENDED_HEADER_LINE}\n${TEMPLATE_EXAMPLE_ROW}`);
    toast.success("Template loaded. Replace sample rows with your data.");
  }

  async function copyHeaders() {
    try {
      await navigator.clipboard.writeText(RECOMMENDED_HEADER_LINE);
      toast.success("Header order copied.");
    } catch {
      toast.error("Could not copy header order.");
    }
  }

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          aria-label="Open members table menu"
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {menuOpen ? (
          <div className="absolute top-11 right-0 z-40 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
            <button
              type="button"
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setMenuOpen(false);
                setAddOpen(true);
              }}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Add member
            </button>
            <button
              type="button"
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setMenuOpen(false);
                setImportOpen(true);
              }}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import members
            </button>
            {canSetupHomecells ? (
              <>
                <button
                  type="button"
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setMenuOpen(false);
                    setAddHomecellOpen(true);
                  }}
                >
                  <Home className="mr-2 h-4 w-4" />
                  Add homecell
                </button>
                <button
                  type="button"
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setMenuOpen(false);
                    setAssignHomecellOpen(true);
                  }}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  Assign homecell
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {addOpen ? (
        <ModalContainer
          title="Add Member"
          subtitle="Create a member profile without leaving the membership table."
          onClose={() => setAddOpen(false)}
        >
          <MemberForm mode="create" departments={departments} homecells={homecells} />
        </ModalContainer>
      ) : null}

      {importOpen ? (
        <ModalContainer
          title="Import Members"
          subtitle="Use the recommended header order, then paste or upload your CSV."
          onClose={() => setImportOpen(false)}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Step 1: CSV header order (recommended)</p>
                <button
                  type="button"
                  onClick={() => void copyHeaders()}
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy headers
                </button>
              </div>
              <p className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700">
                {RECOMMENDED_HEADER_LINE}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {RECOMMENDED_HEADERS.map((item, index) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                  >
                    <span className="font-medium text-slate-700">
                      {index + 1}. {item.key}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        item.required
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {item.required ? "Required" : "Optional"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1.2fr_280px]">
              <Textarea
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                placeholder={`${RECOMMENDED_HEADER_LINE}\n${TEMPLATE_EXAMPLE_ROW}`}
                className="min-h-56"
              />
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={useTemplate}
                  className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Use Template
                </button>
                <label className="block text-sm font-medium text-slate-700">
                  CSV file
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="mt-1 block w-full text-sm text-slate-700"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      void readFile(file);
                    }}
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Default homecell (optional)
                  <Select value={defaultHomecellId} onChange={(event) => setDefaultHomecellId(event.target.value)}>
                    <option value="">No default</option>
                    {homecells.map((homecell) => (
                      <option key={homecell.id} value={homecell.id}>
                        {homecell.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Rows detected: <span className="font-semibold text-slate-800">{parsedCount}</span>
                </div>
              </div>
            </div>

            {lastErrors.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="font-semibold">Import feedback</p>
                <ul className="mt-2 list-disc pl-4">
                  {lastErrors.slice(0, 10).map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button type="button" disabled={isPending || !csvText.trim()} onClick={handleImport}>
                {isPending ? "Importing..." : "Run Import"}
              </Button>
            </div>
          </div>
        </ModalContainer>
      ) : null}

      {addHomecellOpen ? (
        <ModalContainer
          title="Add Homecell"
          subtitle="Create a homecell and optionally assign a leader."
          onClose={() => setAddHomecellOpen(false)}
        >
          <form
            className="grid gap-3"
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
                  setAddHomecellOpen(false);
                });
              });
            }}
          >
            <Input name="name" placeholder="Homecell name" />
            <div className="grid gap-3 md:grid-cols-2">
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
            </div>
            <Select value={leaderSource} onChange={(event) => setLeaderSource(event.target.value as "MEMBER" | "USER")}>
              <option value="MEMBER">Leader from member list</option>
              <option value="USER">Leader from existing users</option>
            </Select>
            {leaderSource === "USER" ? (
              <Select value={leaderUserId} onChange={(event) => setLeaderUserId(event.target.value)}>
                <option value="">No leader yet</option>
                {leaders.map((leader) => (
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
            <div className="flex justify-end">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Create Homecell"}
              </Button>
            </div>
          </form>
        </ModalContainer>
      ) : null}

      {assignHomecellOpen ? (
        <ModalContainer
          title="Assign Member To Homecell"
          subtitle="Map a member directly to a selected homecell."
          onClose={() => setAssignHomecellOpen(false)}
        >
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData();
              formData.set("memberId", assignMemberId);
              formData.set("homecellId", assignHomecellId);
              formData.set("regionId", "");
              formData.set("zoneId", "");

              startTransition(async () => {
                await runAction(() => assignMemberStructureAction(formData), () => {
                  setAssignMemberId("");
                  setAssignHomecellId("");
                  setAssignHomecellOpen(false);
                });
              });
            }}
          >
            <Select value={assignMemberId} onChange={(event) => setAssignMemberId(event.target.value)}>
              <option value="">Select member</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
            <Select value={assignHomecellId} onChange={(event) => setAssignHomecellId(event.target.value)}>
              <option value="">Select homecell</option>
              {homecells.map((homecell) => (
                <option key={homecell.id} value={homecell.id}>
                  {homecell.name}
                </option>
              ))}
            </Select>
            <div className="flex justify-end">
              <Button type="submit" disabled={isPending || !assignMemberId || !assignHomecellId}>
                {isPending ? "Saving..." : "Assign"}
              </Button>
            </div>
          </form>
        </ModalContainer>
      ) : null}
    </>
  );
}
