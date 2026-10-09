/**
 * Planungsuebersicht (Startseite) und Monatsplan eines Standorts - beide mit
 * echten Abfragen und ausschliesslich im Rahmen der Freigaben.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./errors";
import { addDate, berlinDate, isoWeek, shiftRange } from "./berlin";
import { anyBranchIds, assertCan, can, type Access } from "./access";
import { BRANCH_RIGHTS, type BranchRightKey } from "./access-shared";
import { ineffectiveBookings, shiftInclude, shiftView, type ShiftView } from "./planning";

/** Wie weit die Startseite nach offenen Plaetzen vorausschaut. */
export const HORIZON_DAYS = 28;

function weeksBetween(from: string, to: string) {
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  for (let d = from; d <= to; d = addDate(d, 1)) {
    const w = isoWeek(d);
    weeks.set(w.year + "-" + w.weekNumber, w);
  }
  return [...weeks.values()];
}

/** Planung (Admins und Manager mit "Dienstplan ansehen") sieht auch Entwuerfe. */
function planner(a: Access, branchId: string | null) {
  return can(a, "VIEW_SCHEDULE", branchId) && (a.isAdmin || a.role === "MANAGER");
}

async function shiftsBetween(a: Access, branchIdsToLoad: string[], from: string, to: string) {
  if (!branchIdsToLoad.length) return [];
  const drafts = branchIdsToLoad.filter((id) => planner(a, id));
  const published = branchIdsToLoad.filter((id) => !drafts.includes(id));
  const weeks = weeksBetween(addDate(from, -1), to);
  const scope: Prisma.ScheduleWhereInput[] = [
    ...(drafts.length ? [{ branchId: { in: drafts } }] : []),
    ...(published.length ? [{ branchId: { in: published }, isPublic: true }] : []),
  ];
  return db.shift.findMany({
    where: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, OR: scope, AND: [{ OR: weeks.map((w) => ({ year: w.year, weekNumber: w.weekNumber })) }] } },
    include: shiftInclude,
    orderBy: [{ shiftFrom: "asc" }],
  });
}

export type BranchCard = {
  id: string;
  name: string;
  isActive: boolean;
  rights: BranchRightKey[];
  shifts: number | null;
  openSlots: number | null;
  openDays: string[];
  draftWeeks: number | null;
  issuesOpen: number | null;
};

