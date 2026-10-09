import { api, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess } from "@/lib/access";
import { assignableUserIds, checkAssignment, publicUser, shiftInclude } from "@/lib/planning";

/**
 * Wer diese Schicht uebernehmen kann. Admins waehlen aus allen aktiven
 * Mitgliedern, Manager nur aus Personen, die ihnen ausdruecklich mit
 * "Einplanen" zugeordnet sind. Ausgegeben werden nur Namen.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    return serial(async tx => {
      const shift = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: shiftInclude });
      if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", shift.schedule.branchId);
      const allowed = assignableUserIds(a);
      const people = await tx.organizationMember.findMany({ where: { organizationId: a.orgId, isActive: true, isActivated: true, ...(allowed ? { userId: { in: allowed } } : {}) }, include: { user: { select: publicUser } } });
      const members = [];
      for (const person of people) if (!shift.bookings.some(b => b.userId === person.userId) && !(await checkAssignment(tx, shift, person.userId)).length) members.push(person);
      return { members: members.map(p => ({ id: p.id, userId: p.userId, role: p.role, user: p.user })) };
    });
  });
}
