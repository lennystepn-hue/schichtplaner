import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin, type Access } from "@/lib/access";

type Context = { params: Promise<{ id: string }> };

/** Arbeitsbereiche sind Organisationsdaten; ihre Mitglieder pflegt die Administration. */
async function divisionFor(a: Access, id: string) {
  requireAdmin(a);
  const division = await db.division.findFirst({ where: { id, organizationId: a.orgId, deletedAt: null } });
  if (!division) throw new ApiError("Not found", 404);
  return division;
}

// GET /api/divisions/[id]/members
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const division = await divisionFor(a, (await context.params).id);
    const members = await db.divisionMember.findMany({ where: { divisionId: division.id }, select: { userId: true } });
    const people = await db.organizationMember.findMany({
      where: { organizationId: a.orgId, userId: { in: members.map((m) => m.userId) }, isActive: true },
      select: { role: true, user: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } } },
    });
    return { members: people.map((p) => ({ ...p.user, role: p.role })) };
  });
}

const assignSchema = z.object({ userId: z.string().min(1, "userId ist erforderlich") });

// POST /api/divisions/[id]/members
export async function POST(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const division = await divisionFor(a, (await context.params).id);
    const { userId } = await body(request, assignSchema);
    if (!await db.organizationMember.findFirst({ where: { organizationId: a.orgId, userId, isActive: true } })) throw new ApiError("Benutzer ist kein Mitglied dieser Organisation");
    if (await db.divisionMember.findUnique({ where: { divisionId_userId: { divisionId: division.id, userId } } })) throw new ApiError("Bereits zugewiesen", 409);
    await db.divisionMember.create({ data: { divisionId: division.id, userId } });
    return Response.json({ success: true }, { status: 201 });
  });
}

// DELETE /api/divisions/[id]/members
export async function DELETE(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const division = await divisionFor(a, (await context.params).id);
    const { userId } = await body(request, assignSchema);
    const result = await db.divisionMember.deleteMany({ where: { divisionId: division.id, userId } });
    if (!result.count) throw new ApiError("Not found", 404);
    return { success: true };
  });
}
