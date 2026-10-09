import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { normalizeBranchRights } from "@/lib/access-shared";
import { refreshRealtime } from "@/lib/emit";

// PATCH /api/employees/[id]/role - Rolle aendern (nur Admins). Freigaben, die
// die neue Rolle nicht erlaubt, werden dabei entfernt.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const { role } = await body(request, z.object({ role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]) }));
    const target = await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId } });
    if (!target) throw new ApiError("Nicht gefunden.", 404);
    if (target.role === "OWNER") throw new ApiError("Cannot change the owner's role");
    if (target.userId === a.userId) throw new ApiError("Cannot change your own role");
    const updated = await db.$transaction(async (tx) => {
      const member = await tx.organizationMember.update({ where: { id }, data: { role } });
      for (const grant of await tx.branchAccess.findMany({ where: { memberId: id } })) {
        const rights = normalizeBranchRights(grant.rights, role);
        if (rights.length) await tx.branchAccess.update({ where: { id: grant.id }, data: { rights } });
        else await tx.branchAccess.delete({ where: { id: grant.id } });
      }
      if (role !== "MANAGER") await tx.staffAssignment.deleteMany({ where: { managerMemberId: id } });
      if (role === "ADMIN") await tx.staffAssignment.deleteMany({ where: { employeeMemberId: id } });
      return member;
    });
    await refreshRealtime([target.userId]);
    return { id: updated.id, role: updated.role };
  });
}
