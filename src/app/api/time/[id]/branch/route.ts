import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";

/**
 * Standort einer Zeitbuchung nachtraeglich festlegen - nur die
 * Administration, etwa fuer Altbuchungen ohne eindeutige Zuordnung. Damit
 * wird die Buchung fuer die Planung dieses Standorts sichtbar.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const { branchId } = await body(request, z.object({ branchId: z.string().min(1).nullable() }));
    if (branchId && !await db.branch.findFirst({ where: { id: branchId, organizationId: a.orgId } })) throw new ApiError("Standort nicht gefunden.", 404);
    const result = await db.timeRecord.updateMany({ where: { id, organizationId: a.orgId }, data: { branchId } });
    if (!result.count) throw new ApiError("Zeitbuchung nicht gefunden.", 404);
    return { success: true };
  });
}
