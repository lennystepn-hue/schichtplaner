import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const target = await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId, isActive: true } });
    if (!target || target.isActivated) throw new ApiError("Konto ist bereits aktiviert oder nicht aktiv.", 409);
    const token = crypto.randomUUID();
    await db.organizationMember.update({ where: { id }, data: { activationToken: token, activationExpiresAt: new Date(Date.now() + 7 * 86400000) } });
    return { url: new URL("/activate?token=" + token, process.env.APP_URL || new URL(request.url).origin).toString() };
  });
}
