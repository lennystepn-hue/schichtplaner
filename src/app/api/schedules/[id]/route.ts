import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { assertCan, branchHolders, requireAccess } from "@/lib/access";
import { notify } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

const updateScheduleSchema = z.object({
  isPublic: z.boolean().optional(),
  settingsLayout: z.enum(["LAYOUT_1", "LAYOUT_2"]).optional(),
  showTitle: z.boolean().optional(),
  showPauses: z.boolean().optional(),
});

/**
 * Veroeffentlichen braucht "Dienstplan veroeffentlichen", die Darstellung
 * "Schichten bearbeiten" - jeweils am Standort dieses Plans.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, updateScheduleSchema);
    const result = await serial(async tx => {
      const existing = await tx.schedule.findFirst({ where: { id, organizationId: a.orgId, deletedAt: null }, include: { branch: { select: { name: true } }, shifts: { where: { deletedAt: null }, select: { bookings: { select: { userId: true } } } } } });
      if (!existing) throw new ApiError("Schichtplan nicht gefunden.", 404);
      if (data.isPublic !== undefined) assertCan(a, "PUBLISH_SCHEDULE", existing.branchId);
      const { isPublic: _public, ...display } = data;
      void _public;
      if (Object.keys(display).length) assertCan(a, "EDIT_SHIFTS", existing.branchId);
      const schedule = await tx.schedule.update({ where: { id }, data });
      const booked = existing.shifts.flatMap(s => s.bookings.map(b => b.userId));
      if (data.isPublic !== undefined && data.isPublic !== existing.isPublic) {
        // Wer den Plan sehen oder Schichten anfragen darf, plus alle Eingeteilten.
        const audience = [...await branchHolders(tx, a.orgId, existing.branchId, ["VIEW_SCHEDULE", "REQUEST_SHIFTS"], false), ...booked];
        const where = existing.branch ? existing.branch.name + ", " : "";
        await notify(tx, a.orgId, a.userId, audience, schedule.isPublic ? "Dienstplan veröffentlicht" : "Dienstplan zurückgezogen", where + "KW " + schedule.weekNumber + "/" + schedule.year + (schedule.isPublic ? " ist jetzt verfügbar." : " wird überarbeitet."));
      }
      return { schedule, booked };
    });
    emitToBranch(a.orgId, result.schedule.branchId, "schedule:updated", result.booked);
    const s = result.schedule;
    return { schedule: { id: s.id, isPublic: s.isPublic, settingsLayout: s.settingsLayout, showTitle: s.showTitle, showPauses: s.showPauses } };
  });
}
