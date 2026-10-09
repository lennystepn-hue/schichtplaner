import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { canStaff, requireAccess, type Access } from "@/lib/access";
import { validDate } from "@/lib/berlin";
import { notify } from "@/lib/planning";

type Context = { params: Promise<{ id: string }> };
const include = {
  user: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
  category: { select: { id: true, name: true, color: true, isPaid: true } },
} as const;

/** Eigene Abwesenheit oder eine, die die angemeldete Person entscheiden darf - sonst 404. */
async function absenceFor(a: Access, id: string) {
  const absence = await db.absence.findFirst({ where: { id, category: { organizationId: a.orgId } } });
  if (!absence) throw new ApiError("Not found", 404);
  const self = absence.userId === a.userId;
  const manages = canStaff(a, "MANAGE_ABSENCES", absence.userId) && (a.isAdmin || !self);
  if (!self && !manages) throw new ApiError("Not found", 404);
  if (!await db.organizationMember.findFirst({ where: { organizationId: a.orgId, userId: absence.userId, isActive: true } })) throw new ApiError("Not found", 404);
  return { absence, manages };
}

const updateAbsenceSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "DECLINED"]).optional(),
  dateFrom: z.string().refine(validDate).optional(),
  dateTo: z.string().refine(validDate).optional(),
  note: z.string().max(2000).nullable().optional(),
  categoryId: z.string().optional(),
});

export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { absence, manages } = await absenceFor(a, (await context.params).id);
    const data = await body(request, updateAbsenceSchema);
    if ((data.dateFrom || absence.dateFrom.toISOString().slice(0, 10)) > (data.dateTo || absence.dateTo.toISOString().slice(0, 10))) throw new ApiError("Enddatum liegt vor dem Beginn.");
    if ((data.status === "APPROVED" || data.status === "DECLINED") && !manages) throw new ApiError("Only admins can approve or decline absences", 403);
    if (!manages && absence.status !== "PENDING") throw new ApiError("Can only edit pending absences");
    if (data.categoryId && !await db.absenceCategory.findFirst({ where: { id: data.categoryId, organizationId: a.orgId } })) throw new ApiError("Category not found", 404);
    const updated = await db.$transaction(async (tx) => {
      const result = await tx.absence.update({
        where: { id: absence.id },
        data: {
          ...(data.status !== undefined && { status: data.status }),
          ...(data.dateFrom !== undefined && { dateFrom: new Date(data.dateFrom + "T00:00:00.000Z") }),
          ...(data.dateTo !== undefined && { dateTo: new Date(data.dateTo + "T00:00:00.000Z") }),
          ...(data.note !== undefined && { note: data.note }),
          ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
        },
        include,
      });
      if (data.status && data.status !== absence.status) await notify(tx, a.orgId, a.userId, [absence.userId], "Abwesenheitsantrag " + (data.status === "APPROVED" ? "genehmigt" : data.status === "DECLINED" ? "abgelehnt" : "zur Prüfung"), result.dateFrom.toISOString().slice(0, 10) + " bis " + result.dateTo.toISOString().slice(0, 10));
      return result;
    });
    return { absence: updated };
  });
}

export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { absence, manages } = await absenceFor(a, (await context.params).id);
    if (!manages && absence.status !== "PENDING") throw new ApiError("Can only delete pending absences");
    await db.absence.delete({ where: { id: absence.id } });
    return { success: true };
  });
}
