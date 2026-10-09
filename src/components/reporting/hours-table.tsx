"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Download,
  ArrowUpDown,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExportModal } from "./export-modal";
import { json, selectClass } from "@/components/workforce/client";

// ---------- Types ----------

type KWHeader = {
  weekNumber: number;
  label: string;
};

type KWData = {
  weekNumber: number;
  totalMinutes: number;
  shiftCount: number;
};

type EmployeeReport = {
  userId: string;
  firstName: string;
  lastName: string;
  profileImage: string | null;
  totalMinutes: number;
  plannedMinutes: number;
  /** Sollstunden: nur eigene und - fuer Admins - alle; nicht in der Standortansicht. */
  targetMinutes: number | null;
  deviationMinutes: number;
  shiftCount: number;
  kwBreakdown: KWData[];
};

type ReportingResponse = {
  month: number;
  year: number;
  kwHeaders: KWHeader[];
  employees: EmployeeReport[];
  totals: {
    totalMinutes: number;
    totalShifts: number;
  };
};

// ---------- Helpers ----------

const MONTH_NAMES = [
  "JANUAR",
  "FEBRUAR",
  "MAERZ",
  "APRIL",
  "MAI",
  "JUNI",
  "JULI",
  "AUGUST",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DEZEMBER",
];

