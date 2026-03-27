"use client";

import { Copy, Upload, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { importMembersAction } from "@/app/dashboard/members/actions";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
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

type ImportMembersPanelProps = {
  homecells: Option[];
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

export function ImportMembersPanel({ homecells }: ImportMembersPanelProps) {
  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [defaultHomecellId, setDefaultHomecellId] = useState("");
  const [lastErrors, setLastErrors] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const parsedCount = useMemo(() => {
    if (!csvText.trim()) return 0;
    const rows = parseCsv(csvText);
    return rows.length > 1 ? rows.length - 1 : 0;
  }, [csvText]);

  async function readFile(file: File) {
    const text = await file.text();
    setCsvText(text);
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
      }
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Import Members</CardTitle>
          <CardDescription className="mt-1">
            Upload or paste CSV to bulk-create member profiles, with optional default homecell assignment.
          </CardDescription>
        </div>
        <Button type="button" variant={open ? "secondary" : "default"} onClick={() => setOpen((value) => !value)}>
          {open ? <X className="mr-2 h-4 w-4" /> : <Upload className="mr-2 h-4 w-4" />}
          {open ? "Close Import" : "Import CSV"}
        </Button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4">
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
              className="min-h-48"
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
      ) : null}
    </Card>
  );
}
