import { redirect } from "next/navigation";
import { getCurrentKW, formatKW } from "@/lib/utils/calendar";

export default async function ScheduleFlexiblePage({ searchParams }: { searchParams: Promise<{ standort?: string }> }) {
  const { standort } = await searchParams;
  const { weekNumber, year } = getCurrentKW();
  redirect(`/schedule/flexible/${formatKW(weekNumber, year)}${standort ? "?standort=" + encodeURIComponent(standort) : ""}`);
}
