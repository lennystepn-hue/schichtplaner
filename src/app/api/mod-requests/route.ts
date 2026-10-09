import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { api, body, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { branchHolders, branchIds, can, requireAccess, type Access } from "@/lib/access";
import { checkAssignment, notify, shiftInclude, shiftView, type ShiftWithRelations } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

type RequestRow = Prisma.ModRequestGetPayload<{ include: { user: { select: { id: true; firstName: true; lastName: true } }; shift: { include: typeof shiftInclude } } }>;

/** Antrag fuer die Ausgabe - Namen und Notizen nur fuer Beteiligte und die Planung. */
function requestView(r: RequestRow, a: Access, canVolunteer: boolean) {
  const branchId = r.shift.schedule.branchId;
  const handler = can(a, "HANDLE_REQUESTS", branchId);
  const own = r.userId === a.userId;
  const named = handler || own || can(a, "VIEW_SCHEDULE", branchId);
  return {
    id: r.id, kind: r.kind, state: r.state, sentAt: r.sentAt, shiftId: r.shiftId, deadline: r.deadline,
    note: handler || own ? r.note : null,
    userId: handler || own ? r.userId : null,
    targetUserId: handler || own || r.targetUserId === a.userId ? r.targetUserId : null,
    user: named ? { firstName: r.user.firstName, lastName: r.user.lastName } : null,
    shift: shiftView(r.shift as ShiftWithRelations, a),
    can: { decide: handler && r.state === "OPEN", volunteer: canVolunteer, withdraw: own && r.state === "OPEN" },
  };
}

export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams;
    const handle = branchIds(a, "HANDLE_REQUESTS"), offers = branchIds(a, "REQUEST_SHIFTS");
    const scope: Prisma.ModRequestWhereInput[] = [
      { userId: a.userId },
      { targetUserId: a.userId },
      ...(handle === null || handle.length ? [{ shift: { schedule: handle ? { branchId: { in: handle } } : {} } }] : []),
      ...(offers?.length ? [{ kind: "SWAP", state: "OPEN" as const, targetUserId: null, shift: { schedule: { branchId: { in: offers }, isPublic: true } } }] : []),
    ];
    const rows = await db.modRequest.findMany({
      where: {
        ...(q.get("shiftId") ? { shiftId: q.get("shiftId")! } : {}),
        shift: { deletedAt: null, ...(q.get("scheduleId") ? { scheduleId: q.get("scheduleId")! } : {}), schedule: { organizationId: a.orgId, deletedAt: null } },
        OR: scope,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true } }, shift: { include: shiftInclude } },
      orderBy: { sentAt: "desc" },
      take: 250,
    });
    const requests = [];
    for (const r of rows) {
      const branchId = r.shift.schedule.branchId;
      const involved = r.userId === a.userId || r.targetUserId === a.userId || can(a, "HANDLE_REQUESTS", branchId);
      // Fremde Tauschangebote nur, wenn man sie wirklich uebernehmen koennte.
      const offer = r.kind === "SWAP" && r.state === "OPEN" && !r.targetUserId && r.userId !== a.userId && r.shift.schedule.isPublic && can(a, "REQUEST_SHIFTS", branchId)
        && !r.shift.bookings.some(b => b.userId === a.userId) && !(await checkAssignment(db, r.shift, a.userId)).length;
      if (involved || offer) requests.push(requestView(r, a, offer));
    }
    return { requests };
  });
}

export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, z.object({ shiftId: z.string(), note: z.string().max(1000).optional(), kind: z.enum(["TAKEOVER", "SWAP"]).default("TAKEOVER") }));
    const result = await serial(async tx => {
      const shift = await tx.shift.findFirst({ where: { id: data.shiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true } }, include: shiftInclude });
      if (!shift) throw new ApiError("Veröffentlichte Schicht nicht gefunden.", 404);
      const branchId = shift.schedule.branchId;
      const ownBooking = shift.bookings.some(b => b.userId === a.userId);
      if (data.kind === "SWAP" && !ownBooking) throw new ApiError("Nur eigene Schichten können zum Tausch angeboten werden.", 403);
      if (data.kind === "TAKEOVER") {
        // Offene Schichten anfragen setzt eine Freigabe fuer den Standort voraus.
        if (!can(a, "REQUEST_SHIFTS", branchId)) throw new ApiError("Veröffentlichte Schicht nicht gefunden.", 404);
        if (ownBooking || shift.bookings.length >= shift.maxEmployees) throw new ApiError("Schicht ist bereits besetzt.", 409);
        const warnings = await checkAssignment(tx, shift, a.userId);
        if (warnings.length) throw new ApiError(warnings.join(" "), 409);
      }
      const old = await tx.modRequest.findUnique({ where: { shiftId_userId: { shiftId: data.shiftId, userId: a.userId } } });
      if (old?.state === "OPEN") throw new ApiError("Es besteht bereits ein offener Antrag.", 409);
      const record = await tx.modRequest.upsert({ where: { shiftId_userId: { shiftId: data.shiftId, userId: a.userId } }, create: { ...data, userId: a.userId }, update: { kind: data.kind, note: data.note, state: "OPEN", targetUserId: null, sentAt: new Date() } });
      await notify(tx, a.orgId, a.userId, await branchHolders(tx, a.orgId, branchId, ["HANDLE_REQUESTS"]), "Neuer Schichtantrag", data.kind === "SWAP" ? "Eine Schicht wurde zum Tausch angeboten." : "Eine offene Schicht wurde angefragt.", shift.id);
      return { record, branchId };
    });
    emitToBranch(a.orgId, result.branchId, "booking:changed", [a.userId]);
    return { request: { id: result.record.id, kind: result.record.kind, state: result.record.state, shiftId: result.record.shiftId } };
  });
}
