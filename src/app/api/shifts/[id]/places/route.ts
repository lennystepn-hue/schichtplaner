import { api, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess } from "@/lib/access";
import { emitToBranch } from "@/lib/emit";

type Context = { params: Promise<{ id: string }> };

/** Benoetigte Plaetze einer Schicht um eins erhoehen oder senken. */
async function change(context: Context, delta: 1 | -1) {
  const a = await requireAccess();
  const { id } = await context.params;
  const result = await serial(async tx => {
    const shift = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: { schedule: true, _count: { select: { bookings: true } } } });
    if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
    assertCan(a, "EDIT_SHIFTS", shift.schedule.branchId);
    const maxEmployees = shift.maxEmployees + delta;
    if (maxEmployees < 1) throw new ApiError("Mindestens 1 Platz muss vorhanden sein.");
    if (maxEmployees > 100) throw new ApiError("Höchstens 100 Plätze.");
    if (shift._count.bookings > maxEmployees) throw new ApiError("Platz kann nicht entfernt werden – zu viele Zuweisungen.", 409);
    const updated = await tx.shift.update({ where: { id }, data: { maxEmployees }, select: { id: true, maxEmployees: true } });
    return { shift: updated, branchId: shift.schedule.branchId };
  });
  emitToBranch(a.orgId, result.branchId, "schedule:updated");
  return { shift: result.shift };
}

export async function POST(_request: Request, context: Context) {
  return api(() => change(context, 1));
}

export async function DELETE(_request: Request, context: Context) {
  return api(() => change(context, -1));
}
