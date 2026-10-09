import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { assertCan, can, requireAccess, type Access } from "@/lib/access";
import { emitToSchedule } from "@/lib/emit";

/** Protokolle mit Namen nur fuer die Planung des Standorts. */
function sessionInclude(withLogs: boolean) {
  return {
    days: { orderBy: { dayOfWeek: "asc" as const } },
    ...(withLogs ? { logs: { orderBy: { loggedAt: "desc" as const }, take: 50, include: { user: { select: { id: true, firstName: true, lastName: true } } } } } : {}),
  };
}

async function scheduleFor(a: Access, scheduleId: string) {
  const schedule = await db.schedule.findFirst({ where: { id: scheduleId, organizationId: a.orgId, deletedAt: null } });
  if (!schedule) throw new ApiError("Schichtplan nicht gefunden.", 404);
  return schedule;
}

async function sessionFor(a: Access, id: string) {
  const session = await db.liveSession.findUnique({ where: { id }, include: { schedule: true } });
  if (!session || session.schedule.organizationId !== a.orgId || session.schedule.deletedAt) throw new ApiError("Live-Session nicht gefunden.", 404);
  assertCan(a, "EDIT_SHIFTS", session.schedule.branchId);
  return session;
}

// GET /api/live?scheduleId=... - Status der Live-Sitzung
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const scheduleId = new URL(request.url).searchParams.get("scheduleId");
    if (!scheduleId) throw new ApiError("scheduleId fehlt.");
    const schedule = await scheduleFor(a, scheduleId);
    const planner = can(a, "VIEW_SCHEDULE", schedule.branchId) && (a.isAdmin || a.role === "MANAGER");
    if (!planner && !(schedule.isPublic && can(a, "REQUEST_SHIFTS", schedule.branchId))) throw new ApiError("Schichtplan nicht gefunden.", 404);
    return { session: await db.liveSession.findUnique({ where: { scheduleId }, include: sessionInclude(planner) }) };
  });
}

// POST /api/live - Live-Modus starten
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { scheduleId } = await body(request, z.object({ scheduleId: z.string().min(1) }));
    const schedule = await scheduleFor(a, scheduleId);
    assertCan(a, "EDIT_SHIFTS", schedule.branchId, "Nur die Planung dieses Standorts kann den Live-Modus starten.");
    const existing = await db.liveSession.findUnique({ where: { scheduleId } });
    if (existing?.isActive) throw new ApiError("Live-Modus ist bereits aktiv", 409);
    if (existing) await db.liveSession.delete({ where: { id: existing.id } });
    const session = await db.liveSession.create({
      data: { scheduleId, isActive: true, days: { create: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, enabled: true })) } },
      include: sessionInclude(true),
    });
    emitToSchedule(scheduleId, "live:started");
    return Response.json({ session }, { status: 201 });
  });
}

const patchSchema = z.object({
  days: z.array(z.object({ dayOfWeek: z.number().min(1).max(7), enabled: z.boolean() })).optional(),
  autoStop: z.boolean().optional(),
  allowExceeds: z.boolean().optional(),
  bookRequests: z.boolean().optional(),
  deadline: z.string().nullable().optional(),
});

// PATCH /api/live?id=... - Tage und Einstellungen aendern
export async function PATCH(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new ApiError("id fehlt.");
    const session = await sessionFor(a, id);
    const { days, deadline, ...settings } = await body(request, patchSchema);
    await db.liveSession.update({ where: { id }, data: { ...settings, ...(deadline !== undefined ? { deadline: deadline ? new Date(deadline) : null } : {}) } });
    for (const day of days ?? []) await db.liveDay.updateMany({ where: { liveSessionId: id, dayOfWeek: day.dayOfWeek }, data: { enabled: day.enabled } });
    emitToSchedule(session.scheduleId, "live:updated");
    return { session: await db.liveSession.findUnique({ where: { id }, include: sessionInclude(true) }) };
  });
}

// DELETE /api/live?id=... - Live-Modus beenden
export async function DELETE(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new ApiError("id fehlt.");
    const session = await sessionFor(a, id);
    await db.liveSession.update({ where: { id }, data: { isActive: false } });
    emitToSchedule(session.scheduleId, "live:stopped");
    return { success: true };
  });
}
