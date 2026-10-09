"use client";

import { useMemo } from "react";
import { EmployeeGrid } from "./employee-grid";

interface EmployeeGridWrapperProps {
  weekNumber: number;
  year: number;
  weekDateStrings: string[];
  standort?: string | null;
}

export function EmployeeGridWrapper({
  weekNumber,
  year,
  weekDateStrings,
  standort = null,
}: EmployeeGridWrapperProps) {
  const weekDates = useMemo(
    () => weekDateStrings.map((s) => new Date(s)),
    [weekDateStrings]
  );

  return (
    <EmployeeGrid
      weekNumber={weekNumber}
      year={year}
      weekDates={weekDates}
      standort={standort}
    />
  );
}
