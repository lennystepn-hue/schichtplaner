import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { can, requireAccess } from "@/lib/access";
import { issueAssignees } from "@/lib/overview";
import { issuePatch, issueSelect } from "@/lib/issues";
import { notify } from "@/lib/planning";

/** Standortmeldung aendern: Status, Zustaendigkeit, Text - nur mit Recht am Standort der Meldung. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const existing = await db.branchIssue.findFirst({ where: { id, organizationId: a.orgId }, include: { branch: { select: { name: true } } } });
    if (!existing || !can(a, "MANAGE_ISSUES", existing.branchId)) throw new ApiError("Nicht gefunden.", 404);
    const data = await body(request, issuePatch);
    let assigneeUserId: string | null = null;
    if (data.assigneeMemberId) {
      const assignee = (await issueAssignees(a.orgId, existing.branchId)).find((x) => x.memberId === data.assigneeMemberId);
      if (!assignee) throw new ApiError("Diese Person ist für den Standort nicht zuständig.", 400);
      if (data.assigneeMemberId !== existing.assigneeMemberId) assigneeUserId = (await db.organizationMember.findUniqueOrThrow({ where: { id: assignee.memberId }, select: { userId: true } })).userId;
    }
    const issue = await db.$transaction(async (tx) => {
      const updated = await tx.branchIssue.update({
        where: { id },
        data: {
          ...data,
          ...(data.status ? { resolvedAt: data.status === "RESOLVED" ? existing.resolvedAt ?? new Date() : null } : {}),
        },
        select: issueSelect,
      });
      if (assigneeUserId) await notify(tx, a.orgId, a.userId, [assigneeUserId], "Standortmeldung zugewiesen", existing.branch.name + ": " + updated.title);
      return updated;
    });
    return { issue };
  });
}
