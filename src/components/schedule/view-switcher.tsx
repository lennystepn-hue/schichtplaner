"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, User, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { isoWeek, weekDate } from "@/lib/berlin";
import { formatKW } from "@/lib/utils/calendar";

interface ViewSwitcherProps {
  /** Aktuelle KW wie "09-2026" (Wochenansichten) */
  kw?: string;
  /** Aktueller Monat wie "03-2026" (Monatsansicht) */
  month?: string;
  /** Standort des Plans - Planung und Monat gelten je Standort. */
  standort?: string | null;
}

/** Monat "MM-YYYY" zur KW "WW-YYYY" (ueber den Donnerstag der ISO-Woche). */
function kwToMonth(kw: string): string {
  const match = kw.match(/^(\d{1,2})-(\d{4})$/);
  if (!match) return "";
  const thursday = weekDate(Number(match[2]), Number(match[1]), 4);
  return thursday.slice(5, 7) + "-" + thursday.slice(0, 4);
}

/** KW "WW-YYYY" zum Monat "MM-YYYY" (erste Woche des Monats). */
function monthToKw(month: string): string {
  const match = month.match(/^(\d{1,2})-(\d{4})$/);
  if (!match) return "";
  const w = isoWeek(match[2] + "-" + match[1].padStart(2, "0") + "-01");
  return formatKW(w.weekNumber, w.year);
}

export function ViewSwitcher({ kw, month, standort }: ViewSwitcherProps) {
  const pathname = usePathname();
  const effectiveKW = kw ?? (month ? monthToKw(month) : "");
  const effectiveMonth = month ?? (kw ? kwToMonth(kw) : "");
  const suffix = standort ? "?standort=" + encodeURIComponent(standort) : "";

  const views = [
    { key: "flexible", label: "Planung", icon: LayoutGrid, href: `/schedule/flexible/${effectiveKW}${suffix}` },
    { key: "employee", label: "Mitarbeiter", icon: User, href: `/schedule/employee/${effectiveKW}${suffix}` },
    { key: "month", label: "Monat", icon: CalendarDays, href: `/schedule/month/${effectiveMonth}${suffix}` },
  ];

  const activeView = pathname.includes("/schedule/employee")
    ? "employee"
    : pathname.includes("/schedule/month")
      ? "month"
      : "flexible";

  return (
    // Segmentschalter: eine Kante, innen nur Haarlinien.
    <div role="group" aria-label="Ansicht" className="flex items-center overflow-hidden rounded-[var(--radius)] border bg-card">
      {views.map((view) => {
        const isActive = activeView === view.key;
        const Icon = view.icon;
        return (
          <Link
            key={view.key}
            href={view.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-1.5 border-l px-3 text-[13px] font-medium transition-colors first:border-l-0",
              isActive ? "bg-[var(--flaeche-vertieft)] text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{view.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
