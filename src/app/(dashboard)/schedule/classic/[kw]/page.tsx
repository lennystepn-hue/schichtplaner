import { redirect } from "next/navigation";
import {
  parseKW,
  getCurrentKW,
  formatKW,
  getWeekDates,
} from "@/lib/utils/calendar";
import { WeekNav } from "@/components/schedule/week-nav";
import { ViewSwitcher } from "@/components/schedule/view-switcher";
import { ClassicGridWrapper } from "@/components/schedule/classic-grid-wrapper";

interface ClassicKWPageProps {
  params: Promise<{ kw: string }>;
  searchParams: Promise<{ standort?: string }>;
}

export default async function ClassicKWPage({ params, searchParams }: ClassicKWPageProps) {
  const { kw } = await params;
  // Mit Standort: nur dieser Plan; ohne: eigene Schichten und freigegebene Plaene.
  const { standort } = await searchParams;
  const parsed = parseKW(kw);

  if (!parsed) {
    const current = getCurrentKW();
    redirect(`/schedule/classic/${formatKW(current.weekNumber, current.year)}${standort ? "?standort=" + encodeURIComponent(standort) : ""}`);
  }

  const { weekNumber, year } = parsed;
  const weekDates = getWeekDates(weekNumber, year);
  const weekDateStrings = weekDates.map((d) => d.toISOString());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <ViewSwitcher kw={kw} standort={standort ?? null} />
      </div>
      <WeekNav weekNumber={weekNumber} year={year} baseUrl="/schedule/classic" standort={standort ?? null} />
      <ClassicGridWrapper
        weekNumber={weekNumber}
        year={year}
        weekDateStrings={weekDateStrings}
        standort={standort ?? null}
      />
    </div>
  );
}
