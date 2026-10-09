import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { anyBranchIds, branchIds, requireAccess, requireAdmin } from "@/lib/access";
import { branchInput, branchPatch } from "@/lib/org-structure";
import { BRANCH_RIGHTS, type BranchRightKey } from "@/lib/access-shared";

const rightParam = z.enum(BRANCH_RIGHTS.map((r) => r.key) as [BranchRightKey, ...BranchRightKey[]]);

/** Sichtbare Standorte; mit ?right=... nur die, an denen dieses Recht besteht. */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams.get("right");
    const ids = q ? branchIds(a, rightParam.parse(q)) : anyBranchIds(a);
    const branches = await db.branch.findMany({
      where: { organizationId: a.orgId, ...(ids ? { id: { in: ids } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, address: true, meetingPoint: true, notes: true, positions: true, isActive: true, customerId: true, customer: { select: { id: true, name: true } } },
    });
    return { branches };
  });
}

async function checkCustomer(orgId: string, customerId: string) {
  if (!await db.customer.findFirst({ where: { id: customerId, organizationId: orgId } })) throw new ApiError("Kunde nicht gefunden.", 404);
}

export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const data = await body(request, branchInput);
    await checkCustomer(a.orgId, data.customerId);
    return { branch: await db.branch.create({ data: { ...data, organizationId: a.orgId } }) };
  });
}

export async function PATCH(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id, ...data } = await body(request, branchPatch);
    if (data.customerId) await checkCustomer(a.orgId, data.customerId);
    const result = await db.branch.updateMany({ where: { id, organizationId: a.orgId }, data });
    if (!result.count) throw new ApiError("Einsatzort nicht gefunden.", 404);
    return { success: true };
  });
}
