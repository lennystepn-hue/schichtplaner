import { z } from "zod";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess } from "@/lib/access";
import { assign, assignableUserIds, notify } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

const input = z.object({ shiftId: z.string().min(1), userId: z.string().min(1) });

/** Besetzen: Recht "Schichten bearbeiten" am Standort und - fuer Manager - eine Zuordnung mit "Einplanen". */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, input);
    const { booking, shift } = await serial(async tx => {
      const target = await tx.shift.findFirst({ where: { id: data.shiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: { schedule: true } });
      if (!target) throw new ApiError("Schicht nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", target.schedule.branchId);
      const allowed = assignableUserIds(a);
      if (allowed && !allowed.includes(data.userId)) throw new ApiError("Diese Person ist dir nicht zum Einplanen zugeordnet.", 403);
      return assign(tx, a, data.shiftId, data.userId);
    });
    emitToBranch(a.orgId, shift.schedule.branchId, "booking:changed", [data.userId]);
    return { booking };
  });
}

export async function DELETE(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, input);
    const branchId = await serial(async tx => {
      const booking = await tx.booking.findFirst({ where: { ...data, shift: { schedule: { organizationId: a.orgId } } }, include: { shift: { include: { schedule: true } } } });
      if (!booking) throw new ApiError("Zuweisung nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", booking.shift.schedule.branchId);
      await tx.booking.delete({ where: { id: booking.id } });
      if (booking.shift.schedule.isPublic) await notify(tx, a.orgId, a.userId, [data.userId], "Schichtzuweisung aufgehoben", "Deine Zuweisung wurde aufgehoben.", data.shiftId);
      return booking.shift.schedule.branchId;
    });
    emitToBranch(a.orgId, branchId, "booking:changed", [data.userId]);
    return { success: true };
  });
}

/** Eigene, veroeffentlichte Schicht bestaetigen. */
export async function PATCH(request: Request) {
  return api(async () => {
    const member = await requireMember();
    const data = await body(request, z.object({ shiftId: z.string() }));
    const result = await serial(async tx => {
      const booking = await tx.booking.findFirst({ where: { shiftId: data.shiftId, userId: member.userId, shift: { deletedAt: null, schedule: { organizationId: member.organizationId, isPublic: true, deletedAt: null } } }, include: { shift: { include: { schedule: true } } } });
      if (!booking) throw new ApiError("Schicht nicht gefunden.", 404);
      const updated = await tx.booking.update({ where: { id: booking.id }, data: { confirmedAt: new Date() } });
      return { booking: updated, branchId: booking.shift.schedule.branchId };
    });
    emitToBranch(member.organizationId, result.branchId, "booking:changed", [member.userId]);
    return { booking: { id: result.booking.id, shiftId: result.booking.shiftId, userId: result.booking.userId, confirmedAt: result.booking.confirmedAt } };
  });
}
