"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  Plus,
  Clock,
  Timer,
  Pencil,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isToday,
  addMonths,
  subMonths,
  getISOWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { summaryCan } from "@/lib/access-shared";
import { json, useAction } from "@/components/workforce/client";
import { TimeRecordForm } from "./time-record-form";
import { Stopwatch } from "./stopwatch";
import { AnomalyBadge, EmployeeAnomalyIndicator } from "./anomaly-badge";

// ---------- Types ----------

type TimeRecord = {
  breakSeconds: number;
  id: string;
  userId: string;
  date: string;
  timeFrom: string | null;
  timeTo: string | null;
  durationHours: number | null;
  durationMinutes: number | null;
  type: "MANUAL" | "WATCH" | "MANUAL_DURATION";
  categoryId: string | null;
  comment: string | null;
  category: { id: string; name: string } | null;
  /** Standort nach der Zuordnungsregel; null = nicht eindeutig (nur Admins und die Person sehen sie). */
  branchId: string | null;
  branch: { id: string; name: string } | null;
};

type BranchOption = { id: string; name: string; customer: { name: string } | null };

type EmployeeGroup = {
  userId: string;
  firstName: string;
  lastName: string;
  profileImage: string | null;
  totalHours: number;
  records: TimeRecord[];
};

type TimeResponse = {
  employees: EmployeeGroup[];
};

// ---------- Helpers ----------

const DAY_NAMES_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function getRecordDisplayTime(record: TimeRecord): string {
  if (
    (record.type === "MANUAL" || record.type === "WATCH") &&
    record.timeFrom
  ) {
    if (record.timeTo) {
      return `${record.timeFrom} - ${record.timeTo}`;
    }
    return `${record.timeFrom} - ...`;
  }
  if (record.type === "MANUAL_DURATION") {
    const h = record.durationHours ?? 0;
    const m = record.durationMinutes ?? 0;
    return `${h}h ${m}m`;
  }
  return "-";
}

function getRecordTypeIcon(type: TimeRecord["type"]) {
  switch (type) {
    case "MANUAL":
      return <Clock className="size-3.5 text-[var(--brand)]" />;
    case "WATCH":
      return <Timer className="size-3.5 text-ok" />;
    case "MANUAL_DURATION":
      return <Clock className="size-3.5 text-[var(--brand)]" />;
  }
}

/** Standort einer Buchung; Admins ordnen unklare Buchungen hier zu. */
function StandortAngabe({ record, admin, branches, pending, onAssign }: { record: TimeRecord; admin: boolean; branches: BranchOption[]; pending: boolean; onAssign: (recordId: string, branchId: string) => void }) {
  if (record.branch) return <span className="truncate text-xs text-muted-foreground">{record.branch.name}</span>;
  if (!admin) return <span className="text-xs text-muted-foreground">ohne Standort</span>;
  return (
    <select
      aria-label="Standort zuordnen"
      className="h-7 max-w-[12rem] rounded-[var(--radius)] border border-warn/45 bg-card px-1.5 text-xs"
      value=""
      disabled={pending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { if (e.target.value) onAssign(record.id, e.target.value); }}
    >
      <option value="">Standort zuordnen …</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>{b.name}{b.customer ? " · " + b.customer.name : ""}</option>
      ))}
    </select>
  );
}

// ---------- Component ----------

