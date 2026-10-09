import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { canStaff, requireAccess, requireAdmin } from "@/lib/access";
import { staffMember } from "@/lib/staff";
import { refreshRealtime } from "@/lib/emit";

type Context = { params: Promise<{ id: string }> };

// GET /api/employees/[id] - Personalprofil: Admins, die Person selbst oder "Personalprofil ansehen"
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const target = await staffMember(a, (await context.params).id, "VIEW_PROFILE", true);
    const employee = await db.organizationMember.findUniqueOrThrow({
      where: { id: target.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, nickname: true, profileImage: true, createdAt: true } } },
    });
    const self = employee.userId === a.userId;
    // "Personalprofil ansehen": Kontakt, Taetigkeit, Qualifikationen. Vertragsdaten
    // (Beschaeftigungsart, Sollstunden) nur mit "Stammdaten bearbeiten".
    const contract = a.isAdmin || self || canStaff(a, "EDIT_PROFILE", employee.userId);
    return {
      id: employee.id, userId: employee.userId, role: employee.role, isActive: employee.isActive, isActivated: employee.isActivated, joinedAt: employee.joinedAt,
      position: employee.position, qualifications: employee.qualifications,
      employmentType: contract ? employee.employmentType : null,
      targetHoursPerWeek: contract ? employee.targetHoursPerWeek : null,
      user: employee.user,
      permissions: {
        editContact: a.isAdmin || self,
        editPersonnel: canStaff(a, "EDIT_PROFILE", employee.userId),
        notes: canStaff(a, "EDIT_PROFILE", employee.userId),
        admin: a.isAdmin && !self && employee.role !== "OWNER",
        manageAccess: a.isAdmin && (employee.role === "MANAGER" || employee.role === "EMPLOYEE"),
      },
    };
  });
}

const updateEmployeeSchema = z.object({
  position: z.string().max(100).optional(),
  employmentType: z.string().max(100).optional(),
  targetHoursPerWeek: z.number().min(0).max(80).optional(),
  qualifications: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  isActive: z.boolean().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  nickname: z.string().optional(),
});

// PATCH /api/employees/[id] - Kontaktdaten: Admin oder selbst; Stammdaten: Admin oder "Stammdaten bearbeiten"; Status: Admin
export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, updateEmployeeSchema);
    const target = await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId } });
    const self = target?.userId === a.userId;
    if (!target || (!a.isAdmin && !self && !canStaff(a, "VIEW_PROFILE", target.userId))) throw new ApiError("Nicht gefunden.", 404);
    const { position, employmentType, targetHoursPerWeek, qualifications, isActive } = data;
    const personnel = [position, employmentType, targetHoursPerWeek, qualifications].some((v) => v !== undefined);
    const contact = [data.firstName, data.lastName, data.email, data.phone, data.nickname].some((v) => v !== undefined);
    if (personnel && !canStaff(a, "EDIT_PROFILE", target.userId)) throw new ApiError("Stammdaten darf nur ändern, wer dafür freigegeben ist.", 403);
    if (contact && !a.isAdmin && !self) throw new ApiError("Kontaktdaten ändern nur die Person selbst oder die Administration.", 403);
    if (isActive !== undefined) {
      if (!a.isAdmin) throw new ApiError("Nur die Administration aktiviert oder deaktiviert Konten.", 403);
      if (isActive === false && (self || target.role === "OWNER")) throw new ApiError("Eigenes Konto und Inhaber können nicht deaktiviert werden.", 400);
    }
    if (data.email && await db.user.findFirst({ where: { email: data.email.toLowerCase(), NOT: { id: target.userId } } })) throw new ApiError("Email already in use", 409);
    const updated = await db.$transaction(async (tx) => {
      if (personnel || isActive !== undefined) await tx.organizationMember.update({ where: { id }, data: { position, employmentType, targetHoursPerWeek, qualifications, isActive } });
      return tx.user.update({
        where: { id: target.userId },
        data: {
          ...(data.firstName !== undefined && { firstName: data.firstName }),
          ...(data.lastName !== undefined && { lastName: data.lastName }),
          ...(data.email !== undefined && { email: data.email.toLowerCase() }),
          ...(data.phone !== undefined && { phone: data.phone || null }),
          ...(data.nickname !== undefined && { nickname: data.nickname || null }),
        },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, nickname: true, profileImage: true },
      });
    });
    if (isActive === false) await refreshRealtime([target.userId]);
    return updated;
  });
}

// DELETE /api/employees/[id] - deaktivieren (nur Admins)
export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const target = await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId } });
    if (!target) throw new ApiError("Nicht gefunden.", 404);
    if (target.userId === a.userId) throw new ApiError("Cannot deactivate yourself");
    if (target.role === "OWNER") throw new ApiError("Cannot deactivate the owner");
    await db.organizationMember.update({ where: { id }, data: { isActive: false } });
    await refreshRealtime([target.userId]);
    return { success: true };
  });
}
