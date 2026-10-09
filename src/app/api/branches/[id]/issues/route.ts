import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { assertCan, requireAccess, type Access } from "@/lib/access";
import { issueAssignees } from "@/lib/overview";
import { issueInput, issueSelect } from "@/lib/issues";
import { notify } from "@/lib/planning";

type Context = { params: Promise<{ id: string }> };

async function branchFor(a: Access, id: string) {
  const branch = await db.branch.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true, name: true } });
  if (!branch) throw new ApiError("Nicht gefunden.", 404);
  assertCan(a, "MANAGE_ISSUES", branch.id);
  return branch;
}

/** Standortmeldungen - nur mit "Standortmeldungen bearbeiten" (oder Admin). */
export async function GET(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const branch = await branchFor(a, (await context.params).id);
    const all = new URL(request.url).searchParams.get("status") === "alle";
    const [issues, assignees] = await Promise.all([
      db.branchIssue.findMany({ where: { organizationId: a.orgId, branchId: branch.id, ...(all ? {} : { status: { not: "RESOLVED" } }) }, select: issueSelect, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
      issueAssignees(a.orgId, branch.id),
    ]);
    return { branch, issues, assignees };
  });
}

export async function POST(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const branch = await branchFor(a, (await context.params).id);
    const data = await body(request, issueInput);
    const assignees = await issueAssignees(a.orgId, branch.id);
    const assignee = data.assigneeMemberId ? assignees.find((x) => x.memberId === data.assigneeMemberId) : null;
    if (data.assigneeMemberId && !assignee) throw new ApiError("Diese Person ist für den Standort nicht zuständig.", 400);
    const issue = await db.$transaction(async (tx) => {
      const created = await tx.branchIssue.create({ data: { organizationId: a.orgId, branchId: branch.id, title: data.title, description: data.description, assigneeMemberId: assignee?.memberId ?? null, createdById: a.userId }, select: issueSelect });
      if (assignee) {
        const target = await tx.organizationMember.findUniqueOrThrow({ where: { id: assignee.memberId }, select: { userId: true } });
        await notify(tx, a.orgId, a.userId, [target.userId], "Standortmeldung zugewiesen", branch.name + ": " + data.title);
      }
      return created;
    });
    return Response.json({ issue }, { status: 201 });
  });
}
