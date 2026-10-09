import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { branchHolders, can, requireAccess } from "@/lib/access";
import { assign, checkAssignment, notify, shiftInclude } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, z.object({ state: z.enum(["ACCEPTED", "DECLINED"]).optional(), volunteer: z.boolean().optional() }));
    const result = await serial(async tx => {
      const r = await tx.modRequest.findFirst({ where: { id, shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true } } }, include: { shift: { include: shiftInclude } } });
      const branchId = r?.shift.schedule.branchId ?? null;
      const handler = can(a, "HANDLE_REQUESTS", branchId);
      // Wer den Antrag weder stellen, uebernehmen noch entscheiden darf, erfaehrt nicht, dass es ihn gibt.
      if (!r || (!handler && r.userId !== a.userId && r.targetUserId !== a.userId && !can(a, "REQUEST_SHIFTS", branchId))) throw new ApiError("Antrag nicht gefunden.", 404);
      if (r.state !== "OPEN") throw new ApiError("Antrag wurde bereits bearbeitet.", 409);
      if (data.volunteer) {
        if (!can(a, "REQUEST_SHIFTS", branchId)) throw new ApiError("Antrag nicht gefunden.", 404);
        if (r.kind !== "SWAP" || r.userId === a.userId || r.targetUserId) throw new ApiError("Dieses Tauschangebot ist nicht verfügbar.", 409);
        const warnings = await checkAssignment(tx, r.shift, a.userId);
        if (r.shift.bookings.some(b => b.userId === a.userId)) warnings.push("Bereits zugewiesen.");
        if (warnings.length) throw new ApiError(warnings.join(" "), 409);
        const updated = await tx.modRequest.update({ where: { id }, data: { targetUserId: a.userId } });
        await notify(tx, a.orgId, a.userId, await branchHolders(tx, a.orgId, branchId, ["HANDLE_REQUESTS"]), "Schichttausch zur Freigabe", "Jemand möchte die angebotene Schicht übernehmen.", r.shiftId);
        return { updated, branchId, affected: [a.userId, r.userId] };
      }
      if (!handler || !data.state) throw new ApiError("Nur die Planung dieses Standorts darf Anträge entscheiden.", 403);
      let userId = r.userId;
      if (data.state === "ACCEPTED") {
        if (r.kind === "SWAP") {
          if (!r.targetUserId) throw new ApiError("Es fehlt eine bestätigte Übernahme.", 409);
          const source = r.shift.bookings.find(b => b.userId === r.userId);
          if (!source) throw new ApiError("Ursprüngliche Zuweisung besteht nicht mehr.", 409);
          await tx.booking.delete({ where: { id: source.id } });
          userId = r.targetUserId;
        }
        await assign(tx, a, r.shiftId, userId);
      }
      const updated = await tx.modRequest.update({ where: { id }, data: { state: data.state } });
      const affected = [r.userId, ...(r.targetUserId ? [r.targetUserId] : [])];
      await notify(tx, a.orgId, a.userId, affected, data.state === "ACCEPTED" ? "Schichtantrag genehmigt" : "Schichtantrag abgelehnt", "Der Antrag zu deiner Schicht wurde bearbeitet.", r.shiftId);
      return { updated, branchId, affected };
    });
    emitToBranch(a.orgId, result.branchId, "booking:changed", result.affected);
    const u = result.updated;
    return { request: { id: u.id, kind: u.kind, state: u.state, shiftId: u.shiftId, targetUserId: u.targetUserId === a.userId || can(a, "HANDLE_REQUESTS", result.branchId) ? u.targetUserId : null } };
  });
}

export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const branchId = await serial(async tx => {
      const r = await tx.modRequest.findFirst({ where: { id, state: "OPEN", shift: { schedule: { organizationId: a.orgId } } }, include: { shift: { include: { schedule: true } } } });
      if (!r || (r.userId !== a.userId && !can(a, "HANDLE_REQUESTS", r.shift.schedule.branchId))) throw new ApiError("Offener Antrag nicht gefunden.", 404);
      await tx.modRequest.delete({ where: { id } });
      return r.shift.schedule.branchId;
    });
    emitToBranch(a.orgId, branchId, "booking:changed", [a.userId]);
    return { success: true };
  });
}
