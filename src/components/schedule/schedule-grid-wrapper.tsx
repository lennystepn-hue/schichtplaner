"use client";

import { useMemo } from "react";
import { formatKW } from "@/lib/utils/calendar";
import { BranchPicker } from "./branch-picker";
import { ScheduleGrid } from "./schedule-grid";

interface ScheduleGridWrapperProps {
  weekNumber: number;
  year: number;
  /** ISO date strings for each day Mon-Sun */
  weekDateStrings: string[];
  /** Standort des Wochenplans; ohne Standort wird zuerst einer gewaehlt. */
  standort: string | null;
}

/**
 * Wrapper component that converts serialized date strings
 * back to Date objects for the ScheduleGrid.
 */
export function ScheduleGridWrapper({ weekNumber, year, weekDateStrings, standort }: ScheduleGridWrapperProps) {
  const weekDates = useMemo(() => weekDateStrings.map((s) => new Date(s)), [weekDateStrings]);
  if (!standort) {
    return <BranchPicker title="Wochenplan" href={(id) => `/schedule/flexible/${formatKW(weekNumber, year)}?standort=${id}`} />;
  }
  return <ScheduleGrid weekNumber={weekNumber} year={year} weekDates={weekDates} standort={standort} />;
}
