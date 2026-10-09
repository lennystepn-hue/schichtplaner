"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isToday,
  isSameDay,
  isWeekend,
  eachMonthOfInterval,
  startOfYear,
  endOfYear,
} from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AbsenceForm } from "./absence-form";
import type { AbsenceData, AbsenceCategory } from "./absence-form";

// ---------- Types ----------

type Holiday = {
  id: string;
  name: string;
  date: string;
};

type CalendarAbsence = AbsenceData;

type AbsencesResponse = {
  absences: CalendarAbsence[];
  counts: {
    all: number;
    pending: number;
    approved: number;
    declined: number;
  };
};

type HolidaysResponse = {
  holidays: Holiday[];
};

type CategoriesResponse = {
  categories: AbsenceCategory[];
};

// ---------- Helpers ----------

function getAbsenceForDate(
  absences: CalendarAbsence[],
  date: Date
): CalendarAbsence | undefined {
  return absences.find((a) => {
    const from = new Date(a.dateFrom);
    const to = new Date(a.dateTo);
    // Reset time part for comparison
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    return d >= from && d <= to;
  });
}

function isHoliday(holidays: Holiday[], date: Date): Holiday | undefined {
  return holidays.find((h) => {
    const hDate = new Date(h.date);
    return isSameDay(hDate, date);
  });
}

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

const DAY_NAMES_MIN = ["M", "D", "M", "D", "F", "S", "S"];

// ---------- Component ----------

