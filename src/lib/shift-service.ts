import { z } from "zod";
import type { Prisma, Schedule } from "@prisma/client";
import { ApiError } from "./errors";
import { timeSchema } from "./api";
import { checkAssignment, notify, shiftInclude } from "./planning";
import { isoWeek, weekDate, addDate, shiftRange } from "./berlin";
import { assertCan, branchHolders, type Access } from "./access";

type Tx = Prisma.TransactionClient;

const shiftFields = {
  divisionId: z.string().nullable().optional(), branchId: z.string().nullable().optional(),
  dayOfWeek: z.number().int().min(1).max(7), shiftFrom: timeSchema, shiftTo: timeSchema,
  maxEmployees: z.number().int().min(1).max(100), pauseOption: z.enum(["PER_HOUR", "PER_SHIFT"]),
  pauseValue: z.number().int().min(0).max(120), title: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(), requiredQualifications: z.array(z.string().trim().min(1).max(100)).max(30),
};
export const shiftInput = z.object({
  ...shiftFields, scheduleId: z.string().min(1),
  pauseOption: shiftFields.pauseOption.default("PER_SHIFT"), pauseValue: shiftFields.pauseValue.default(0),
  requiredQualifications: shiftFields.requiredQualifications.default([]),
  repeatDays: z.array(z.number().int().min(1).max(7)).max(7).optional(), repeatWeeks: z.number().int().min(1).max(52).default(1)
});
/** Aenderung einzelner Felder - ohne Standardwerte (Zod setzt sie sonst auch bei .partial()). */
export const shiftPatch = z.object(shiftFields).partial();

/** Ein Standort, an dem geplant werden darf: gleiche Organisation, Recht, aktiv, einem Kunden zugeordnet. */
export async function plannableBranch(tx: Tx, a: Access, branchId: string) {
  const branch = await tx.branch.findFirst({ where: { id: branchId, organizationId: a.orgId } });
  if (!branch) throw new ApiError("Standort nicht gefunden.", 404);
  assertCan(a, "EDIT_SHIFTS", branch.id);
  if (!branch.isActive) throw new ApiError("Der Standort ist nicht aktiv.", 409);
  if (!branch.customerId) throw new ApiError("Der Standort ist noch keinem Kunden zugeordnet. Bitte zuerst unter Einsatzorte einen Kunden festlegen.", 409);
  return branch;
}

/** Wochenplan eines Standorts; wird bei Bedarf angelegt. */
export async function ensureSchedule(tx: Tx, orgId: string, branchId: string, week: { year: number; weekNumber: number }, template?: Pick<Schedule, "isPublic" | "settingsLayout" | "showTitle" | "showPauses">): Promise<Schedule> {
  const found = await tx.schedule.findFirst({ where: { organizationId: orgId, branchId, weekNumber: week.weekNumber, year: week.year, deletedAt: null } });
  if (found) return found;
  const settings = template ? { isPublic: template.isPublic, settingsLayout: template.settingsLayout, showTitle: template.showTitle, showPauses: template.showPauses } : {};
  return tx.schedule.create({ data: { organizationId: orgId, branchId, weekNumber: week.weekNumber, year: week.year, ...settings } });
}

async function validateDivision(tx: Tx, orgId: string, divisionId?: string | null) {
  if (divisionId && !await tx.division.findFirst({ where: { id: divisionId, organizationId: orgId, deletedAt: null } })) throw new ApiError("Arbeitsbereich nicht gefunden.", 404);
}

export async function createShifts(tx: Tx, a: Access, data: z.output<typeof shiftInput>) {
  if (data.shiftFrom === data.shiftTo) throw new ApiError("Beginn und Ende müssen unterschiedlich sein.");
  const schedule = await tx.schedule.findFirst({ where: { id: data.scheduleId, organizationId: a.orgId, deletedAt: null } });
  if (!schedule) throw new ApiError("Plan nicht gefunden.", 404);
  if (!schedule.branchId) throw new ApiError("Neue Schichten brauchen einen Standort. Bitte den Plan eines Standorts öffnen.", 409);
  if (data.branchId && data.branchId !== schedule.branchId) throw new ApiError("Der angegebene Standort passt nicht zum Plan.", 400);
  const branch = await plannableBranch(tx, a, schedule.branchId);
  await validateDivision(tx, a.orgId, data.divisionId);
  const { repeatDays, repeatWeeks, branchId: _branchId, ...base } = data;
  void _branchId;
  const days = [...new Set(repeatDays?.length ? repeatDays : [data.dayOfWeek])];
  const shifts = [];
  const audience = await branchHolders(tx, a.orgId, branch.id, ["REQUEST_SHIFTS"], false);
  for (let w = 0; w < repeatWeeks; w++) {
    const target = w === 0 ? schedule : await ensureSchedule(tx, a.orgId, branch.id, isoWeek(addDate(weekDate(schedule.year, schedule.weekNumber), w * 7)));
    for (const dayOfWeek of days) shifts.push(await tx.shift.create({ data: { ...base, scheduleId: target.id, dayOfWeek }, include: shiftInclude }));
    if (target.isPublic) await notify(tx, a.orgId, a.userId, audience, "Neue offene Schichten", branch.name + ": Im veröffentlichten Dienstplan KW " + target.weekNumber + "/" + target.year + " gibt es neue Schichten.");
  }
  return shifts;
}

export async function updateShift(tx: Tx, a: Access, id: string, data: z.output<typeof shiftPatch>) {
  const existing = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: shiftInclude });
  if (!existing) throw new ApiError("Schicht nicht gefunden.", 404);
  assertCan(a, "EDIT_SHIFTS", existing.schedule.branchId);
  await validateDivision(tx, a.orgId, data.divisionId);
  const { branchId, ...fields } = data;
  let schedule: Schedule = existing.schedule;
  if (branchId !== undefined && branchId !== existing.schedule.branchId) {
    // Umzug an einen anderen Standort: Recht an beiden Standorten, gleiche Woche.
    if (!branchId) throw new ApiError("Eine Schicht braucht einen Standort.", 400);
    const target = await plannableBranch(tx, a, branchId);
    schedule = await ensureSchedule(tx, a.orgId, target.id, existing.schedule, existing.schedule);
  }
  const effective = { ...existing, ...fields, scheduleId: schedule.id, schedule };
  if (effective.shiftFrom === effective.shiftTo) throw new ApiError("Beginn und Ende müssen unterschiedlich sein.");
  if (effective.maxEmployees < existing.bookings.length) throw new ApiError("Die Schicht hat mehr Zuweisungen als Plätze.", 409);
  for (const booking of existing.bookings) {
    const warnings = await checkAssignment(tx, effective, booking.userId);
    if (warnings.length) throw new ApiError(booking.user.firstName + ": " + warnings.join(" "), 409);
  }
  const shift = await tx.shift.update({ where: { id }, data: { ...fields, scheduleId: schedule.id }, include: shiftInclude });
  await tx.booking.updateMany({ where: { shiftId: id }, data: { confirmedAt: null } });
  if (existing.schedule.isPublic || schedule.isPublic) await notify(tx, a.orgId, a.userId, existing.bookings.map(b => b.userId), "Schicht geändert – bitte bestätigen", shiftRange(shift).date + ", " + shift.shiftFrom + "–" + shift.shiftTo + ". Bitte prüfe Zeit und Einsatzort.", id);
  return { shift, previousBranchId: existing.schedule.branchId };
}
