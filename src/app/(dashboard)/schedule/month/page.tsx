import { redirect } from "next/navigation";
import { berlinDate } from "@/lib/berlin";

export default async function ScheduleMonthPage({ searchParams }: { searchParams: Promise<{ standort?: string }> }) {
  const { standort } = await searchParams;
  const today = berlinDate();
  redirect(`/schedule/month/${today.slice(5, 7)}-${today.slice(0, 4)}${standort ? "?standort=" + encodeURIComponent(standort) : ""}`);
}
