"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Building2, Clock, MapPin, MessageSquareWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { monthLinkForOpen } from "@/components/schedule/month-grid";
import { dateLabel, ErrorMessage, json, useAction } from "./client";
import { Requests } from "./requests";

type Shift = {
  id: string;
  date: string;
  title: string | null;
  shiftFrom: string;
  shiftTo: string;
  occupiedCount: number;
  maxEmployees: number;
  missing: number;
  isPublic: boolean;
  description: string | null;
  branch: {
    name: string;
    address: string | null;
    meetingPoint: string | null;
    notes: string | null;
    customer: { name: string } | null;
  } | null;
  bookings: {
    userId: string;
    confirmedAt: string | null;
    user: { firstName: string; lastName: string };
  }[];
};

type BranchCard = {
  id: string;
  name: string;
  isActive: boolean;
  rights: string[];
  shifts: number | null;
  openSlots: number | null;
  openDays: string[];
  draftWeeks: number | null;
  issuesOpen: number | null;
};

type Reports = {
  employees: {
    userId: string;
    firstName: string;
    lastName: string;
    totalMinutes: number;
    plannedMinutes: number;
    targetMinutes: number | null;
    deviationMinutes: number;
  }[];
};

type Base = { firstName: string; userId: string; today: string; unread: number; own: Shift[]; reports: Reports };
type ManagerData = Base & {
  manager: true;
  overview: {
    horizon: { from: string; to: string; days: number };
    customers: { id: string; name: string; isActive: boolean; branches: BranchCard[] }[];
    unassigned: BranchCard[];
    legacyShifts: number | null;
  };
  todayShifts: Shift[];
  // null: fuer diesen Bereich besteht kein Recht - der Zaehler entfaellt.
  counts: { openSlots: number | null; unconfirmed: number | null; pendingRequests: number | null; pendingAbsences: number | null; pendingCorrections: number | null; openIssues: number | null };
};
type EmployeeData = Base & { manager: false; open: Shift[]; plans: { id: string; name: string; customer: { name: string } | null }[] };
type Dashboard = ManagerData | EmployeeData;

function stunden(minuten: number) {
  return (minuten / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " h";
}

export function Dashboard() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => json<Dashboard>("/api/dashboard"), refetchInterval: 30000 });
  const action = useAction();
  const data = query.data;

  if (query.error) {
    return (
      <div className="space-y-3">
        <ErrorMessage error={query.error} />
        <Button variant="outline" onClick={() => query.refetch()}>Erneut versuchen</Button>
      </div>
    );
  }
  if (!data) return <DashboardSkeleton />;

  const eigeneMonatszeile = data.reports.employees.find((e) => e.userId === data.userId);

  return (
    <div className="space-y-6">
      {/* Der Verlauf der Dachmarke - einmal je Seite, ganz oben. */}
      <header className="akro-marke-verlauf akro-auf-marke flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] px-5 py-4">
        <div className="min-w-0">
          <p className="text-[12px] text-white/70">{dateLabel(data.today)}</p>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.03em] text-white">Guten Tag, {data.firstName}</h1>
        </div>
        <Button asChild variant="outline" size="sm" className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white">
          <Link href={data.manager ? "/schedule/month" : "/schedule/employee"}>
            Dienstplan öffnen
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </header>

      {data.manager ? <ManagerStart data={data} /> : <MitarbeiterStart data={data} action={action} />}

      <Requests manager={data.manager} userId={data.userId} />

      {/* Nur eine kurze Zusammenfassung; die Auswertung hat eine eigene Seite. */}
      <section className="akro-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{data.manager ? "Stunden im laufenden Monat" : "Deine Monatsstunden"}</h2>
            <p className="tabular mt-1 text-[13px] text-muted-foreground">
              {data.manager
                ? `${data.reports.employees.length} ${data.reports.employees.length === 1 ? "Person" : "Personen"} in deiner Auswertung`
                : eigeneMonatszeile
                  ? `${stunden(eigeneMonatszeile.totalMinutes)} erfasst${eigeneMonatszeile.targetMinutes !== null ? ` · Soll ${stunden(eigeneMonatszeile.targetMinutes)}` : ""} · Abweichung zum Plan ${stunden(eigeneMonatszeile.deviationMinutes)}`
                  : "Noch keine Zeiten erfasst"}
            </p>
          </div>
          <Button asChild variant="outline" size="sm"><Link href="/reporting">Zur Auswertung</Link></Button>
        </div>
      </section>
    </div>
  );
}

