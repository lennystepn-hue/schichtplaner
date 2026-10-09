"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { isToday } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { dayNames, formatDateShort } from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";
import type { ScheduleData, ShiftData } from "@/types/schedule";

interface ClassicGridProps {
  weekNumber: number;
  year: number;
  weekDates: Date[];
  /** Standort des Plans; ohne Angabe die zusammengefuehrte Sicht. */
  standort?: string | null;
}

/**
 * Traditional table-style schedule layout.
 * Rows = time-based shift groups, Columns = Mo-So.
 * Each cell shows booked employees for that shift on that day.
 */
export function ClassicGrid({ weekNumber, year, weekDates, standort }: ClassicGridProps) {
  const { data, isLoading } = useQuery<{ schedule: ScheduleData }>({
    queryKey: ["schedule", weekNumber, year, standort ?? "alle"],
    queryFn: async () => {
      const res = await fetch(`/api/schedules?kw=${weekNumber}&year=${year}${standort ? "&standort=" + encodeURIComponent(standort) : ""}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Schichten");
      return res.json();
    },
  });

  const schedule = data?.schedule ?? null;
  const shifts = schedule?.shifts ?? [];

  // Group shifts into unique time slots (shiftFrom-shiftTo)
  const { timeSlots, grid } = useMemo(() => {
    // Zeilen je Zeitfenster; in der zusammengefuehrten Sicht zusaetzlich je Standort.
    const slotOf = (s: ShiftData) => `${s.shiftFrom}-${s.shiftTo}${standort ? "" : "|" + (s.branch?.id ?? "")}`;
    // Collect unique time slots
    const slotMap = new Map<
      string,
      { from: string; to: string; divisionColor: string; divisionTitle: string; branchName: string }
    >();
    for (const shift of shifts) {
      const key = slotOf(shift);
      if (!slotMap.has(key)) {
        slotMap.set(key, {
          from: shift.shiftFrom,
          to: shift.shiftTo,
          divisionColor: shift.division?.color ?? "#94a3b8",
          divisionTitle: shift.division?.title ?? "",
          branchName: standort ? "" : shift.branch?.name ?? "",
        });
      }
    }

    // Sort by start time
    const sortedSlots = Array.from(slotMap.entries()).sort(([, a], [, b]) =>
      a.from.localeCompare(b.from) || a.branchName.localeCompare(b.branchName, "de")
    );

    // Build grid: for each slot+day, find matching shifts
    const gridData: Record<string, ShiftData[]> = {};
    for (const [key] of sortedSlots) {
      for (let day = 1; day <= 7; day++) {
        const cellKey = `${key}:${day}`;
        gridData[cellKey] = shifts.filter((s) => slotOf(s) === key && s.dayOfWeek === day);
      }
    }

    return {
      timeSlots: sortedSlots.map(([key, val]) => ({ key, ...val })),
      grid: gridData,
    };
  }, [shifts, standort]);

  if (isLoading) {
    return <ClassicGridSkeleton />;
  }

  if (timeSlots.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Keine Schichten in dieser Woche
      </div>
    );
  }

  return (
    <div className="akro-panel overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="akro-panel-kopf">
            <th className="border-r px-3 py-2 text-left text-xs font-semibold text-muted-foreground w-32">
              Schicht
            </th>
            {weekDates.map((date, idx) => {
              const today = isToday(date);
              return (
                <th
                  key={idx}
                  className={cn(
                    "border-r last:border-r-0 px-3 py-2 text-center text-xs font-semibold min-w-[120px]",
                    today && "bg-[var(--flaeche-heute)] text-primary"
                  )}
                >
                  <div>{dayNames[idx]}</div>
                  <div className="text-[10px] text-muted-foreground font-normal">
                    {formatDateShort(date)}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {timeSlots.map((slot) => (
            <tr key={slot.key} className="border-t hover:bg-muted/10 transition-colors">
              {/* Time slot label */}
              <td className="border-r px-3 py-2 align-top">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: slot.divisionColor }}
                  />
                  <div>
                    <div className="text-xs font-medium">
                      {slot.from} - {slot.to}
                    </div>
                    {slot.branchName && (
                      <div className="text-[10px] text-muted-foreground truncate max-w-[100px]">{slot.branchName}</div>
                    )}
                    {slot.divisionTitle && (
                      <div
                        className="text-[10px] truncate max-w-[100px]"
                        style={{ color: slot.divisionColor }}
                      >
                        {slot.divisionTitle}
                      </div>
                    )}
                  </div>
                </div>
              </td>

              {/* Day cells */}
              {Array.from({ length: 7 }, (_, dayIdx) => {
                const day = dayIdx + 1;
                const cellKey = `${slot.key}:${day}`;
                const cellShifts = grid[cellKey] ?? [];
                const today = isToday(weekDates[dayIdx]);

                return (
                  <td
                    key={day}
                    className={cn(
                      "border-r last:border-r-0 px-2 py-1.5 align-top min-w-[120px]",
                      today && "bg-primary/[0.03]"
                    )}
                  >
                    {cellShifts.length === 0 ? (
                      <span className="text-[10px] text-muted-foreground/40">--</span>
                    ) : (
                      <div className="space-y-0.5">
                        {cellShifts.flatMap((shift) =>
                          shift.bookings.length > 0 ? (
                            shift.bookings.map((booking) => (
                              <div
                                key={booking.id}
                                className="text-[11px] truncate"
                              >
                                {booking.user.firstName} {booking.user.lastName}
                              </div>
                            ))
                          ) : (
                            <div key={shift.id} className="text-[10px] text-muted-foreground italic">
                              <Badge variant="secondary" className="text-[9px] px-1 py-0">
                                {shift.bookings.length}/{shift.maxEmployees}
                              </Badge>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassicGridSkeleton() {
  return (
    <div className="akro-panel overflow-hidden">
      <div className="akro-panel-kopf px-3 py-2 flex gap-4">
        <Skeleton className="h-4 w-20" />
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-16" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="border-t px-3 py-2 flex gap-4">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 7 }).map((_, j) => (
            <Skeleton key={j} className="h-8 w-16" />
          ))}
        </div>
      ))}
    </div>
  );
}