const MONTH_NAMES_DISPLAY = [
  "Januar",
  "Februar",
  "Maerz",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function formatMinutes(totalMinutes: number): string {
  totalMinutes = Math.round(totalMinutes);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}H${m > 0 ? ` ${m}M` : ""}`;
}

function formatMinutesCompact(totalMinutes: number): string {
  totalMinutes = Math.round(totalMinutes);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (m === 0) return `${h}H`;
  return `${h}H${String(m).padStart(2, "0")}M`;
}

type BranchOption = { id: string; name: string; customer: { name: string } | null };

function stunden(minutes: number | null): string {
  return minutes === null ? "–" : (minutes / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " h";
}

type SortField = "name" | "total";
type SortDir = "asc" | "desc";

// ---------- Component ----------

interface HoursTableProps {
  month: number;
  year: number;
}

export function HoursTable({ month, year }: HoursTableProps) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showExport, setShowExport] = useState(false);
  // Standortfilter: nur Standorte mit "Zeiterfassung einsehen" (Admins: alle)
  const [standort, setStandort] = useState("");
  const { data: branchData } = useQuery({
    queryKey: ["branches", "VIEW_TIME"],
    queryFn: () => json<{ branches: BranchOption[] }>("/api/branches?right=VIEW_TIME"),
  });
  const branches = branchData?.branches ?? [];

  // Fetch reporting data
  const { data, isLoading, error } = useQuery<ReportingResponse>({
    queryKey: ["reporting", month, year, standort],
    queryFn: async () => {
      const res = await fetch(`/api/reporting?month=${month}&year=${year}${standort ? "&standort=" + encodeURIComponent(standort) : ""}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Auswertung");
      return res.json();
    },
  });

  const employees = data?.employees ?? [];
  const kwHeaders = data?.kwHeaders ?? [];
  const totals = data?.totals ?? { totalMinutes: 0, totalShifts: 0 };

  // Filter
  const filteredEmployees = useMemo(() => {
    let filtered = employees;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (emp) =>
          emp.firstName.toLowerCase().includes(q) ||
          emp.lastName.toLowerCase().includes(q)
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      if (sortField === "name") {
        const cmp = a.lastName.localeCompare(b.lastName);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = a.totalMinutes - b.totalMinutes;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return filtered;
  }, [employees, search, sortField, sortDir]);

  // KW totals
  const kwTotals = useMemo(() => {
    const map = new Map<number, { minutes: number; shifts: number }>();
    for (const kw of kwHeaders) {
      map.set(kw.weekNumber, { minutes: 0, shifts: 0 });
    }
    for (const emp of employees) {
      for (const kw of emp.kwBreakdown) {
        const existing = map.get(kw.weekNumber);
        if (existing) {
          existing.minutes += kw.totalMinutes;
          existing.shifts += kw.shiftCount;
        }
      }
    }
    return map;
  }, [employees, kwHeaders]);

  // Navigation
  const navigatePrev = useCallback(() => {
    let newMonth = month - 1;
    let newYear = year;
    if (newMonth < 1) {
      newMonth = 12;
      newYear--;
    }
    router.push(`/reporting/${newMonth}-${newYear}`);
  }, [month, year, router]);

  const navigateNext = useCallback(() => {
    let newMonth = month + 1;
    let newYear = year;
    if (newMonth > 12) {
      newMonth = 1;
      newYear++;
    }
    router.push(`/reporting/${newMonth}-${newYear}`);
  }, [month, year, router]);

  // Sort toggle
  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  // Get KW value for an employee
  function getKWMinutes(emp: EmployeeReport, weekNumber: number): number {
    const kw = emp.kwBreakdown.find((k) => k.weekNumber === weekNumber);
    return kw?.totalMinutes ?? 0;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Auswertung</h1>
          <p className="text-sm text-muted-foreground">
            Monatliche Stundenauswertung und Export
          </p>
        </div>
        <Button size="sm" onClick={() => setShowExport(true)}>
          <Download className="size-4" />
          Export
        </Button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={navigatePrev}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-lg font-semibold min-w-[200px] text-center">
            {MONTH_NAMES_DISPLAY[month - 1]} {year}
          </span>
          <Button variant="outline" size="icon-sm" onClick={navigateNext}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Summary header */}
      {!isLoading && !error && (
        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-wide">
                {MONTH_NAMES[month - 1]} {year}
              </span>
              <span className="text-muted-foreground">|</span>
              <span className="text-base font-semibold tabular-nums">
                {formatMinutes(totals.totalMinutes)}
              </span>
              <span className="text-sm text-muted-foreground">
                ({totals.totalShifts} Schichten)
              </span>
            </div>

            {/* KW summary badges */}
            <div className="flex flex-wrap gap-2">
              {kwHeaders.map((kw) => {
                const kwData = kwTotals.get(kw.weekNumber);
                const minutes = kwData?.minutes ?? 0;
                return (
                  <Badge
                    key={kw.weekNumber}
                    variant="secondary"
                    className="tabular text-xs cursor-default"
                  >
                    {kw.label} {formatMinutesCompact(minutes)}
                  </Badge>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Search + Standort */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mitarbeiter suchen..."
            className="pl-9"
          />
        </div>
        {branches.length > 0 && (
          <label className="flex items-center gap-2 text-sm sm:ml-auto">
            <span className="shrink-0 text-muted-foreground">Standort</span>
            <select className={cn(selectClass, "sm:w-64")} value={standort} onChange={(e) => setStandort(e.target.value)}>
              <option value="">Alle freigegebenen Standorte</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}{b.customer ? " · " + b.customer.name : ""}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {standort && (
        <p className="text-xs text-muted-foreground">Nur Zeiten und Schichten an diesem Standort. Sollstunden gelten standortübergreifend und sind hier ausgeblendet.</p>
      )}

      {/* Loading */}
      {isLoading && <ReportingSkeleton />}

      {/* Error */}
      {error && (
        <Card className="p-6 text-center text-destructive">
          Fehler beim Laden der Auswertung. Bitte versuche es erneut.
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !error && employees.length === 0 && (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <BarChart3 className="size-12 text-muted-foreground/50 mb-3" />
          <p className="text-lg font-medium">Keine Daten</p>
          <p className="text-sm text-muted-foreground mt-1">
            Fuer diesen Monat sind noch keine Zeiterfassungen vorhanden.
          </p>
        </Card>
      )}

      {/* Table */}
      {!isLoading && !error && employees.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="flex items-center gap-1 font-semibold hover:text-foreground transition-colors"
                    >
                      NAME
                      <ArrowUpDown
                        className={cn(
                          "size-3",
                          sortField === "name"
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                      />
                    </button>
                  </TableHead>
                  {kwHeaders.map((kw) => (
                    <TableHead
                      key={kw.weekNumber}
                      className="text-center min-w-[80px] font-semibold"
                    >
                      {kw.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right min-w-[100px]">
                    <button
                      type="button"
                      onClick={() => toggleSort("total")}
                      className="flex items-center gap-1 font-semibold hover:text-foreground transition-colors ml-auto"
                    >
                      GESAMT
                      <ArrowUpDown
                        className={cn(
                          "size-3",
                          sortField === "total"
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                      />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">Plan</TableHead>
                  <TableHead className="text-right">Soll</TableHead>
                  <TableHead className="text-right">Ist − Plan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((emp) => (
                  <TableRow key={emp.userId}>
                    <TableCell className="font-medium">
                      {emp.lastName}, {emp.firstName}
                    </TableCell>
                    {kwHeaders.map((kw) => {
                      const minutes = getKWMinutes(emp, kw.weekNumber);
                      return (
                        <TableCell
                          key={kw.weekNumber}
                          className="text-center tabular text-sm"
                        >
                          {minutes > 0 ? (
                            <span className="text-foreground">
                              {formatMinutesCompact(minutes)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">-</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right tabular text-sm font-semibold">
                      {emp.totalMinutes > 0
                        ? formatMinutesCompact(emp.totalMinutes)
                        : "-"}
                    </TableCell>
                    <TableCell className="tabular text-right">{stunden(emp.plannedMinutes)}</TableCell>
                    <TableCell className="tabular text-right">{stunden(emp.targetMinutes)}</TableCell>
                    <TableCell className="tabular text-right">{stunden(emp.deviationMinutes)}</TableCell>
                  </TableRow>
                ))}

                {/* Totals row */}
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell>Gesamt</TableCell>
                  {kwHeaders.map((kw) => {
                    const kwData = kwTotals.get(kw.weekNumber);
                    const minutes = kwData?.minutes ?? 0;
                    return (
                      <TableCell
                        key={kw.weekNumber}
                        className="text-center tabular text-sm"
                      >
                        {minutes > 0 ? formatMinutesCompact(minutes) : "-"}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right tabular text-sm">
                    {formatMinutesCompact(totals.totalMinutes)}
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* No results from search */}
      {!isLoading &&
        !error &&
        employees.length > 0 &&
        filteredEmployees.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            Keine Mitarbeiter gefunden fuer &quot;{search}&quot;
          </p>
        )}

      {/* Export modal */}
      <ExportModal
        open={showExport}
        onOpenChange={setShowExport}
        defaultMonth={month}
        defaultYear={year}
        standort={standort || null}
      />
    </div>
  );
}

function ReportingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-16 w-full rounded-lg" />
      <Card className="overflow-hidden">
        <div className="p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20 ml-auto" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