export function TimeList() {
  const { data: currentMember } = useCurrentMember();
  const isAdmin = !!currentMember?.access.isAdmin;
  // Mehr als die eigene Zeile gibt es nur mit Standort- und Personalrecht.
  const editsOthers = isAdmin || summaryCan(currentMember?.access, "EDIT_TIME");
  const assign = useAction();
  const { data: branchData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => json<{ branches: BranchOption[] }>("/api/branches"),
    enabled: isAdmin,
  });
  const branches = branchData?.branches ?? [];
  function assignBranch(recordId: string, branchId: string) {
    assign.mutate({ url: `/api/time/${recordId}/branch`, method: "PATCH", data: { branchId }, message: "Standort zugeordnet" });
  }

  // State
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [search, setSearch] = useState("");
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TimeRecord | null>(null);
  const [showStopwatch, setShowStopwatch] = useState(false);

  const monthKey = format(currentMonth, "yyyy-MM");

  // Fetch time records
  const { data, isLoading, error } = useQuery<TimeResponse>({
    queryKey: ["time-records", monthKey],
    queryFn: async () => {
      const res = await fetch(`/api/time?month=${monthKey}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Zeiterfassung");
      return res.json();
    },
  });

  const employees = data?.employees ?? [];

  // Fetch anomaly data for the month (managers only)
  const { data: anomalyData } = useQuery<{
    anomalies: {
      type: "long_shift" | "gap" | "overlap" | "deviation";
      severity: "warning" | "critical";
      employeeId: string;
      employeeName: string;
      date: string;
      details: string;
      value: number;
    }[];
    summary: { total: number; critical: number; warning: number };
  }>({
    queryKey: ["anomalies", monthKey],
    queryFn: async () => {
      const res = await fetch(`/api/ai/anomalies?month=${monthKey}`);
      if (!res.ok) return { anomalies: [], summary: { total: 0, critical: 0, warning: 0 } };
      return res.json();
    },
    enabled: isAdmin,
  });
  const anomalies = anomalyData?.anomalies ?? [];

  // Filter by search
  const filteredEmployees = useMemo(() => {
    if (!search) return employees;
    const q = search.toLowerCase();
    return employees.filter(
      (emp) =>
        emp.firstName.toLowerCase().includes(q) ||
        emp.lastName.toLowerCase().includes(q)
    );
  }, [employees, search]);

  // Personen fuer das Formular: fremde nur mit "Zeiterfassung bearbeiten"
  const employeeOptions = useMemo(
    () =>
      employees
        .filter((emp) => editsOthers || emp.userId === currentMember?.user.id)
        .map((emp) => ({
          userId: emp.userId,
          firstName: emp.firstName,
          lastName: emp.lastName,
        })),
    [employees, editsOthers, currentMember?.user.id]
  );
  const ohneStandort = employees.reduce((sum, emp) => sum + emp.records.filter((r) => !r.branchId).length, 0);

  // All days in the month
  const daysInMonth = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  // Group days by ISO week
  const weekGroups = useMemo(() => {
    const groups: { weekNumber: number; days: Date[] }[] = [];
    let currentWeek: { weekNumber: number; days: Date[] } | null = null;

    for (const day of daysInMonth) {
      const wn = getISOWeek(day);
      if (!currentWeek || currentWeek.weekNumber !== wn) {
        currentWeek = { weekNumber: wn, days: [] };
        groups.push(currentWeek);
      }
      currentWeek.days.push(day);
    }

    return groups;
  }, [daysInMonth]);

  // Navigation
  const navigatePrev = useCallback(() => {
    setCurrentMonth((prev) => subMonths(prev, 1));
  }, []);

  const navigateNext = useCallback(() => {
    setCurrentMonth((prev) => addMonths(prev, 1));
  }, []);

  const navigateToday = useCallback(() => {
    setCurrentMonth(new Date());
  }, []);

  // Toggle expand
  const toggleExpand = useCallback((userId: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  function handleEdit(record: TimeRecord) {
    setEditingRecord(record);
    setShowRecordForm(true);
  }

  // Get records for a specific user and date
  function getRecordsForDate(records: TimeRecord[], day: Date): TimeRecord[] {
    const dateStr = format(day, "yyyy-MM-dd");
    return records.filter((r) => r.date.slice(0, 10) === dateStr);
  }

  const monthLabel = format(currentMonth, "MMMM yyyy", { locale: de });
  const isCurrentMonth =
    format(currentMonth, "yyyy-MM") === format(new Date(), "yyyy-MM");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Zeiterfassung</h1>
          <p className="text-sm text-muted-foreground">
            Arbeitszeiten erfassen und verwalten
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowStopwatch(!showStopwatch)}
            aria-label="Stoppuhr anzeigen"
          >
            <Timer className="size-4" />
            <span className="hidden sm:inline">Stoppuhr</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingRecord(null);
              setShowRecordForm(true);
            }}
          >
            <Plus className="size-4" />
            Erfassen
          </Button>
        </div>
      </div>

      {/* Stopwatch widget */}
      {showStopwatch && (
        <div className="max-w-sm">
          <Stopwatch />
        </div>
      )}

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={navigatePrev}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-lg font-semibold capitalize min-w-[160px] text-center">
            {monthLabel}
          </span>
          <Button variant="outline" size="icon-sm" onClick={navigateNext}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {!isCurrentMonth && (
          <Button variant="ghost" size="sm" onClick={navigateToday}>
            Heute
          </Button>
        )}
      </div>

      {/* Anomaly Badge */}
      {isAdmin && (
        <AnomalyBadge month={monthKey} isManager={isAdmin} />
      )}

      {isAdmin && ohneStandort > 0 && (
        <p className="rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2 text-sm">
          {ohneStandort} {ohneStandort === 1 ? "Buchung ist" : "Buchungen sind"} in diesem Monat keinem Standort eindeutig zugeordnet.
          Bis zur Zuordnung sehen sie nur die Administration und die jeweilige Person.
        </p>
      )}

      {/* Search */}
      {employees.length > 1 && (
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mitarbeiter suchen..."
            className="pl-9"
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && <TimeListSkeleton />}

      {/* Error */}
      {error && (
        <Card className="p-6 text-center text-destructive">
          Fehler beim Laden der Zeiterfassung. Bitte versuche es erneut.
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !error && filteredEmployees.length === 0 && (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <Clock className="size-12 text-muted-foreground/50 mb-3" />
          <p className="text-lg font-medium">Keine Zeiterfassungen</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search
              ? "Keine Ergebnisse fuer die Suche."
              : "Noch keine Zeiten fuer diesen Monat erfasst."}
          </p>
        </Card>
      )}

      {/* Employee list (accordion) */}
      {!isLoading &&
        !error &&
        filteredEmployees.map((emp) => {
          const isExpanded = expandedUsers.has(emp.userId);
          return (
            <Card key={emp.userId} className="overflow-hidden">
              {/* Employee header */}
              <button
                type="button"
                onClick={() => toggleExpand(emp.userId)}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
              >
                <Avatar>
                  <AvatarFallback>
                    {getInitials(emp.firstName, emp.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {emp.lastName}, {emp.firstName}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {emp.records.length} Erfassung
                    {emp.records.length !== 1 ? "en" : ""}
                  </div>
                </div>
                {isAdmin && anomalies.length > 0 && (
                  <EmployeeAnomalyIndicator
                    anomalies={anomalies}
                    employeeId={emp.userId}
                  />
                )}
                <Badge
                  variant="secondary"
                  className="tabular text-sm"
                >
                  {formatHours(emp.totalHours)}
                </Badge>
                {isExpanded ? (
                  <ChevronUp className="size-5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="size-5 text-muted-foreground shrink-0" />
                )}
              </button>

              {/* Expanded: calendar-like day list */}
              {isExpanded && (
                <div className="border-t">
                  {/* Desktop: grouped by weeks */}
                  <div className="hidden md:block">
                    {weekGroups.map((week) => (
                      <div key={week.weekNumber} className="border-b last:border-b-0">
                        <div className="bg-muted/30 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                          KW {week.weekNumber}
                        </div>
                        {week.days.map((day) => {
                          const dayRecords = getRecordsForDate(
                            emp.records,
                            day
                          );
                          const dayOfWeek = getDay(day); // 0=Sun
                          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                          const today = isToday(day);

                          return (
                            <div
                              key={day.toISOString()}
                              className={cn(
                                "flex items-start gap-3 px-4 py-2 border-b last:border-b-0",
                                isWeekend && "bg-muted/20",
                                today && "bg-primary/5"
                              )}
                            >
                              {/* Date column */}
                              <div className="w-24 shrink-0 flex items-center gap-2">
                                <span
                                  className={cn(
                                    "text-xs font-medium w-5",
                                    isWeekend
                                      ? "text-muted-foreground"
                                      : "text-foreground"
                                  )}
                                >
                                  {DAY_NAMES_SHORT[dayOfWeek]}
                                </span>
                                <span
                                  className={cn(
                                    "text-sm tabular-nums",
                                    today
                                      ? "font-bold text-primary"
                                      : "text-muted-foreground"
                                  )}
                                >
                                  {format(day, "dd.MM.")}
                                </span>
                              </div>

                              {/* Records column */}
                              <div className="flex-1 min-w-0">
                                {dayRecords.length === 0 ? (
                                  <span className="text-xs text-muted-foreground/50">
                                    -
                                  </span>
                                ) : (
                                  <div className="space-y-1">
                                    {dayRecords.map((record) => (
                                      <div
                                        key={record.id}
                                        className="flex items-center gap-2 group"
                                      >
                                        {getRecordTypeIcon(record.type)}
                                        <span className="text-sm tabular">
                                          {getRecordDisplayTime(record)}
                                        </span>
                                        {record.category && (
                                          <Badge
                                            variant="outline"
                                            className="text-[10px] px-1.5 py-0"
                                          >
                                            {record.category.name}
                                          </Badge>
                                        )}
                                        <StandortAngabe record={record} admin={isAdmin} branches={branches} pending={assign.isPending} onAssign={assignBranch} />
                                        {record.comment && (
                                          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                                            {record.comment}
                                          </span>
                                        )}
                                        <div className="ml-auto flex items-center gap-1">
                                          <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label="Zeitkorrektur beantragen"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleEdit(record);
                                            }}
                                          >
                                            <Pencil className="size-3" />
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Mobile: simplified list */}
                  <div className="md:hidden">
                    {daysInMonth.map((day) => {
                      const dayRecords = getRecordsForDate(emp.records, day);
                      if (dayRecords.length === 0) return null;
                      const dayOfWeek = getDay(day);
                      const today = isToday(day);

                      return (
                        <div
                          key={day.toISOString()}
                          className={cn(
                            "px-4 py-3 border-b last:border-b-0",
                            today && "bg-primary/5"
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-xs font-medium">
                              {DAY_NAMES_SHORT[dayOfWeek]}
                            </span>
                            <span
                              className={cn(
                                "text-sm tabular-nums",
                                today
                                  ? "font-bold text-primary"
                                  : "text-muted-foreground"
                              )}
                            >
                              {format(day, "dd.MM.")}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {dayRecords.map((record) => (
                              <div
                                key={record.id}
                                className="flex items-center justify-between gap-2"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {getRecordTypeIcon(record.type)}
                                  <span className="text-sm tabular">
                                    {getRecordDisplayTime(record)}
                                  </span>
                                  {record.category && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0"
                                    >
                                      {record.category.name}
                                    </Badge>
                                  )}
                                  <StandortAngabe record={record} admin={isAdmin} branches={branches} pending={assign.isPending} onAssign={assignBranch} />
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => handleEdit(record)}
                                    aria-label="Zeitkorrektur beantragen"
                                  >
                                    <Pencil className="size-3" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {/* If no records at all on mobile */}
                    {emp.records.length === 0 && (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        Keine Erfassungen in diesem Monat
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}

      {/* Record form dialog */}
      <TimeRecordForm
        open={showRecordForm}
        onOpenChange={(open) => {
          setShowRecordForm(open);
          if (!open) setEditingRecord(null);
        }}
        record={editingRecord}
        employees={employeeOptions}
      />
    </div>
  );
}

function TimeListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}
