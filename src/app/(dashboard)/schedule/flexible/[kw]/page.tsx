import { redirect } from "next/navigation";
import {
  parseKW,
  getCurrentKW,
  formatKW,
  getWeekDates,
} from "@/lib/utils/calendar";
import { ScheduleGridWrapper } from "@/components/schedule/schedule-grid-wrapper";

interface ScheduleKWPageProps {
  params: Promise<{ kw: string }>;
  searchParams: Promise<{ standort?: string }>;
}

/** Wochenplan eines Standorts (?standort=ID); ohne Standort die Auswahl. */
export default async function ScheduleKWPage({ params, searchParams }: ScheduleKWPageProps) {
  const { kw } = await params;
  const { standort } = await searchParams;
  const parsed = parseKW(kw);

  if (!parsed) {
    const current = getCurrentKW();
    redirect(`/schedule/flexible/${formatKW(current.weekNumber, current.year)}${standort ? "?standort=" + encodeURIComponent(standort) : ""}`);
  }

  const { weekNumber, year } = parsed;
  const weekDateStrings = getWeekDates(weekNumber, year).map((d) => d.toISOString());

  return (
    <div>
      {/* Kopfleiste, Status und Werkzeuge stecken in der Rasterkomponente. */}
      <ScheduleGridWrapper weekNumber={weekNumber} year={year} weekDateStrings={weekDateStrings} standort={standort ?? null} />
    </div>
  );
}
