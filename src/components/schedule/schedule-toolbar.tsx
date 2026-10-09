"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getISOWeek } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Download, MoreHorizontal, Plus, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { weekDate } from "@/lib/berlin";
import { formatDateShort, formatKW, getCurrentKW, getWeekDates } from "@/lib/utils/calendar";
import type { ScheduleAccess, ScheduleData, ScheduleResponse } from "@/types/schedule";
import { AISuggestButton } from "./ai-suggest-button";
import { LiveMode } from "./live-mode";
import { BriefingButton, DivisionFilter, OptionsMenu, VisibilityToggle } from "./schedule-options";
import { ViewSwitcher } from "./view-switcher";
import { WishFilterToggle } from "./wish-plan";

interface ScheduleToolbarProps {
  weekNumber: number;
  year: number;
  standort: string;
  schedule: ScheduleData | null;
  branch: ScheduleResponse["branch"];
  access?: ScheduleAccess;
  isAdmin: boolean;
  divisionFilter: string | null;
  onDivisionFilterChange: (divisionId: string | null) => void;
  wishFilterEnabled: boolean;
  onWishFilterChange: (enabled: boolean) => void;
  openWishCount: number;
  /** Nur gesetzt, wenn neue Schichten an diesem Standort erlaubt sind. */
  onAddShift?: () => void;
}

/** Letzte ISO-Woche eines Jahres; der 28.12. liegt immer darin. */
function maxISOWeek(year: number): number {
  return getISOWeek(new Date(year, 11, 28));
}

