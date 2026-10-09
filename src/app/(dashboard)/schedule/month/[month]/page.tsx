import { redirect } from "next/navigation";
import { ViewSwitcher } from "@/components/schedule/view-switcher";
import { MonthGridWrapper } from "@/components/schedule/month-grid-wrapper";

interface MonthPageProps {
  params: Promise<{ month: string }>;
  searchParams: Promise<{ standort?: string; offen?: string }>;
}

function parseMonth(str: string): { month: number; year: number } | null {
  const match = str.match(/^(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  const month = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  return { month, year };
}

/** Monatsdienstplan eines Standorts; ohne Standort die Auswahl der freigegebenen Standorte. */
export default async function MonthViewPage({ params, searchParams }: MonthPageProps) {
  const { month: monthParam } = await params;
  const { standort, offen } = await searchParams;
  const parsed = parseMonth(monthParam);

  if (!parsed) {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    redirect(`/schedule/month/${m}-${now.getFullYear()}${standort ? "?standort=" + encodeURIComponent(standort) : ""}`);
  }

  return (
    <div className="space-y-6">
      {standort && (
        <div className="flex items-center justify-end">
          <ViewSwitcher month={monthParam} standort={standort} />
        </div>
      )}
      <MonthGridWrapper month={parsed.month} year={parsed.year} standort={standort ?? null} offen={offen === "1"} />
    </div>
  );
}