export function AbsenceCalendar() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [selectedDateFrom, setSelectedDateFrom] = useState<string>("");
  const [selectedDateTo, setSelectedDateTo] = useState<string>("");
  const [editingAbsence, setEditingAbsence] = useState<AbsenceData | null>(null);

  // Fetch absences for the year
  const { data: absencesData, isLoading: absencesLoading } = useQuery<AbsencesResponse>({
    queryKey: ["absences", "year", year],
    queryFn: async () => {
      const res = await fetch(`/api/absences?year=${year}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Abwesenheiten");
      return res.json();
    },
  });

  // Fetch holidays for the year
  const { data: holidaysData } = useQuery<HolidaysResponse>({
    queryKey: ["holidays", year],
    queryFn: async () => {
      const res = await fetch(`/api/holidays?year=${year}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Feiertage");
      return res.json();
    },
  });

  // Fetch categories for the legend
  const { data: categoriesData } = useQuery<CategoriesResponse>({
    queryKey: ["absence-categories"],
    queryFn: async () => {
      const res = await fetch("/api/absences/categories");
      if (!res.ok) throw new Error("Fehler");
      return res.json();
    },
  });

  const absences = absencesData?.absences ?? [];
  const holidays = holidaysData?.holidays ?? [];
  const categories = categoriesData?.categories ?? [];

  // All 12 months
  const months = useMemo(() => {
    const yearStart = startOfYear(new Date(year, 0, 1));
    const yearEnd = endOfYear(new Date(year, 0, 1));
    return eachMonthOfInterval({ start: yearStart, end: yearEnd });
  }, [year]);

  const navigatePrev = useCallback(() => setYear((y) => y - 1), []);
  const navigateNext = useCallback(() => setYear((y) => y + 1), []);
  const navigateToday = useCallback(() => setYear(new Date().getFullYear()), []);

  function handleDayClick(date: Date) {
    // Check if there is an absence on this day
    const absence = getAbsenceForDate(absences, date);
    if (absence) {
      setEditingAbsence(absence);
      setSelectedDateFrom("");
      setSelectedDateTo("");
      setShowForm(true);
      return;
    }

    // Otherwise create a new absence starting on this day
    const dateStr = format(date, "yyyy-MM-dd");
    setEditingAbsence(null);
    setSelectedDateFrom(dateStr);
    setSelectedDateTo(dateStr);
    setShowForm(true);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Year navigation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" onClick={navigatePrev}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-lg font-semibold min-w-[80px] text-center tabular-nums">
              {year}
            </span>
            <Button variant="outline" size="icon-sm" onClick={navigateNext}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          {year !== new Date().getFullYear() && (
            <Button variant="ghost" size="sm" onClick={navigateToday}>
              Heute
            </Button>
          )}
        </div>

        {/* Loading */}
        {absencesLoading && <CalendarSkeleton />}

        {/* Calendar grid: 12 months */}
        {!absencesLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {months.map((monthDate) => (
              <MonthGrid
                key={monthDate.toISOString()}
                monthDate={monthDate}
                absences={absences}
                holidays={holidays}
                onDayClick={handleDayClick}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        {categories.length > 0 && (
          <Card className="p-4">
            <h3 className="text-sm font-medium mb-2">Legende</h3>
            <div className="flex flex-wrap gap-4">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-2">
                  <span
                    className="size-3 rounded-sm shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-sm">{cat.name}</span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-sm shrink-0 bg-gradient-to-r from-yellow-200 to-yellow-300 border border-warn/40 border-dashed" />
                <span className="text-sm text-muted-foreground">
                  Ausstehend (gestreift)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-sm shrink-0 bg-destructive/10 dark:bg-destructive/20 border border-destructive/40">
                  <span className="block w-full h-px bg-destructive mt-1.5" />
                </span>
                <span className="text-sm text-muted-foreground">
                  Abgelehnt (durchgestrichen)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-sm shrink-0 bg-accent border border-blue-300" />
                <span className="text-sm text-muted-foreground">Feiertag</span>
              </div>
            </div>
          </Card>
        )}

        {/* Absence form dialog */}
        <AbsenceForm
          open={showForm}
          onOpenChange={(open) => {
            setShowForm(open);
            if (!open) {
              setEditingAbsence(null);
              setSelectedDateFrom("");
              setSelectedDateTo("");
            }
          }}
          absence={editingAbsence}
          defaultDateFrom={selectedDateFrom}
          defaultDateTo={selectedDateTo}
        />
      </div>
    </TooltipProvider>
  );
}

// ---------- MonthGrid ----------

function MonthGrid({
  monthDate,
  absences,
  holidays,
  onDayClick,
}: {
  monthDate: Date;
  absences: CalendarAbsence[];
  holidays: Holiday[];
  onDayClick: (date: Date) => void;
}) {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get first day offset (Mon=0, Sun=6)
  const firstDayOfWeek = getDay(monthStart);
  // getDay: 0=Sun, 1=Mon, ..., 6=Sat
  // We want Mon=0, so: (firstDayOfWeek + 6) % 7
  const offset = (firstDayOfWeek + 6) % 7;

  const monthLabel = format(monthDate, "MMMM", { locale: de });

  return (
    <Card className="p-3">
      <h4 className="text-sm font-semibold text-center mb-2 capitalize">
        {monthLabel}
      </h4>
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAY_NAMES_MIN.map((name, i) => (
          <div
            key={i}
            className={cn(
              "text-center text-[10px] font-medium",
              i >= 5 ? "text-muted-foreground/60" : "text-muted-foreground"
            )}
          >
            {name}
          </div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {/* Empty cells for offset */}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" />
        ))}
        {/* Actual days */}
        {days.map((day) => (
          <DayCell
            key={day.toISOString()}
            date={day}
            absences={absences}
            holidays={holidays}
            onClick={() => onDayClick(day)}
          />
        ))}
      </div>
    </Card>
  );
}

// ---------- DayCell ----------

function DayCell({
  date,
  absences,
  holidays,
  onClick,
}: {
  date: Date;
  absences: CalendarAbsence[];
  holidays: Holiday[];
  onClick: () => void;
}) {
  const today = isToday(date);
  const weekend = isWeekend(date);
  const absence = getAbsenceForDate(absences, date);
  const holiday = isHoliday(holidays, date);
  const dayNum = date.getDate();

  // Determine cell style
  let bgColor = "";
  let borderStyle = "";
  let textDecoration = "";
  let tooltipText = "";

  if (absence) {
    const color = absence.category.color;
    if (absence.status === "APPROVED") {
      bgColor = color;
      tooltipText = `${absence.user.lastName}: ${absence.category.name} (Genehmigt)`;
    } else if (absence.status === "PENDING") {
      // Striped/dashed pattern for pending
      bgColor = color + "60"; // with opacity
      borderStyle = "border-dashed border";
      tooltipText = `${absence.user.lastName}: ${absence.category.name} (Ausstehend)`;
    } else if (absence.status === "DECLINED") {
      bgColor = color + "30"; // very transparent
      textDecoration = "line-through";
      tooltipText = `${absence.user.lastName}: ${absence.category.name} (Abgelehnt)`;
    }
  } else if (holiday) {
    tooltipText = holiday.name;
  }

  const cellContent = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "aspect-square flex items-center justify-center rounded-sm text-[11px] tabular-nums transition-colors cursor-pointer",
        "hover:ring-1 hover:ring-primary/50",
        weekend && !absence && !holiday && "text-muted-foreground/50",
        today && "font-bold ring-1 ring-primary",
        holiday && !absence && "bg-accent text-[var(--brand)] dark:text-[var(--brand)]",
        borderStyle
      )}
      style={{
        backgroundColor: bgColor || undefined,
        color: absence?.status === "APPROVED"
          ? getContrastColor(absence.category.color)
          : undefined,
        textDecoration: textDecoration || undefined,
      }}
    >
      {dayNum}
      {holiday && !absence && (
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 size-1 rounded-full bg-blue-500" />
      )}
    </button>
  );

  if (tooltipText) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative">{cellContent}</div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    );
  }

  return <div className="relative">{cellContent}</div>;
}

// ---------- Utils ----------

function getContrastColor(hexColor: string): string {
  // Remove #
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

// ---------- Skeleton ----------

function CalendarSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <Card key={i} className="p-3">
          <Skeleton className="h-5 w-24 mx-auto mb-2" />
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: 35 }).map((_, j) => (
              <Skeleton key={j} className="aspect-square rounded-sm" />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