/** Eine Kennzahl der Woche. Farbe steht nie allein - jede Angabe traegt ihre Beschriftung. */
function Kennwert({ zahl, label, warnung }: { zahl: number; label: string; warnung?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5 px-3 first:pl-0">
      <span className={cn("akro-kennzahl text-[15px]", warnung && zahl > 0 ? "text-destructive" : "text-foreground")}>{zahl}</span>
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * Kopf des Wochenplans eines Standorts: Standort, Woche und Ansicht in der
 * ersten Zeile, Lage der Woche und Werkzeuge in der zweiten. Werkzeuge
 * erscheinen nur mit dem passenden Recht - geprueft wird trotzdem auf dem Server.
 */
export function ScheduleToolbar({
  weekNumber,
  year,
  standort,
  schedule,
  branch,
  access,
  isAdmin,
  divisionFilter,
  onDivisionFilterChange,
  wishFilterEnabled,
  onWishFilterChange,
  openWishCount,
  onAddShift,
}: ScheduleToolbarProps) {
  const router = useRouter();
  const current = getCurrentKW();
  const weekDates = getWeekDates(weekNumber, year);
  const istAktuelleWoche = weekNumber === current.weekNumber && year === current.year;
  const suffix = "?standort=" + encodeURIComponent(standort);

  function geheZu(kw: number, kwYear: number) {
    router.push(`/schedule/flexible/${formatKW(kw, kwYear)}${suffix}`);
  }
  function zurueck() {
    if (weekNumber - 1 < 1) geheZu(maxISOWeek(year - 1), year - 1);
    else geheZu(weekNumber - 1, year);
  }
  function vor() {
    if (weekNumber + 1 > maxISOWeek(year)) geheZu(1, year + 1);
    else geheZu(weekNumber + 1, year);
  }

  const shifts = schedule?.shifts ?? [];
  const offenePlätze = shifts.reduce((summe, shift) => summe + (shift.missing ?? Math.max(0, shift.maxEmployees - (shift.occupiedCount ?? shift.bookings.length))), 0);
  const fehlendeBestätigungen = shifts.reduce((summe, shift) => summe + shift.bookings.filter((b) => !b.confirmedAt).length, 0);
  const thursday = weekDate(year, weekNumber, 4);
  const monat = thursday.slice(5, 7) + "-" + thursday.slice(0, 4);

  return (
    <div className="sticky top-[var(--kopf-hoehe)] z-20 -mx-4 mb-4 border-b bg-background px-4 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
      {/* Zeile 1: Standort, Woche und Ansicht */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 pb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center overflow-hidden rounded-[var(--radius)] border bg-card">
            <button type="button" onClick={zurueck} aria-label="Vorherige Woche" className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <ChevronLeft className="size-4" />
            </button>
            <span className="h-8 w-px bg-border" aria-hidden="true" />
            <button type="button" onClick={vor} aria-label="Nächste Woche" className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="min-w-0">
            <p className="akro-label truncate">
              {standort === "ohne" ? "Altbestand" : (branch?.customer?.name ?? "Ohne Kunde") + " · " + (branch?.name ?? "")}
            </p>
            <h1 className="akro-kennzahl text-[21px] leading-none">
              KW {String(weekNumber).padStart(2, "0")}
              <span className="ml-2 text-[13px] font-normal tracking-normal text-muted-foreground">
                {formatDateShort(weekDates[0])}.–{formatDateShort(weekDates[6])}.{year}
              </span>
            </h1>
          </div>

          {!istAktuelleWoche && (
            <Button variant="outline" size="sm" onClick={() => geheZu(current.weekNumber, current.year)}>Heute</Button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {standort !== "ohne" && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/schedule/month/${monat}${suffix}`}>
                <CalendarDays className="size-3.5" />
                Monat
              </Link>
            </Button>
          )}
          <ViewSwitcher kw={formatKW(weekNumber, year)} standort={standort} />
        </div>
      </div>

      {/* Zeile 2: Lage der Woche links, Werkzeuge rechts */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-2.5">
        <div className="flex flex-wrap items-center divide-x divide-border">
          <span className="flex items-center gap-1.5 pr-3 text-[12.5px] font-medium">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", schedule?.isPublic ? "bg-[var(--service)]" : "bg-muted-foreground")} />
            {schedule?.isPublic ? "Veröffentlicht" : "Entwurf"}
          </span>
          <Kennwert zahl={shifts.length} label="Schichten" />
          <Kennwert zahl={offenePlätze} label="unbesetzt" warnung />
          {access?.planner && <Kennwert zahl={fehlendeBestätigungen} label="unbestätigt" />}
          {openWishCount > 0 && <Kennwert zahl={openWishCount} label="Anfragen" />}
        </div>

        {schedule?.id && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DivisionFilter scheduleId={schedule.id} divisionFilter={divisionFilter} onDivisionFilterChange={onDivisionFilterChange} />
            {access?.handleRequests && <WishFilterToggle enabled={wishFilterEnabled} onToggle={onWishFilterChange} wishCount={openWishCount} />}
            {access?.publish && <VisibilityToggle scheduleId={schedule.id} isPublic={schedule.isPublic} />}
            {onAddShift && (
              <Button size="sm" className="gap-1.5" onClick={onAddShift}>
                <Plus className="size-3.5" />
                Schicht hinzufügen
              </Button>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Weitere Aktionen" title="Weitere Aktionen">
                  <MoreHorizontal className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-2 p-3">
                {access?.edit && (
                  <>
                    <p className="akro-label">Darstellung</p>
                    <OptionsMenu scheduleId={schedule.id} settingsLayout={schedule.settingsLayout} showTitle={schedule.showTitle} showPauses={schedule.showPauses} />
                  </>
                )}
                {/* Die klassische Tabelle ist eine Darstellungsvariante der Planung. */}
                <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" asChild>
                  <Link href={`/schedule/classic/${formatKW(weekNumber, year)}${suffix}`}>
                    <Table2 className="size-3.5" />
                    Klassische Tabelle
                  </Link>
                </Button>
                <p className="akro-label pt-1">Weitere Werkzeuge</p>
                <BriefingButton scheduleId={schedule.id} isManager={!!access?.edit} />
                {access?.edit && <LiveMode scheduleId={schedule.id} isManager />}
                {isAdmin && <AISuggestButton scheduleId={schedule.id} />}
                {access?.viewTime && standort !== "ohne" && (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" asChild>
                    <Link href={`/api/reporting/export?standort=${encodeURIComponent(standort)}`}>
                      <Download className="size-3.5" />
                      Stunden als CSV
                    </Link>
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
}
