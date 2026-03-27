"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { formatPercent } from "@/lib/utils";

type ServiceDaySummary = {
  id: string;
  title: string;
  serviceType: "SUNDAY" | "MIDWEEK" | "SPECIAL" | "CUSTOM";
  totalAttendance: number;
  presentAttendance: number;
  onlineAttendance: number;
  absentAttendance: number;
  attendanceRate: number;
};

type CalendarDaySummary = {
  key: string;
  dayNumber: number;
  inSelectedMonth: boolean;
  servicesCount: number;
  totalAttendance: number;
  presentAttendance: number;
  onlineAttendance: number;
  absentAttendance: number;
  attendanceRate: number;
  services: ServiceDaySummary[];
};

type DashboardCalendarSummaryProps = {
  monthLabel: string;
  days: CalendarDaySummary[];
};

const CALENDAR_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function formatDateKey(dateKey: string) {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatServiceTypeLabel(serviceType: ServiceDaySummary["serviceType"]) {
  switch (serviceType) {
    case "SUNDAY":
      return "Sunday";
    case "MIDWEEK":
      return "Midweek";
    case "SPECIAL":
      return "Special";
    case "CUSTOM":
      return "Custom";
    default:
      return serviceType;
  }
}

export function DashboardCalendarSummary({ monthLabel, days }: DashboardCalendarSummaryProps) {
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const portalRoot = typeof window === "undefined" ? null : document.body;
  const selectedDay = selectedDayKey ? days.find((day) => day.key === selectedDayKey) ?? null : null;

  useEffect(() => {
    if (!selectedDay) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedDay]);

  return (
    <>
      <p className="mt-3 text-sm text-slate-600">
        Viewing: <span className="font-medium">{monthLabel}</span>
      </p>
      <div className="mt-4 grid grid-cols-7 gap-2 text-xs font-medium text-slate-500">
        {CALENDAR_DAY_LABELS.map((label) => (
          <p key={label} className="rounded-md bg-slate-50 py-1 text-center">
            {label}
          </p>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((day) =>
          day.inSelectedMonth ? (
            <button
              key={day.key}
              type="button"
              onClick={() => setSelectedDayKey(day.key)}
              className="rounded-xl border border-slate-200 bg-white p-2 text-left hover:border-sky-300 hover:bg-sky-50/40"
            >
              <p className="text-xs font-semibold text-slate-800">{day.dayNumber}</p>
              <p className="mt-2 text-[11px] text-slate-600">
                Services: <span className="font-medium">{day.servicesCount}</span>
              </p>
              <p className="text-[11px] text-slate-600">
                Attendance: <span className="font-medium">{day.presentAttendance + day.onlineAttendance}</span>/
                {day.totalAttendance}
              </p>
            </button>
          ) : (
            <div key={day.key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2">
              <p className="text-xs font-semibold text-slate-400">{day.dayNumber}</p>
              <p className="mt-2 text-[11px] text-slate-400">Outside month</p>
            </div>
          ),
        )}
      </div>

      {selectedDay && portalRoot
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/45 p-3 sm:p-4">
              <button
                type="button"
                aria-label="Close selected day summary"
                className="absolute inset-0"
                onClick={() => setSelectedDayKey(null)}
              />
              <div className="relative z-[10000] max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Day Summary</h3>
                    <p className="mt-1 text-sm text-slate-600">{formatDateKey(selectedDay.key)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDayKey(null)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
                    aria-label="Close selected day summary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Badge>Services: {selectedDay.servicesCount}</Badge>
                  <Badge variant="success">Present: {selectedDay.presentAttendance}</Badge>
                  <Badge variant="warning">Online: {selectedDay.onlineAttendance}</Badge>
                  <Badge variant="danger">Absent: {selectedDay.absentAttendance}</Badge>
                  <Badge>
                    Rate:{" "}
                    {formatPercent(selectedDay.attendanceRate)}
                  </Badge>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedDay.services.length > 0 ? (
                    selectedDay.services.map((service) => (
                      <div key={service.id} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{service.title}</p>
                          <Badge>{formatServiceTypeLabel(service.serviceType)}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-slate-600">
                          Attendance: {service.presentAttendance + service.onlineAttendance}/{service.totalAttendance} (
                          {formatPercent(service.attendanceRate)})
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Present {service.presentAttendance} | Online {service.onlineAttendance} | Absent{" "}
                          {service.absentAttendance}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      No services were recorded for this date.
                    </p>
                  )}
                </div>
              </div>
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}