/** Disposition: zuerst das, was eine Entscheidung braucht, dann Kunden und Standorte. */
function ManagerStart({ data }: { data: ManagerData }) {
  const { overview, counts } = data;
  const cards = [...overview.customers.flatMap((c) => c.branches), ...overview.unassigned];
  const leer = !overview.customers.length && !overview.unassigned.length;
  const anträge = counts.pendingRequests === null && counts.pendingCorrections === null ? null : (counts.pendingRequests ?? 0) + (counts.pendingCorrections ?? 0);

  return (
    <>
      <HandlungsLeiste
        eintraege={[
          { zahl: counts.openSlots, label: `offene Plätze · ${overview.horizon.days} Tage`, href: "#kunden", dringend: true },
          { zahl: counts.unconfirmed, label: "Bestätigungen offen", href: "/schedule/month" },
          { zahl: anträge, label: "Anträge offen", href: "#antraege" },
          { zahl: counts.pendingAbsences, label: "Abwesenheiten zur Freigabe", href: "/employees/absences" },
          { zahl: counts.openIssues, label: "Standortmeldungen offen", href: "#kunden" },
          { zahl: data.unread, label: "neue Nachrichten", href: "/portal/inbox" },
        ]}
      />

      <section id="kunden" className="space-y-3" aria-labelledby="kunden-titel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="kunden-titel" className="text-[17px] font-semibold tracking-[-0.02em]">Kunden und Standorte</h2>
          <p className="tabular text-[12.5px] text-muted-foreground">Offene Plätze von {dateLabel(overview.horizon.from)} bis {dateLabel(overview.horizon.to)}, auch in Entwürfen</p>
        </div>

        {overview.legacyShifts ? (
          <p className="rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[13px]">
            <AlertTriangle className="mr-1.5 inline size-3.5 align-[-2px] text-warn" />
            {overview.legacyShifts} {overview.legacyShifts === 1 ? "Schicht ist" : "Schichten sind"} noch keinem Standort zugeordnet (Altbestand).{" "}
            <Link href="/schedule/flexible?standort=ohne" className="font-medium text-primary underline-offset-4 hover:underline">Zuordnen</Link>
          </p>
        ) : null}

        {leer ? (
          <div className="akro-panel p-5 text-[14px] text-muted-foreground">
            {overview.legacyShifts !== null
              ? <>Noch keine Kunden angelegt. Kunden und Standorte legst du unter <Link href="/divisions" className="font-medium text-primary underline-offset-4 hover:underline">Einsatzorte</Link> an.</>
              : "Dir ist noch kein Standort freigegeben. Freigaben vergibt die Administration."}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {overview.customers.map((c) => (
              <KundenKarte key={c.id} name={c.name} inaktiv={!c.isActive} branches={c.branches} admin={overview.legacyShifts !== null} />
            ))}
            {overview.unassigned.length > 0 && (
              <KundenKarte name="Ohne Kunde" hinweis="Diese Standorte sind noch keinem Kunden zugeordnet." branches={overview.unassigned} admin={overview.legacyShifts !== null} />
            )}
          </div>
        )}
        {cards.length > 0 && cards.every((b) => b.openSlots === null) && (
          <p className="text-[13px] text-muted-foreground">Für deine Standorte ist „Dienstplan ansehen“ nicht freigegeben – Besetzungszahlen sind daher ausgeblendet.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Abschnitt
          titel="Heutige Einsätze"
          leer="Heute sind an deinen Standorten keine Schichten geplant."
          eintraege={data.todayShifts}
          render={(s) => {
            const offen = s.bookings.filter((b) => !b.confirmedAt).length;
            const warnung = s.missing > 0 ? `${s.missing} ${s.missing === 1 ? "Platz" : "Plätze"} offen` : !s.isPublic ? "Entwurf" : offen > 0 ? `${offen} unbestätigt` : undefined;
            return <SchichtZeile key={s.id} shift={s} namen={s.bookings.map((b) => `${b.user.firstName} ${b.user.lastName}`).join(", ")} warnung={warnung} />;
          }}
        />
        {data.own.length > 0 && (
          <Abschnitt titel="Deine nächsten Schichten" leer="" eintraege={data.own.slice(0, 8)} render={(s) => <SchichtZeile key={s.id} shift={s} />} />
        )}
      </div>
    </>
  );
}

/** Kundenkarte mit ihren sichtbaren Standorten. */
function KundenKarte({ name, branches, inaktiv = false, hinweis, admin }: { name: string; branches: BranchCard[]; inaktiv?: boolean; hinweis?: string; admin: boolean }) {
  return (
    <article className="akro-panel flex flex-col overflow-hidden">
      <div className="akro-panel-kopf border-b px-4 py-2.5">
        <h3 className="text-[15px] font-semibold tracking-[-0.02em]">
          {name}
          {inaktiv && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">(inaktiv)</span>}
        </h3>
        {hinweis && <p className="text-[12px] text-muted-foreground">{hinweis}{admin && <> <Link href="/divisions" className="text-primary underline-offset-4 hover:underline">Zuordnen</Link></>}</p>}
      </div>
      {branches.length === 0 ? (
        <p className="px-4 py-5 text-[14px] text-muted-foreground">
          Noch keine Standorte.{admin && <> <Link href="/divisions" className="font-medium text-primary underline-offset-4 hover:underline">Standort anlegen</Link></>}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--linie-fein)]">
          {branches.map((b) => <StandortZeile key={b.id} branch={b} />)}
        </ul>
      )}
    </article>
  );
}

function StandortZeile({ branch }: { branch: BranchCard }) {
  const planbar = branch.openSlots !== null;
  const monat = monthLinkForOpen(branch.id, []);
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2">
        <Building2 className="size-4 shrink-0 text-muted-foreground" />
        {planbar ? (
          <Link href={monat} className="min-w-0 flex-1 truncate text-[14px] font-medium hover:underline">{branch.name}</Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{branch.name}</span>
        )}
      </div>
      <div className="tabular mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-6 text-[12.5px]">
        {planbar && (
          <>
            <span className="text-muted-foreground">{branch.shifts} {branch.shifts === 1 ? "Schicht" : "Schichten"}</span>
            {branch.openSlots! > 0 ? (
              <Link href={monthLinkForOpen(branch.id, branch.openDays)} className="font-medium text-destructive underline-offset-4 hover:underline">
                <AlertTriangle className="mr-1 inline size-3 align-[-1px]" />
                {branch.openSlots} {branch.openSlots === 1 ? "offener Platz" : "offene Plätze"}
              </Link>
            ) : (
              <span className="text-muted-foreground">voll besetzt</span>
            )}
            {branch.draftWeeks ? <span className="text-muted-foreground">{branch.draftWeeks} {branch.draftWeeks === 1 ? "Woche" : "Wochen"} im Entwurf</span> : null}
          </>
        )}
        {branch.issuesOpen !== null && (
          <span className={cn(branch.issuesOpen > 0 ? "text-foreground" : "text-muted-foreground")}>
            <MessageSquareWarning className="mr-1 inline size-3 align-[-1px]" />
            {branch.issuesOpen} {branch.issuesOpen === 1 ? "Meldung" : "Meldungen"}
          </span>
        )}
        {!planbar && branch.issuesOpen === null && <span className="text-muted-foreground">keine Planansicht freigegeben</span>}
      </div>
    </li>
  );
}

