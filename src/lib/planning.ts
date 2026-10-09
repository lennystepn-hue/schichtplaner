import type { Prisma, Shift, Schedule } from "@prisma/client";
import { ApiError } from "./errors";
import { addDate, overlaps, rangeMinutes, shiftRange } from "./berlin";
import { can, type Access } from "./access";

type Tx = Prisma.TransactionClient;

export const publicUser = { id: true, firstName: true, lastName: true, nickname: true, profileImage: true } as const;
export const branchView = { id: true, name: true, address: true, meetingPoint: true, notes: true, positions: true, isActive: true, customer: { select: { id: true, name: true } } } as const;
export const shiftInclude = {
  schedule: { include: { branch: { select: branchView } } },
  division: true,
  bookings: { include: { user: { select: publicUser } } },
} as const;
export type PlannedShift = Shift & { schedule: Schedule };
export type ShiftWithRelations = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;

/** Letzter Kalendertag, den eine Schicht beruehrt (Nachtschichten enden am Folgetag). */
export function lastShiftDate(shift: { dayOfWeek: number; shiftFrom: string; shiftTo: string; schedule: { year: number; weekNumber: number } }) {
  const range = shiftRange(shift);
  return rangeMinutes(shift.shiftFrom, shift.shiftTo) + Number(shift.shiftFrom.slice(0, 2)) * 60 + Number(shift.shiftFrom.slice(3)) > 1440 ? addDate(range.date, 1) : range.date;
}

export async function checkAssignment(tx: Tx, shift: PlannedShift, userId: string, excludeShiftId = shift.id): Promise<string[]> {
  const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: shift.schedule.organizationId, userId } } });
  if (!member?.isActive) return ["Mitarbeiter ist nicht aktiv."];
  const warnings: string[] = [];
  if (shift.schedule.branchId) {
    const branch = await tx.branch.findUnique({ where: { id: shift.schedule.branchId } });
    if (!branch?.isActive) warnings.push("Einsatzort ist nicht aktiv.");
    if (branch?.positions.length && !branch.positions.some(p => p.toLocaleLowerCase("de-DE") === member.position?.toLocaleLowerCase("de-DE"))) warnings.push("Tätigkeit passt nicht zum Einsatzort.");
  }
  const qualifications = new Set(member.qualifications.map(q => q.toLocaleLowerCase("de-DE")));
  if (shift.divisionId) {
    const division = await tx.division.findUnique({ where: { id: shift.divisionId }, include: { members: true } });
    if (division && !division.isSystem && division.members.length && !division.members.some(m => m.userId === userId)) warnings.push("Mitarbeiter gehört nicht zum Arbeitsbereich.");
  }
  if (shift.requiredQualifications.some(q => !qualifications.has(q.toLocaleLowerCase("de-DE")))) warnings.push("Erforderliche Qualifikation fehlt.");
  const range = shiftRange(shift);
  const lastDate = lastShiftDate(shift);
  const absences = await tx.absence.count({ where: { userId, status: "APPROVED", category: { organizationId: shift.schedule.organizationId }, dateFrom: { lte: new Date(lastDate) }, dateTo: { gte: new Date(range.date) } } });
  // Der Grund bleibt Personaldaten; fuer die Planung genuegt "nicht verfuegbar".
  if (absences) warnings.push("Mitarbeiter ist zu diesem Zeitpunkt nicht verfügbar.");
  const bookings = await tx.booking.findMany({ where: { userId, shiftId: { not: excludeShiftId }, shift: { deletedAt: null, schedule: { deletedAt: null, organizationId: shift.schedule.organizationId, year: { gte: shift.schedule.year - 1, lte: shift.schedule.year + 1 } } } }, include: { shift: { include: { schedule: true } } } });
  if (bookings.some(b => overlaps(range, shiftRange(b.shift)))) warnings.push("Zeitliche Überschneidung mit einer anderen Schicht.");
  const windows = await tx.availability.findMany({ where: { organizationId: shift.schedule.organizationId, userId, date: { gte: new Date(addDate(range.date, -1)), lte: new Date(addDate(range.date, 1)) } } });
  const normalized = windows.map(w => { const start = w.date.getTime() / 60000 + Number(w.timeFrom.slice(0, 2)) * 60 + Number(w.timeFrom.slice(3)); return { ...w, start, end: start + rangeMinutes(w.timeFrom, w.timeTo) }; });
  if (normalized.some(w => !w.available && overlaps(range, w))) warnings.push("Als nicht verfügbar eingetragen.");
  for (const day of [range.date, ...(lastDate !== range.date ? [lastDate] : [])]) {
    const start = Date.parse(day) / 60000, end = start + 1440;
    const segment = { start: Math.max(start, range.start), end: Math.min(end, range.end) };
    const available = normalized.filter(w => w.available && overlaps({ start, end }, w)).sort((a,b) => a.start - b.start);
    if (available.length) {
      let covered = segment.start;
      for (const w of available) if (w.start <= covered) covered = Math.max(covered, w.end);
      if (covered < segment.end) warnings.push("Schicht liegt außerhalb der eingetragenen Verfügbarkeit.");
    }
  }
  return warnings;
}

/**
 * Eine Nachricht je Empfaenger: niemand erfaehrt ueber eine Benachrichtigung,
 * wer sie sonst noch bekommen hat.
 */
export async function notify(tx: Tx, organizationId: string, senderId: string, recipientIds: string[], subject: string, text: string, shiftId?: string) {
  const ids = [...new Set(recipientIds)].filter(id => id !== senderId);
  for (const userId of ids) await tx.message.create({ data: { organizationId, senderId, subject, body: text, shiftId, recipients: { create: [{ userId }] } } });
  return ids;
}