/** Karten der sichtbaren Kunden mit ihren sichtbaren Standorten. */
export async function planningOverview(a: Access) {
  const today = berlinDate(), until = addDate(today, HORIZON_DAYS - 1);
  const ids = anyBranchIds(a);
  const branches = await db.branch.findMany({
    where: { organizationId: a.orgId, isActive: true, ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true, customerId: true },
  });
  const viewable = branches.filter((b) => can(a, "VIEW_SCHEDULE", b.id)).map((b) => b.id);
  const issueBranches = branches.filter((b) => can(a, "MANAGE_ISSUES", b.id)).map((b) => b.id);
  const [shifts, issues, customers, legacy] = await Promise.all([
    shiftsBetween(a, viewable, today, until),
    issueBranches.length
      ? db.branchIssue.groupBy({ by: ["branchId"], where: { organizationId: a.orgId, branchId: { in: issueBranches }, status: { not: "RESOLVED" } }, _count: { _all: true } })
      : Promise.resolve([]),
    db.customer.findMany({
      // Admins sehen auch aktive Kunden ohne Standort; Standorte eines inaktiven Kunden bleiben sichtbar.
      where: { organizationId: a.orgId, OR: [{ id: { in: branches.map((b) => b.customerId).filter((x): x is string => !!x) } }, ...(a.isAdmin ? [{ isActive: true }] : [])] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
    a.isAdmin
      ? db.shift.count({ where: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, branchId: null } } })
      : Promise.resolve(null),
  ]);
  const upcoming = shifts.filter((s) => { const d = shiftRange(s).date; return d >= today && d <= until; });
  const ineffective = await ineffectiveBookings(db, a.orgId, upcoming.filter((s) => planner(a, s.schedule.branchId)));
  const views = upcoming.map((s) => shiftView(s, a, ineffective));
  const card = (b: (typeof branches)[number]): BranchCard => {
    const own = views.filter((s) => s.branchId === b.id);
    const view = can(a, "VIEW_SCHEDULE", b.id);
    const openDays = [...new Set(own.filter((s) => s.missing > 0).map((s) => s.date))].sort();
    const drafts = new Set(own.filter((s) => !s.isPublic).map((s) => s.scheduleId));
    return {
      id: b.id, name: b.name, isActive: b.isActive,
      rights: a.isAdmin ? BRANCH_RIGHTS.map((r) => r.key) : [...(a.branches.get(b.id) ?? [])],
      shifts: view ? own.length : null,
      openSlots: view ? own.reduce((sum, s) => sum + s.missing, 0) : null,
      openDays: view ? openDays.slice(0, 14) : [],
      draftWeeks: planner(a, b.id) ? drafts.size : null,
      issuesOpen: can(a, "MANAGE_ISSUES", b.id) ? (issues.find((i) => i.branchId === b.id)?._count._all ?? 0) : null,
    };
  };
  return {
    horizon: { from: today, to: until, days: HORIZON_DAYS },
    customers: customers.map((c) => ({ ...c, branches: branches.filter((b) => b.customerId === c.id).map(card) })),
    unassigned: branches.filter((b) => !b.customerId).map(card),
    legacyShifts: legacy,
    views,
  };
}

/** Monatsplan eines Standorts in Europe/Berlin, inklusive Monats- und Nachtgrenzen. */
export async function branchMonth(a: Access, branchId: string, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError("Ungültiger Monat (JJJJ-MM).");
  const branch = await db.branch.findFirst({
    where: { id: branchId, organizationId: a.orgId },
    select: { id: true, name: true, address: true, meetingPoint: true, isActive: true, customer: { select: { id: true, name: true } } },
  });
  if (!branch) throw new ApiError("Nicht gefunden.", 404);
  assertCan(a, "VIEW_SCHEDULE", branch.id);
  const first = month + "-01";
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const shifts = await shiftsBetween(a, [branch.id], first, last);
  const isPlanner = planner(a, branch.id);
  const ineffective = isPlanner ? await ineffectiveBookings(db, a.orgId, shifts) : new Set<string>();
  const views = shifts.map((s) => shiftView(s, a, ineffective));
  const today = berlinDate();
  const days: { date: string; weekday: number; isToday: boolean; shifts: ShiftView[]; continuations: ShiftView[]; missing: number }[] = [];
  for (let d = first; d <= last; d = addDate(d, 1)) {
    const own = views.filter((s) => s.date === d).sort((x, z) => x.shiftFrom.localeCompare(z.shiftFrom));
    // Nachtschichten des Vortags, die in diesen Tag hineinreichen - nur am Monatsersten, sonst stehen sie am Vortag.
    const continuations = d === first ? views.filter((s) => s.date === addDate(first, -1) && s.endsNextDay) : [];
    days.push({ date: d, weekday: ((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7) + 1, isToday: d === today, shifts: own, continuations, missing: own.reduce((sum, s) => sum + s.missing, 0) });
  }
  const weeks = weeksBetween(first, last);
  const schedules = await db.schedule.findMany({
    where: { organizationId: a.orgId, branchId: branch.id, deletedAt: null, OR: weeks.map((w) => ({ year: w.year, weekNumber: w.weekNumber })), ...(isPlanner ? {} : { isPublic: true }) },
    select: { id: true, weekNumber: true, year: true, isPublic: true },
  });
  const inMonth = views.filter((s) => s.date >= first && s.date <= last);
  const issuesOpen = can(a, "MANAGE_ISSUES", branch.id) ? await db.branchIssue.count({ where: { organizationId: a.orgId, branchId: branch.id, status: { not: "RESOLVED" } } }) : null;
  return {
    branch, month, first, last, today, days,
    weeks: weeks.map((w) => {
      const s = schedules.find((x) => x.year === w.year && x.weekNumber === w.weekNumber);
      return { ...w, scheduleId: s?.id ?? null, isPublic: s ? s.isPublic : null, shifts: inMonth.filter((v) => v.scheduleId === s?.id).length };
    }),
    totals: { shifts: inMonth.length, missing: inMonth.reduce((sum, s) => sum + s.missing, 0), draftShifts: inMonth.filter((s) => !s.isPublic).length },
    access: {
      planner: isPlanner,
      edit: can(a, "EDIT_SHIFTS", branch.id),
      publish: can(a, "PUBLISH_SCHEDULE", branch.id),
      handleRequests: can(a, "HANDLE_REQUESTS", branch.id),
      manageIssues: can(a, "MANAGE_ISSUES", branch.id),
      viewTime: can(a, "VIEW_TIME", branch.id),
    },
    issuesOpen,
  };
}

/** Wer an einem Standort fuer Meldungen zustaendig sein kann: Admins und Manager mit "Standortmeldungen bearbeiten". */
export async function issueAssignees(orgId: string, branchId: string) {
  const members = await db.organizationMember.findMany({
    where: {
      organizationId: orgId, isActive: true, isActivated: true,
      OR: [{ role: { in: ["OWNER", "ADMIN"] } }, { role: "MANAGER", branchAccess: { some: { branchId, rights: { has: "MANAGE_ISSUES" } } } }],
    },
    select: { id: true, role: true, user: { select: { firstName: true, lastName: true } } },
    orderBy: { user: { lastName: "asc" } },
  });
  return members.map((m) => ({ memberId: m.id, role: m.role, name: m.user.firstName + " " + m.user.lastName }));
}
