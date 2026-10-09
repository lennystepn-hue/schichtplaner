import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { validDate, isoWeek } from "@/lib/berlin";
import { assertCan, requireAccess } from "@/lib/access";
import { createShifts, ensureSchedule, plannableBranch, shiftInput } from "@/lib/shift-service";
import { shiftView } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

/** Kopie an ein anderes Datum - immer am Standort der Ausgangsschicht. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, z.object({ date: z.string().refine(validDate, "Ungültiges Datum.") }));
    const shifts = await serial(async tx => {
      const source = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: { schedule: true } });
      if (!source) throw new ApiError("Schicht nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", source.schedule.branchId);
      if (!source.schedule.branchId) throw new ApiError("Schichten ohne Standort können nicht kopiert werden. Bitte zuerst einem Standort zuordnen.", 409);
      const branch = await plannableBranch(tx, a, source.schedule.branchId);
      const schedule = await ensureSchedule(tx, a.orgId, branch.id, isoWeek(data.date));
      const input = shiftInput.parse({
        scheduleId: schedule.id, divisionId: source.divisionId, dayOfWeek: ((new Date(data.date).getUTCDay() + 6) % 7) + 1,
        shiftFrom: source.shiftFrom, shiftTo: source.shiftTo, maxEmployees: source.maxEmployees, pauseOption: source.pauseOption,
        pauseValue: source.pauseValue, title: source.title, description: source.description, requiredQualifications: source.requiredQualifications,
      });
      return createShifts(tx, a, input);
    });
    emitToBranch(a.orgId, shifts[0]?.schedule.branchId ?? null, "schedule:updated");
    return { shifts: shifts.map(s => shiftView(s, a)) };
  });
}