/** Wer beim Besetzen zur Auswahl steht: Admins alle, Manager nur zugeordnete Personen mit "Einplanen". */
export function assignableUserIds(a: Access): string[] | null {
  if (a.isAdmin) return null;
  return [...a.staff].filter(([, s]) => s.rights.has("ASSIGN_SHIFTS")).map(([userId]) => userId);
}

export async function assign(tx: Tx, a: Access, shiftId: string, userId: string) {
  const shift = await tx.shift.findFirst({ where: { id: shiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: shiftInclude });
  if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
  if (shift.bookings.some(b => b.userId === userId)) throw new ApiError("Bereits zugewiesen.", 409);
  if (shift.bookings.length >= shift.maxEmployees) throw new ApiError("Schicht ist bereits besetzt.", 409);
  const warnings = await checkAssignment(tx, shift, userId);
  if (warnings.length) throw new ApiError(warnings.join(" "), 409);
  const booking = await tx.booking.create({ data: { shiftId, userId, bookedBy: a.userId }, include: { user: { select: publicUser } } });
  if (shift.schedule.isPublic) await notify(tx, a.orgId, a.userId, [userId], "Neue Schicht", shiftRange(shift).date + ": " + shift.shiftFrom + "–" + shift.shiftTo + ". Bitte bestätigen.", shiftId);
  return { booking, shift };
}

/**
 * Buchungen, die nicht wirksam sind: Konto nicht mehr aktiv oder eine
 * genehmigte Abwesenheit ueberschneidet sich mit dem Schichttag.
 */
export async function ineffectiveBookings(tx: Tx, orgId: string, shifts: ShiftWithRelations[]): Promise<Set<string>> {
  const userIds = [...new Set(shifts.flatMap(s => s.bookings.map(b => b.userId)))];
  if (!userIds.length) return new Set();
  const dates = shifts.flatMap(s => [shiftRange(s).date, lastShiftDate(s)]).sort();
  const [inactive, absences] = await Promise.all([
    tx.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: userIds }, isActive: false }, select: { userId: true } }),
    tx.absence.findMany({ where: { userId: { in: userIds }, status: "APPROVED", category: { organizationId: orgId }, dateFrom: { lte: new Date(dates[dates.length - 1]) }, dateTo: { gte: new Date(dates[0]) } }, select: { userId: true, dateFrom: true, dateTo: true } }),
  ]);
  const gone = new Set(inactive.map(m => m.userId));
  const result = new Set<string>();
  for (const shift of shifts) {
    const first = shiftRange(shift).date, last = lastShiftDate(shift);
    for (const b of shift.bookings) {
      const absent = absences.some(x => x.userId === b.userId && x.dateFrom.toISOString().slice(0, 10) <= last && x.dateTo.toISOString().slice(0, 10) >= first);
      if (gone.has(b.userId) || absent) result.add(b.id);
    }
  }
  return result;
}

/**
 * Schicht fuer die Ausgabe - nur die Felder, die die betrachtende Person
 * sehen darf. Namen anderer Eingeteilter nur mit "Dienstplan ansehen";
 * Bestaetigungs- und Verfuegbarkeitsstatus nur fuer die Planung.
 */
export function shiftView(shift: ShiftWithRelations, a: Access, ineffective: Set<string> = new Set()) {
  const branchId = shift.schedule.branchId;
  const fullPlan = can(a, "VIEW_SCHEDULE", branchId);
  const planner = fullPlan && (a.isAdmin || a.role === "MANAGER");
  const effective = shift.bookings.filter(b => !ineffective.has(b.id)).length;
  const range = shiftRange(shift);
  const branch = shift.schedule.branch;
  return {
    id: shift.id, scheduleId: shift.scheduleId, divisionId: shift.divisionId, dayOfWeek: shift.dayOfWeek,
    shiftFrom: shift.shiftFrom, shiftTo: shift.shiftTo, maxEmployees: shift.maxEmployees,
    pauseOption: shift.pauseOption, pauseValue: shift.pauseValue, title: shift.title, description: shift.description,
    requiredQualifications: shift.requiredQualifications, createdAt: shift.createdAt, deletedAt: shift.deletedAt,
    date: range.date, endsNextDay: rangeMinutes(shift.shiftFrom, shift.shiftTo) + Number(shift.shiftFrom.slice(0, 2)) * 60 + Number(shift.shiftFrom.slice(3)) > 1440,
    isPublic: shift.schedule.isPublic,
    branchId,
    branch: branch ? { id: branch.id, name: branch.name, address: branch.address, meetingPoint: branch.meetingPoint, notes: branch.notes, customer: branch.customer } : null,
    division: shift.division ? { id: shift.division.id, title: shift.division.title, color: shift.division.color } : null,
    bookings: shift.bookings.filter(b => fullPlan || b.userId === a.userId).map(b => ({
      id: b.id, shiftId: b.shiftId, userId: b.userId, bookedAt: b.bookedAt, user: b.user,
      confirmedAt: planner || b.userId === a.userId ? b.confirmedAt : null,
      ...(planner ? { unavailable: ineffective.has(b.id) } : {}),
    })),
    occupiedCount: shift.bookings.length,
    missing: Math.max(0, shift.maxEmployees - (planner ? effective : shift.bookings.length)),
    can: {
      edit: can(a, "EDIT_SHIFTS", branchId),
      handle: can(a, "HANDLE_REQUESTS", branchId),
      request: shift.schedule.isPublic && can(a, "REQUEST_SHIFTS", branchId),
    },
  };
}
export type ShiftView = ReturnType<typeof shiftView>;
