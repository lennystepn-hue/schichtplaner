"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Moon, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorMessage, json } from "@/components/workforce/client";
import { berlinDate, isoWeek } from "@/lib/berlin";
import { dayNames, formatKW, monthNames } from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";
import type { ShiftData } from "@/types/schedule";
import { BranchIssues } from "./branch-issues";

type MonthDay = { date: string; weekday: number; isToday: boolean; shifts: ShiftData[]; continuations: ShiftData[]; missing: number };
type MonthPlan = {
  branch: { id: string; name: string; address: string | null; meetingPoint: string | null; isActive: boolean; customer: { id: string; name: string } | null };
  month: string;
  first: string;
  last: string;
  today: string;
  days: MonthDay[];
  weeks: { year: number; weekNumber: number; scheduleId: string | null; isPublic: boolean | null; shifts: number }[];
  totals: { shifts: number; missing: number; draftShifts: number };
  access: { planner: boolean; edit: boolean; publish: boolean; handleRequests: boolean; manageIssues: boolean; viewTime: boolean };
  issuesOpen: number | null;
};

/** "10-2026" <-> "2026-10" */
function toApiMonth(month: number, year: number) {
  return year + "-" + String(month).padStart(2, "0");
}
function monthPath(apiMonth: string, standort: string, offen = false) {
  const [y, m] = apiMonth.split("-");
  return `/schedule/month/${m}-${y}?standort=${standort}${offen ? "&offen=1" : ""}`;
}
function shiftMonth(apiMonth: string, offset: number) {
  const [y, m] = apiMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function weekHref(date: string, standort: string) {
  const w = isoWeek(date);
  return `/schedule/flexible/${formatKW(w.weekNumber, w.year)}?standort=${standort}`;
}
function names(shift: ShiftData) {
  return shift.bookings.map((b) => b.user.firstName + " " + b.user.lastName.charAt(0) + ".").join(", ");
}

/**
 * Monatsdienstplan eines Standorts. Tage und Zeiten gelten in Europe/Berlin;
 * Nachtschichten stehen an ihrem Beginn und reichen sichtbar in den
 * Folgetag. Fehlende Plaetze zaehlen wirksame Zuweisungen.
 */
export function MonthGrid({ month, year, standort, offen = false }: { month: number; year: number; standort: string; offen?: boolean }) {
  const apiMonth = toApiMonth(month, year);
  const [nurOffen, setNurOffen] = useState(offen);
  const query = useQuery({
    queryKey: ["branch-month", standort, apiMonth],
    queryFn: () => json<MonthPlan>(`/api/branches/${standort}/month?monat=${apiMonth}`),
  });
  const plan = query.data;

  const rows = useMemo(() => {
    if (!plan) return [];
    const cells: (MonthDay | null)[] = [...Array(plan.days[0].weekday - 1).fill(null), ...plan.days];
    while (cells.length % 7) cells.push(null);
    const result: (MonthDay | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) result.push(cells.slice(i, i + 7));
    return result;
  }, [plan]);

  if (query.error) return <ErrorMessage error={query.error} />;
  if (!plan) return <MonthSkeleton />;

  const heuteMonat = berlinDate().slice(0, 7);
  const sichtbar = (s: ShiftData) => !nurOffen || (s.missing ?? 0) > 0;
  const offeneTage = plan.days.filter((d) => d.missing > 0);

  return (
    <div className="space-y-5">
      {/* Kopf: Kunde, Standort, Monat */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="akro-label">{plan.branch.customer?.name ?? "Ohne Kunde"}</p>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.03em]">
            {plan.branch.name}
            {!plan.branch.isActive && <span className="ml-2 text-[13px] font-normal text-muted-foreground">(inaktiv)</span>}
          </h1>
          {plan.branch.address && <p className="text-[13px] text-muted-foreground">{plan.branch.address}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center overflow-hidden rounded-[var(--radius)] border bg-card">
            <Link href={monthPath(shiftMonth(apiMonth, -1), standort, nurOffen)} aria-label="Vorheriger Monat" className="flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground">
              <ChevronLeft className="size-4" />
            </Link>
            <span className="h-8 w-px bg-border" aria-hidden="true" />
            <span className="tabular px-3 text-[14px] font-semibold">{monthNames[month - 1]} {year}</span>
            <span className="h-8 w-px bg-border" aria-hidden="true" />
            <Link href={monthPath(shiftMonth(apiMonth, 1), standort, nurOffen)} aria-label="Nächster Monat" className="flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground">
              <ChevronRight className="size-4" />
            </Link>
          </div>
          {apiMonth !== heuteMonat && (
            <Button variant="outline" size="sm" asChild>
              <Link href={monthPath(heuteMonat, standort, nurOffen)}>Aktueller Monat</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href={weekHref(plan.days.find((d) => d.isToday)?.date ?? plan.first, standort)}>
              <CalendarRange className="size-3.5" />
              Wochenplan
            </Link>
          </Button>
        </div>
      </header>

      {/* Lage des Monats */}
      <div className="akro-panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-[13px]">
        <span><span className="akro-kennzahl text-[16px]">{plan.totals.shifts}</span> <span className="text-muted-foreground">Schichten</span></span>
        <span className={cn(plan.totals.missing > 0 && "text-destructive")}>
          {plan.totals.missing > 0 && <AlertTriangle className="mr-1 inline size-3.5 align-[-2px]" />}
          <span className="akro-kennzahl text-[16px]">{plan.totals.missing}</span> {plan.totals.missing === 1 ? "Platz offen" : "Plätze offen"}
        </span>
        {plan.access.planner && (
          <span><span className="akro-kennzahl text-[16px]">{plan.totals.draftShifts}</span> <span className="text-muted-foreground">im Entwurf</span></span>
        )}
        {plan.issuesOpen !== null && (
          <span><span className="akro-kennzahl text-[16px]">{plan.issuesOpen}</span> <span className="text-muted-foreground">{plan.issuesOpen === 1 ? "offene Meldung" : "offene Meldungen"}</span></span>
        )}
        <Button size="sm" variant={nurOffen ? "default" : "outline"} className="ml-auto" aria-pressed={nurOffen} onClick={() => setNurOffen((v) => !v)} disabled={!offeneTage.length && !nurOffen}>
          Nur offene Plätze
        </Button>
      </div>

      {plan.totals.shifts === 0 && !plan.days[0].continuations.length ? (
        <div className="akro-panel p-6 text-[14px] text-muted-foreground">
          {plan.access.planner ? "In diesem Monat sind keine Schichten geplant." : "Für diesen Monat ist noch kein Dienstplan veröffentlicht."}
          {plan.access.edit && plan.branch.isActive && (
            <> <Link className="font-medium text-primary underline-offset-4 hover:underline" href={weekHref(plan.first, standort)}>Im Wochenplan anlegen</Link></>
          )}
        </div>
      ) : nurOffen && !offeneTage.length ? (
        <div className="akro-panel p-6 text-[14px] text-muted-foreground">In diesem Monat sind alle Plätze besetzt.</div>
      ) : null}

      {/* Kalender ab Tablet */}
      <div className="akro-panel hidden overflow-hidden md:block">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] akro-panel-kopf border-b">
          <div className="px-2 py-2 text-[11px] font-semibold text-muted-foreground">KW</div>
          {dayNames.map((name) => (
            <div key={name} className="border-l px-2 py-2 text-[12px] font-semibold text-muted-foreground">{name}</div>
          ))}
        </div>
        {rows.map((row, index) => {
          const firstDate = row.find(Boolean)!.date;
          const w = isoWeek(firstDate);
          const week = plan.weeks.find((x) => x.year === w.year && x.weekNumber === w.weekNumber);
          return (
            <div key={index} className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-t first:border-t-0">
              <div className="px-2 py-2 text-[11px] leading-tight text-muted-foreground">
                <Link href={weekHref(firstDate, standort)} className="tabular font-semibold text-foreground hover:underline">{w.weekNumber}</Link>
                {plan.access.planner && week?.isPublic === false && <p className="mt-1">Entwurf</p>}
              </div>
              {row.map((day, i) => day ? <DayCell key={day.date} day={day} plan={plan} standort={standort} sichtbar={sichtbar} /> : <div key={"leer" + i} className="border-l akro-vertieft" />)}
            </div>
          );
        })}
      </div>

      {/* Tagesliste auf dem Handy */}
      <div className="space-y-2 md:hidden">
        {plan.days.filter((d) => d.shifts.some(sichtbar) || (!nurOffen && d.continuations.length)).map((day) => (
          <div key={day.date} className={cn("akro-panel overflow-hidden", day.isToday && "border-primary/50")}>
            <Link href={weekHref(day.date, standort)} className="akro-panel-kopf flex items-baseline justify-between border-b px-4 py-2">
              <span className="text-[13px] font-semibold">{dayNames[day.weekday - 1]} {day.date.slice(8)}.{day.date.slice(5, 7)}.{day.isToday && <span className="ml-1.5 text-[11px] font-medium text-primary">heute</span>}</span>
              {day.missing > 0 && <span className="text-[12px] font-medium text-destructive"><AlertTriangle className="mr-1 inline size-3 align-[-1px]" />{day.missing} offen</span>}
            </Link>
            <ul className="divide-y divide-[var(--linie-fein)]">
              {day.continuations.map((s) => <ShiftLine key={"f" + s.id} shift={s} fortsetzung />)}
              {day.shifts.filter(sichtbar).map((s) => <ShiftLine key={s.id} shift={s} planner={plan.access.planner} />)}
            </ul>
          </div>
        ))}
      </div>

      {plan.access.manageIssues && <BranchIssues branchId={plan.branch.id} />}
    </div>
  );
}

function DayCell({ day, plan, standort, sichtbar }: { day: MonthDay; plan: MonthPlan; standort: string; sichtbar: (s: ShiftData) => boolean }) {
  const shifts = day.shifts.filter(sichtbar);
  return (
    <div className={cn("min-h-[7.5rem] border-l p-1.5", day.isToday ? "bg-[var(--flaeche-heute)]" : "bg-card")}>
      <Link href={weekHref(day.date, standort)} className="flex items-baseline justify-between gap-1 rounded-sm px-0.5 hover:bg-muted" title="Im Wochenplan öffnen">
        <span className={cn("tabular text-[13px] font-semibold", day.isToday && "text-primary")}>{Number(day.date.slice(8))}</span>
        {day.missing > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] font-medium text-destructive">
            <AlertTriangle className="size-3" />
            {day.missing} offen
          </span>
        )}
      </Link>
      <div className="mt-1 space-y-1">
        {day.continuations.map((s) => (
          <div key={"f" + s.id} className="rounded-[6px] border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground" title={"Fortsetzung vom Vortag: " + s.shiftFrom + "–" + s.shiftTo}>
            <Moon className="mr-1 inline size-3 align-[-2px]" />bis {s.shiftTo} · {s.title || "Schicht"}
          </div>
        ))}
        {shifts.map((s) => {
          const fehlt = s.missing ?? 0;
          return (
            <div
              key={s.id}
              className={cn(
                "rounded-[6px] border px-1.5 py-1 text-[11px] leading-snug",
                fehlt > 0 ? "border-warn/50 bg-warn/[0.06]" : "bg-[var(--flaeche-vertieft)]",
                s.isPublic === false && "border-dashed"
              )}
              title={[s.shiftFrom + "–" + s.shiftTo + (s.endsNextDay ? " (endet am Folgetag)" : ""), s.title, names(s)].filter(Boolean).join(" · ")}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="tabular font-semibold">{s.shiftFrom}–{s.shiftTo}{s.endsNextDay && <span className="font-normal text-muted-foreground"> +1</span>}</span>
                <span className={cn("tabular", fehlt > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {(s.occupiedCount ?? s.bookings.length)}/{s.maxEmployees}
                </span>
              </div>
              {s.title && <div className="truncate text-muted-foreground">{s.title}</div>}
              {s.bookings.length > 0 && <div className="truncate">{names(s)}</div>}
              {fehlt > 0 && <div className="font-medium text-destructive">{fehlt} {fehlt === 1 ? "Platz fehlt" : "Plätze fehlen"}</div>}
              {plan.access.planner && s.isPublic === false && <div className="text-muted-foreground">Entwurf</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShiftLine({ shift, planner = false, fortsetzung = false }: { shift: ShiftData; planner?: boolean; fortsetzung?: boolean }) {
  const fehlt = shift.missing ?? 0;
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]">
      <span className="tabular font-semibold">
        {fortsetzung ? "bis " + shift.shiftTo : shift.shiftFrom + "–" + shift.shiftTo}
        {!fortsetzung && shift.endsNextDay && <span className="font-normal text-muted-foreground"> (+1)</span>}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {fortsetzung ? "Fortsetzung vom Vortag · " : ""}{shift.title || "Schicht"}{shift.bookings.length ? " · " + names(shift) : ""}
      </span>
      {!fortsetzung && (
        <span className={cn("tabular text-[12px]", fehlt > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
          {(shift.occupiedCount ?? shift.bookings.length)}/{shift.maxEmployees}{fehlt > 0 ? " · " + fehlt + " fehlt" : ""}
        </span>
      )}
      {planner && shift.isPublic === false && !fortsetzung && <span className="text-[12px] text-muted-foreground">Entwurf</span>}
    </li>
  );
}

function MonthSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Monatsplan wird geladen">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-12 w-full rounded-[var(--radius-panel)]" />
      <div className="akro-panel hidden overflow-hidden md:block">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="grid grid-cols-7 border-t first:border-t-0">
            {Array.from({ length: 7 }).map((__, j) => (
              <div key={j} className="min-h-[7.5rem] border-l p-2 first:border-l-0"><Skeleton className="h-4 w-6" /></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sprungziel von der Startseite: Monat des ersten Tages mit offenen Plaetzen. */
export function monthLinkForOpen(branchId: string, openDays: string[]) {
  const date = openDays[0] ?? berlinDate();
  return monthPath(date.slice(0, 7), branchId, openDays.length > 0);
}
