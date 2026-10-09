import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { assertCan, can, requireAccess, type Access } from "@/lib/access";

type Context = { params: Promise<{ id: string }> };

async function scheduleFor(a: Access, id: string) {
  const schedule = await db.schedule.findFirst({ where: { id, organizationId: a.orgId, deletedAt: null } });
  if (!schedule) throw new ApiError("Schichtplan nicht gefunden.", 404);
  return schedule;
}

/**
 * Lesen: die Planung des Standorts (auch Entwuerfe) oder - bei
 * veroeffentlichten Plaenen - wer dort Schichten sehen darf oder eingeteilt ist.
 */
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const schedule = await scheduleFor(a, (await context.params).id);
    const planner = can(a, "VIEW_SCHEDULE", schedule.branchId) && (a.isAdmin || a.role === "MANAGER");
    const reader = schedule.isPublic && (can(a, "REQUEST_SHIFTS", schedule.branchId)
      || !!await db.booking.findFirst({ where: { userId: a.userId, shift: { scheduleId: schedule.id, deletedAt: null } }, select: { id: true } }));
    if (!planner && !reader) throw new ApiError("Schichtplan nicht gefunden.", 404);
    const briefing = await db.briefing.findFirst({ where: { scheduleId: schedule.id }, orderBy: { updatedAt: "desc" } });
    return { briefing: briefing ?? null };
  });
}

const briefingSchema = z.object({ text: z.string().min(1, "Text darf nicht leer sein").max(5000) });

export async function POST(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const schedule = await scheduleFor(a, (await context.params).id);
    assertCan(a, "EDIT_SHIFTS", schedule.branchId);
    const { text } = await body(request, briefingSchema);
    const existing = await db.briefing.findFirst({ where: { scheduleId: schedule.id }, orderBy: { updatedAt: "desc" } });
    const briefing = existing
      ? await db.briefing.update({ where: { id: existing.id }, data: { text } })
      : await db.briefing.create({ data: { scheduleId: schedule.id, text } });
    return { briefing };
  });
}

export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const schedule = await scheduleFor(a, (await context.params).id);
    assertCan(a, "EDIT_SHIFTS", schedule.branchId);
    await db.briefing.deleteMany({ where: { scheduleId: schedule.id } });
    return { success: true };
  });
}
