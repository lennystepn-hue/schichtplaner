import type { Prisma } from "@prisma/client";
import { api, serial, ApiError } from "@/lib/api";
import { branchIds, can, requireAccess, type Access } from "@/lib/access";
import { ineffectiveBookings, shiftInclude, shiftView } from "@/lib/planning";
import { ensureSchedule } from "@/lib/shift-service";

const LEGACY = "ohne";

/** Ohne "Dienstplan ansehen" nur eigene und noch offene Schichten - nicht den ganzen Plan. */
function visibleFor(a: Access) {
  return (s: { schedule: { branchId: string | null }; bookings: { userId: string }[]; maxEmployees: number }) =>
    can(a, "VIEW_SCHEDULE", s.schedule.branchId) || s.bookings.some(b => b.userId === a.userId) || s.bookings.length < s.maxEmployees;
}

function scheduleAccess(a: Access, branchId: string | null) {
  const view = can(a, "VIEW_SCHEDULE", branchId);
  return {
    view,
    planner: view && (a.isAdmin || a.role === "MANAGER"),
    edit: can(a, "EDIT_SHIFTS", branchId),
    publish: can(a, "PUBLISH_SCHEDULE", branchId),
    handleRequests: can(a, "HANDLE_REQUESTS", branchId),
    request: can(a, "REQUEST_SHIFTS", branchId),
    viewTime: can(a, "VIEW_TIME", branchId),
  };
}

/**
 * Wochenplan eines Standorts (?standort=ID, fuer Admins auch ?standort=ohne
 * fuer den Altbestand) oder - ohne Standort - die zusammengefuehrte Sicht aus
 * eigenen Schichten und freigegebenen Standorten.
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams;
    const weekNumber = Number(q.get("kw")), year = Number(q.get("year"));
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültige Kalenderwoche.");
    const standort = q.get("standort");
    return serial(async tx => {
      if (standort) {
        const legacy = standort === LEGACY;
        const branch = legacy ? null : await tx.branch.findFirst({ where: { id: standort, organizationId: a.orgId }, select: { id: true, name: true, isActive: true, customerId: true, customer: { select: { id: true, name: true } } } });
        if (legacy ? !a.isAdmin : !branch) throw new ApiError("Nicht gefunden.", 404);
        const branchId = branch?.id ?? null;
        const access = scheduleAccess(a, branchId);
        if (!access.view && !access.request) throw new ApiError("Nicht gefunden.", 404);
        let schedule = await tx.schedule.findFirst({ where: { organizationId: a.orgId, branchId, weekNumber, year, deletedAt: null } });
        if (!schedule && branch && access.edit && branch.isActive && branch.customerId) schedule = await ensureSchedule(tx, a.orgId, branch.id, { weekNumber, year });
        const visible = schedule && (access.planner || schedule.isPublic);
        const shifts = visible ? (await tx.shift.findMany({ where: { scheduleId: schedule!.id, deletedAt: null }, include: shiftInclude, orderBy: [{ dayOfWeek: "asc" }, { shiftFrom: "asc" }] })).filter(visibleFor(a)) : [];
        const ineffective = access.planner ? await ineffectiveBookings(tx, a.orgId, shifts) : new Set<string>();
        const base = schedule && visible ? schedule : { id: "", isPublic: false, settingsLayout: "LAYOUT_1" as const, showTitle: true, showPauses: true };
        return {
          schedule: { id: base.id, organizationId: a.orgId, branchId, weekNumber, year, isPublic: base.isPublic, settingsLayout: base.settingsLayout, showTitle: base.showTitle, showPauses: base.showPauses, shifts: shifts.map(s => shiftView(s, a, ineffective)) },
          branch: branch ? { id: branch.id, name: branch.name, isActive: branch.isActive, customer: branch.customer, plannable: branch.isActive && !!branch.customerId } : null,
          access,
        };
      }
      // Zusammengefuehrte Sicht: eigene veroeffentlichte Schichten plus alles, was Freigaben zeigen.
      const view = branchIds(a, "VIEW_SCHEDULE"), request = branchIds(a, "REQUEST_SHIFTS");
      const manager = a.role === "MANAGER";
      const scope: Prisma.ShiftWhereInput[] = a.isAdmin ? [{}] : [
        { schedule: { isPublic: true }, bookings: { some: { userId: a.userId } } },
        ...(view?.length ? [{ schedule: { branchId: { in: view }, ...(manager ? {} : { isPublic: true }) } }] : []),
        ...(request?.length ? [{ schedule: { branchId: { in: request }, isPublic: true } }] : []),
      ];
      const shifts = (await tx.shift.findMany({
        where: { deletedAt: null, schedule: { organizationId: a.orgId, weekNumber, year, deletedAt: null }, OR: scope },
        include: shiftInclude,
        orderBy: [{ dayOfWeek: "asc" }, { shiftFrom: "asc" }],
      })).filter(visibleFor(a));
      const planned = shifts.filter(s => can(a, "VIEW_SCHEDULE", s.schedule.branchId) && (a.isAdmin || manager));
      const ineffective = await ineffectiveBookings(tx, a.orgId, planned);
      return {
        schedule: { id: "", organizationId: a.orgId, branchId: null, weekNumber, year, isPublic: shifts.every(s => s.schedule.isPublic), settingsLayout: "LAYOUT_1", showTitle: true, showPauses: true, shifts: shifts.map(s => shiftView(s, a, ineffective)) },
        merged: true,
      };
    });
  });
}
