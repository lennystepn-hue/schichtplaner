import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import {
  allowedBranchRights,
  allowedStaffRights,
  normalizeBranchRights,
  normalizeStaffRights,
  BRANCH_RIGHTS,
  STAFF_RIGHTS,
  type BranchRightKey,
  type StaffRightKey,
} from "@/lib/access-shared";
import { refreshRealtime } from "@/lib/emit";

type Context = { params: Promise<{ id: string }> };

async function targetFor(orgId: string, id: string) {
  const target = await db.organizationMember.findFirst({ where: { id, organizationId: orgId }, include: { user: { select: { firstName: true, lastName: true } } } });
  if (!target) throw new ApiError("Nicht gefunden.", 404);
  return target;
}

/** Freigaben einer Person - nur fuer Admins. */
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const target = await targetFor(a.orgId, (await context.params).id);
    const [grants, branches, staff, candidates, managers] = await Promise.all([
      db.branchAccess.findMany({ where: { memberId: target.id }, select: { branchId: true, rights: true, updatedAt: true } }),
      db.branch.findMany({ where: { organizationId: a.orgId }, orderBy: [{ name: "asc" }], select: { id: true, name: true, isActive: true, customer: { select: { id: true, name: true } } } }),
      db.staffAssignment.findMany({ where: { managerMemberId: target.id }, select: { rights: true, updatedAt: true, employee: { select: { id: true, role: true, isActive: true, user: { select: { firstName: true, lastName: true } } } } } }),
      target.role === "MANAGER"
        ? db.organizationMember.findMany({ where: { organizationId: a.orgId, id: { not: target.id }, role: { in: ["EMPLOYEE", "MANAGER"] }, isActive: true }, orderBy: { user: { lastName: "asc" } }, select: { id: true, role: true, user: { select: { firstName: true, lastName: true } } } })
        : Promise.resolve([]),
      // Gegenrichtung: welche Manager fuer diese Person zustaendig sind.
      db.staffAssignment.findMany({ where: { employeeMemberId: target.id }, select: { rights: true, manager: { select: { id: true, role: true, user: { select: { firstName: true, lastName: true } } } } } }),
    ]);
    return {
      member: { id: target.id, role: target.role, name: target.user.firstName + " " + target.user.lastName },
      allowedBranchRights: allowedBranchRights(target.role),
      allowedStaffRights: allowedStaffRights(target.role),
      grants: grants.map((g) => ({ branchId: g.branchId, rights: normalizeBranchRights(g.rights, target.role), updatedAt: g.updatedAt })),
      branches,
      staff: staff.map((s) => ({ memberId: s.employee.id, role: s.employee.role, isActive: s.employee.isActive, name: s.employee.user.firstName + " " + s.employee.user.lastName, rights: normalizeStaffRights(s.rights, target.role), updatedAt: s.updatedAt })),
      candidates: candidates.map((c) => ({ memberId: c.id, role: c.role, name: c.user.firstName + " " + c.user.lastName })),
      managers: managers.map((m) => ({ memberId: m.manager.id, name: m.manager.user.firstName + " " + m.manager.user.lastName, rights: normalizeStaffRights(m.rights, m.manager.role) })),
    };
  });
}

const branchRight = z.enum(BRANCH_RIGHTS.map((r) => r.key) as [BranchRightKey, ...BranchRightKey[]]);
const staffRight = z.enum(STAFF_RIGHTS.map((r) => r.key) as [StaffRightKey, ...StaffRightKey[]]);
const change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("branch"), branchId: z.string().min(1), rights: z.array(branchRight).max(20) }),
  z.object({ kind: z.literal("staff"), memberId: z.string().min(1), rights: z.array(staffRight).max(20) }),
]);

/**
 * Freigabe setzen, aendern oder - mit leerer Rechteliste - entziehen. Die
 * Wirkung ist sofort: jede folgende Anfrage und jede offene
 * Echtzeitverbindung wird mit den neuen Rechten geprueft.
 */
export async function PUT(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const target = await targetFor(a.orgId, (await context.params).id);
    const data = await body(request, change);
    const result = await serial(async (tx) => {
      if (data.kind === "branch") {
        if (!allowedBranchRights(target.role).length) throw new ApiError("Für diese Rolle gibt es keine Standortfreigaben; sie hat organisationsweiten Zugriff.", 400);
        const branch = await tx.branch.findFirst({ where: { id: data.branchId, organizationId: a.orgId }, select: { id: true } });
        if (!branch) throw new ApiError("Standort nicht gefunden.", 404);
        const rights = normalizeBranchRights(data.rights, target.role);
        if (data.rights.some((r) => !allowedBranchRights(target.role).includes(r))) throw new ApiError("Diese Rolle kann einzelne der gewählten Rechte nicht erhalten.", 400);
        if (!rights.length) {
          await tx.branchAccess.deleteMany({ where: { memberId: target.id, branchId: branch.id } });
          return { rights };
        }
        await tx.branchAccess.upsert({
          where: { memberId_branchId: { memberId: target.id, branchId: branch.id } },
          create: { organizationId: a.orgId, memberId: target.id, branchId: branch.id, rights },
          update: { rights },
        });
        return { rights };
      }
      if (target.role !== "MANAGER") throw new ApiError("Mitarbeitende können nur Managern zugeordnet werden.", 400);
      const employee = await tx.organizationMember.findFirst({ where: { id: data.memberId, organizationId: a.orgId }, select: { id: true, role: true } });
      if (!employee) throw new ApiError("Person nicht gefunden.", 404);
      if (employee.id === target.id) throw new ApiError("Eine Person kann sich nicht selbst zugeordnet werden.", 400);
      if (employee.role !== "EMPLOYEE" && employee.role !== "MANAGER") throw new ApiError("Administration und Inhaber werden nicht zugeordnet.", 400);
      const rights = normalizeStaffRights(data.rights, target.role);
      if (!rights.length) {
        await tx.staffAssignment.deleteMany({ where: { managerMemberId: target.id, employeeMemberId: employee.id } });
        return { rights };
      }
      await tx.staffAssignment.upsert({
        where: { managerMemberId_employeeMemberId: { managerMemberId: target.id, employeeMemberId: employee.id } },
        create: { organizationId: a.orgId, managerMemberId: target.id, employeeMemberId: employee.id, rights },
        update: { rights },
      });
      return { rights };
    });
    await refreshRealtime([target.userId]);
    return result;
  });
}
