"use client";

import { BranchPicker } from "./branch-picker";
import { MonthGrid } from "./month-grid";

interface MonthGridWrapperProps {
  month: number;
  year: number;
  standort: string | null;
  offen?: boolean;
}

export function MonthGridWrapper({ month, year, standort, offen }: MonthGridWrapperProps) {
  if (!standort) {
    const monat = String(month).padStart(2, "0") + "-" + year;
    return <BranchPicker title="Monatsdienstplan" href={(id) => `/schedule/month/${monat}?standort=${id}`} />;
  }
  return <MonthGrid month={month} year={year} standort={standort} offen={offen} />;
}
