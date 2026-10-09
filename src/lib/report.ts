import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./errors";
import { berlinDate, recordMinutes, weekDate, rangeMinutes, isoWeek, addDate } from "./berlin";
import { branchIds, can, staffIds, type Access } from "./access";

/**
 * Monatsauswertung. Eigene Werte sieht jede Person; fremde Werte nur, wer
 * die Person mit "Stunden einsehen" zugeordnet hat - und dann nur fuer
 * Standorte mit "Zeiterfassung einsehen". Sollstunden gelten
 * standortuebergreifend und erscheinen fuer andere Personen nur bei Admins.
 * Mit branchId wird auf einen Standort eingeschraenkt.
 */
export async function monthlyReport(a: Access, month: number, year: number, options: { branchId?: string | null; selfOnly?: boolean } = {}) {
  const first = year + "-" + String(month).padStart(2, "0") + "-01";
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const branch = options.branchId ?? null;
  if (branch && !can(a, "VIEW_TIME", branch)) throw new ApiError("Nicht gefunden.", 404);
  const timeBranches = branchIds(a, "VIEW_TIME");
  const managed = options.selfOnly ? [] : staffIds(a, "VIEW_HOURS");
  const others = managed === null ? null : timeBranches && timeBranches.length ? managed.filter((id) => id !== a.userId) : [];
  const allowedBranches = branch ? [branch] : timeBranches;

  const people = await db.organizationMember.findMany({
    where: { organizationId: a.orgId, ...(others === null ? {} : { userId: { in: [a.userId, ...others] } }) },
    include: { user: { select: { id: true, firstName: true, lastName: true, profileImage: true } } },
  });
  // Eigene Werte vollstaendig, fremde nur an freigegebenen Standorten.
  const recordScope: Prisma.TimeRecordWhereInput = others === null
    ? (branch ? { branchId: branch } : {})
    : { OR: [{ userId: a.userId, ...(branch ? { branchId: branch } : {}) }, { userId: { in: others }, branchId: { in: allowedBranches ?? [] } }] };
  const bookingScope: Prisma.BookingWhereInput = others === null
    ? (branch ? { shift: { schedule: { branchId: branch } } } : {})
    : { OR: [{ userId: a.userId, ...(branch ? { shift: { schedule: { branchId: branch } } } : {}) }, { userId: { in: others }, shift: { schedule: { branchId: { in: allowedBranches ?? [] } } } }] };

  const [records, bookings] = await Promise.all([
    db.timeRecord.findMany({ where: { AND: [{ organizationId: a.orgId, userId: { in: people.map((p) => p.userId) }, date: { gte: new Date(first), lte: new Date(last) } }, recordScope] } }),
    db.booking.findMany({
      where: { AND: [{ userId: { in: people.map((p) => p.userId) }, shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true, year: { gte: year - 1, lte: year + 1 } } } }, bookingScope] },
      include: { shift: { include: { schedule: true } } },
    }),
  ]);
  const weeks = new Map<number, { weekNumber: number; label: string }>();
  let weekdays = 0;
  for (let d = first; d <= last; d = addDate(d, 1)) {
    const week = isoWeek(d);
    weeks.set(week.weekNumber, { weekNumber: week.weekNumber, label: "KW " + week.weekNumber });
    const day = new Date(d).getUTCDay();
    if (day > 0 && day < 6) weekdays++;
  }
  const employees = people.map((p) => {
    const own = records.filter((t) => t.userId === p.userId);
    const shifts = bookings.filter((b) => b.userId === p.userId && (() => { const d = weekDate(b.shift.schedule.year, b.shift.schedule.weekNumber, b.shift.dayOfWeek); return d >= first && d <= last; })());
    const totalMinutes = own.reduce((sum, r) => sum + recordMinutes(r), 0);
    const plannedMinutes = shifts.reduce((sum, b) => { const s = b.shift, gross = rangeMinutes(s.shiftFrom, s.shiftTo); return sum + Math.max(0, gross - (s.pauseOption === "PER_HOUR" ? Math.floor(gross / 60) * s.pauseValue : s.pauseValue)); }, 0);
    const showTarget = !branch && (a.isAdmin || p.userId === a.userId);
    const targetMinutes = showTarget ? Math.round(p.targetHoursPerWeek / 5 * weekdays * 60) : null;
    return {
      userId: p.userId, ...p.user, totalMinutes, plannedMinutes, targetMinutes, deviationMinutes: totalMinutes - plannedMinutes, shiftCount: shifts.length,
      kwBreakdown: [...weeks.values()].map((w) => ({ weekNumber: w.weekNumber, totalMinutes: own.filter((r) => isoWeek(r.date.toISOString().slice(0, 10)).weekNumber === w.weekNumber).reduce((sum, r) => sum + recordMinutes(r), 0), shiftCount: shifts.filter((b) => b.shift.schedule.weekNumber === w.weekNumber).length })),
    };
  });
  employees.sort((x, y) => x.lastName.localeCompare(y.lastName, "de"));
  return { month, year, branchId: branch, kwHeaders: [...weeks.values()], employees, totals: { totalMinutes: employees.reduce((s, e) => s + e.totalMinutes, 0), totalShifts: employees.reduce((s, e) => s + e.shiftCount, 0) } };
}

export function reportPeriod(request: Request) {
  const q = new URL(request.url).searchParams, today = berlinDate();
  return { month: Number(q.get("month") || today.slice(5, 7)), year: Number(q.get("year") || today.slice(0, 4)), branchId: q.get("standort") || null };
}