/** Mitarbeitersicht: die naechste Schicht und die Zeiterfassung zuerst. */
function MitarbeiterStart({ data, action }: { data: EmployeeData; action: ReturnType<typeof useAction> }) {
  const nächste = data.own[0];
  const eigeneBuchung = nächste?.bookings.find((b) => b.userId === data.userId);

  return (
    <>
      <section className="akro-panel p-4">
        <h2 className="akro-label">Deine nächste Schicht</h2>
        {nächste ? (
          <div className="mt-2 space-y-3">
            <p className="akro-kennzahl text-[19px]">
              {dateLabel(nächste.date)}
              <span className="px-2 text-border" aria-hidden="true">|</span>
              {nächste.shiftFrom}–{nächste.shiftTo}
            </p>
            <p className="text-[14px]">
              {nächste.title || "Schicht"}
              {nächste.branch ? ` · ${nächste.branch.name}` : ""}
              {nächste.branch?.customer ? ` · ${nächste.branch.customer.name}` : ""}
            </p>
            {nächste.branch?.meetingPoint && (
              <p className="flex items-start gap-1.5 text-[14px] text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                Treffpunkt: {nächste.branch.meetingPoint}
                {nächste.branch.address ? ` · ${nächste.branch.address}` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={eigeneBuchung?.confirmedAt ? "outline" : "default"}
                disabled={!!eigeneBuchung?.confirmedAt || action.isPending}
                onClick={() => action.mutate({ url: "/api/bookings", method: "PATCH", data: { shiftId: nächste.id }, message: "Schicht bestätigt" })}
              >
                {eigeneBuchung?.confirmedAt ? "Bestätigt" : "Schicht bestätigen"}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/time"><Clock className="size-3.5" />Zeiterfassung</Link>
              </Button>
              <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ url: "/api/mod-requests", data: { shiftId: nächste.id, kind: "SWAP" }, message: "Schicht zum Tausch angeboten" })}>
                Zum Tausch anbieten
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-muted-foreground">Für dich ist noch keine kommende Schicht veröffentlicht. Sobald die Planung steht, erscheint sie hier.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Abschnitt titel="Weitere eigene Schichten" leer="Keine weiteren Schichten geplant." eintraege={data.own.slice(1, 8)} render={(s) => <SchichtZeile key={s.id} shift={s} />} />
        <Abschnitt
          titel="Offene Schichten für dich"
          leer="Aktuell keine passenden offenen Schichten an deinen freigegebenen Standorten."
          eintraege={data.open.slice(0, 8)}
          render={(s) => (
            <SchichtZeile
              key={s.id}
              shift={s}
              aktion={
                <Button size="xs" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ url: "/api/mod-requests", data: { shiftId: s.id }, message: "Übernahme angefragt" })}>
                  Übernahme anfragen
                </Button>
              }
            />
          )}
        />
      </div>

      {data.plans.length > 0 && (
        <section className="akro-panel overflow-hidden">
          <h2 className="akro-panel-kopf border-b px-4 py-2.5 text-[14px] font-semibold tracking-[-0.02em]">Freigegebene Standortpläne</h2>
          <ul className="divide-y divide-[var(--linie-fein)]">
            {data.plans.map((p) => (
              <li key={p.id}>
                <Link href={`/schedule/month?standort=${p.id}`} className="flex items-center gap-2 px-4 py-2.5 text-[14px] hover:bg-[var(--flaeche-kopf)]">
                  <Building2 className="size-4 text-muted-foreground" />
                  <span className="flex-1">{p.name}</span>
                  {p.customer && <span className="text-[12.5px] text-muted-foreground">{p.customer.name}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Zahlenleiste mit Sprungzielen - die Reihenfolge ist die Dringlichkeit. Felder ohne Recht (null) entfallen. */
function HandlungsLeiste({ eintraege }: { eintraege: { zahl: number | null; label: string; href: string; dringend?: boolean }[] }) {
  const sichtbar = eintraege.filter((e): e is { zahl: number; label: string; href: string; dringend?: boolean } => e.zahl !== null);
  return (
    <div className="akro-panel overflow-hidden">
      {/* Haarlinien statt Zwischenraeume: jedes Feld zieht links und oben eine Linie;
          der Versatz um 1px legt die aeusseren unter den Rand der Flaeche. */}
      <div className="-mt-px -ml-px grid grid-cols-2 sm:grid-cols-3 xl:auto-cols-fr xl:grid-flow-col xl:grid-cols-none">
        {sichtbar.map((e) => (
          <Link
            key={e.label}
            href={e.href}
            className="flex flex-col gap-1 border-t border-l p-4 transition-colors hover:bg-[var(--flaeche-kopf)]"
          >
            <span className={cn("akro-kennzahl text-[28px]", e.dringend && e.zahl > 0 ? "text-destructive" : "text-foreground")}>{e.zahl}</span>
            <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
              {e.dringend && e.zahl > 0 && <AlertTriangle className="size-3.5 shrink-0 text-destructive" />}
              {e.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Abschnitt({ titel, leer, eintraege, render }: { titel: string; leer: string; eintraege: Shift[]; render: (shift: Shift) => React.ReactNode }) {
  return (
    <section className="akro-panel overflow-hidden">
      <div className="akro-panel-kopf flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-[14px] font-semibold tracking-[-0.02em]">{titel}</h2>
        {eintraege.length > 0 && <span className="akro-kennzahl text-[13px] text-muted-foreground">{eintraege.length}</span>}
      </div>
      {eintraege.length ? <div className="divide-y divide-[var(--linie-fein)]">{eintraege.map(render)}</div> : <p className="px-4 py-6 text-[14px] text-muted-foreground">{leer}</p>}
    </section>
  );
}

function SchichtZeile({ shift, namen, warnung, aktion }: { shift: Shift; namen?: string; warnung?: string; aktion?: React.ReactNode }) {
  return (
    <article className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-[var(--flaeche-kopf)]">
      <span className="tabular text-[14px] font-medium">{dateLabel(shift.date)} · {shift.shiftFrom}–{shift.shiftTo}</span>
      <span className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">
        {[shift.title, shift.branch?.name].filter(Boolean).join(" · ") || "Schicht"}
        {namen ? ` · ${namen}` : ""}
      </span>
      {warnung && <Badge variant="secondary" className="tabular border-warn/45 bg-warn/10 text-warn">{warnung}</Badge>}
      {aktion}
    </article>
  );
}

/** Geruest in der Form des spaeteren Inhalts. */
function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Übersicht wird geladen">
      <Skeleton className="h-[86px] w-full rounded-[var(--radius-panel)]" />
      <div className="akro-panel overflow-hidden">
        <div className="-mt-px -ml-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-2 border-t border-l p-4">
              <Skeleton className="h-7 w-10" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="akro-panel overflow-hidden">
            <div className="akro-panel-kopf border-b px-4 py-3"><Skeleton className="h-4 w-40" /></div>
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
