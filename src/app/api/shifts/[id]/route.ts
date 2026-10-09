import { api, body, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess } from "@/lib/access";
import { shiftPatch, updateShift } from "@/lib/shift-service";
import { notify, shiftInclude, shiftView } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, shiftPatch);
    const { shift, previousBranchId } = await serial(tx => updateShift(tx, a, id, data));
    const affected = shift.bookings.map(b => b.userId);
    emitToBranch(a.orgId, shift.schedule.branchId, "schedule:updated", affected);
    if (previousBranchId !== shift.schedule.branchId) emitToBranch(a.orgId, previousBranchId, "schedule:updated");
    return { shift: shiftView(shift, a) };
  });
}

export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const shift = await serial(async tx => {
      const shift = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: shiftInclude });
      if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", shift.schedule.branchId);
      if (shift.schedule.isPublic) await notify(tx, a.orgId, a.userId, shift.bookings.map(b => b.userId), "Schicht abgesagt", "Die Schicht " + (shift.title || "") + " von " + shift.shiftFrom + " bis " + shift.shiftTo + " wurde abgesagt.", id);
      await tx.modRequest.updateMany({ where: { shiftId: id, state: "OPEN" }, data: { state: "DECLINED" } });
      await tx.booking.deleteMany({ where: { shiftId: id } });
      await tx.shift.update({ where: { id }, data: { deletedAt: new Date() } });
      return shift;
    });
    emitToBranch(a.orgId, shift.schedule.branchId, "schedule:updated", shift.bookings.map(b => b.userId));
    return { success: true };
  });
}
