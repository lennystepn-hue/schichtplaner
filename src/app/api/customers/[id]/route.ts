import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { customerInput } from "@/lib/org-structure";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, customerInput.partial());
    const result = await db.customer.updateMany({ where: { id, organizationId: a.orgId }, data: { ...data, ...(data.notes !== undefined ? { notes: data.notes || null } : {}) } });
    if (!result.count) throw new ApiError("Kunde nicht gefunden.", 404);
    return { success: true };
  });
}
