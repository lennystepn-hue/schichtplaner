import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { addDate, berlinDate, berlinTime, minuteOfDay, shiftRange } from "@/lib/berlin";
import { branchIds, can, requireAccess, staffIds, timeScope, type Access } from "@/lib/access";
import { checkAssignment, shiftInclude, shiftView } from "@/lib/planning";
import { monthlyReport } from "@/lib/report";
import { planningOverview } from "@/lib/overview";

/** Eigene, veroeffentlichte Schichten ab jetzt (60 Tage). */
async function ownShifts(a: Access, today: string) {
  const year = Number(today.slice(0, 4));
  const shifts = await db.shift.findMany({
    where: { deletedAt: null, bookings: { some: { userId: a.userId } }, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true, year: { gte: year - 1, lte: year + 1 } } },
    include: shiftInclude,
  });
  const now = Date.parse(today) / 60000 + minuteOfDay(berlinTime());
  return shifts.map((s) => ({ s, r: shiftRange(s) })).filter(({ r }) => r.end > now && r.date <= addDate(today, 60)).sort((x, y) => x.r.start - y.r.start).map(({ s }) => shiftView(s, a));
}

/** Offene Schichten an Standorten mit Freigabe "Offene Schichten sehen und anfragen". */
async function requestableShifts(a: Access, today: string) {
  const ids = branchIds(a, "REQUEST_SHIFTS");
  if (ids && !ids.length) return [];
  const year = Number(today.slice(0, 4));
  const shifts = await db.shift.findMany({
    where: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true, branchId: ids ? { in: ids } : { not: null }, year: { gte: year - 1, lte: year + 1 } } },
    include: shiftInclude,
  });
  const now = Date.parse(today) / 60000 + minuteOfDay(berlinTime());
  const open = [];
  for (const s of shifts.map((s) => ({ s, r: shiftRange(s) })).filter(({ r }) => r.end > now && r.date <= addDate(today, 60)).sort((x, y) => x.r.start - y.r.start).map(({ s }) => s)) {
    if (s.bookings.length >= s.maxEmployees || s.bookings.some((b) => b.userId === a.userId)) continue;
    if ((await checkAssignment(db, s, a.userId)).length) continue;
    open.push(shiftView(s, a));
    if (open.length >= 20) break;
  }
  return open;
}

export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    const today = berlinDate(), year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
    const [unread, own, reports] = await Promise.all([
      db.messageRecipient.count({ where: { userId: a.userId, isRead: false, isDeleted: false, message: { organizationId: a.orgId } } }),
      ownShifts(a, today),
      monthlyReport(a, month, year),
    ]);
    const base = { firstName: a.member.user.firstName, userId: a.userId, today, unread, own, reports };
    const planning = a.isAdmin || a.role === "MANAGER";
    if (!planning) {
      const plans = await db.branch.findMany({
        where: { organizationId: a.orgId, isActive: true, id: { in: branchIds(a, "VIEW_SCHEDULE") ?? [] } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, customer: { select: { name: true } } },
      });
      return { ...base, manager: false, open: await requestableShifts(a, today), plans };
    }
    const overview = await planningOverview(a);
    // Zaehler ohne passendes Recht sind null und erscheinen nicht - eine Null
    // wuerde Zustaendigkeit vortaeuschen.
    const handle = branchIds(a, "HANDLE_REQUESTS");
    const absences = staffIds(a, "MANAGE_ABSENCES")?.filter((id) => id !== a.userId) ?? null;
    const corrections = a.isAdmin || (!!branchIds(a, "EDIT_TIME")?.length && !!staffIds(a, "VIEW_HOURS")?.some((id) => id !== a.userId));
    const issues = a.isAdmin || !!branchIds(a, "MANAGE_ISSUES")?.length;
    const plans = a.isAdmin || !!branchIds(a, "VIEW_SCHEDULE")?.length;
    const [pendingRequests, pendingAbsences, pendingCorrections] = await Promise.all([
      handle && !handle.length ? null : db.modRequest.count({ where: { state: "OPEN", shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, ...(handle ? { branchId: { in: handle } } : {}) } } } }),
      absences && !absences.length ? null : db.absence.count({ where: { status: "PENDING", category: { organizationId: a.orgId }, ...(absences ? { userId: { in: absences } } : {}) } }),
      corrections ? db.timeCorrection.count({ where: { organizationId: a.orgId, status: "PENDING", record: timeScope(a, "edit") } }) : null,
    ]);
    const { views, ...cards } = overview;
    const todayShifts = views.filter((s) => s.date === today || (s.date === addDate(today, -1) && s.endsNextDay)).filter((s) => can(a, "VIEW_SCHEDULE", s.branchId));
    return {
      ...base,
      manager: true,
      overview: cards,
      todayShifts,
      counts: {
        openSlots: plans ? views.reduce((sum, s) => sum + s.missing, 0) : null,
        unconfirmed: plans ? views.reduce((sum, s) => sum + (s.isPublic ? s.bookings.filter((b) => !b.confirmedAt).length : 0), 0) : null,
        pendingRequests, pendingAbsences, pendingCorrections,
        openIssues: issues ? [...cards.customers.flatMap((c) => c.branches), ...cards.unassigned].reduce((sum, b) => sum + (b.issuesOpen ?? 0), 0) : null,
      },
    };
  });
}
