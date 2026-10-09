import { z } from "zod";
import { api, body } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/access";
import { staffMember } from "@/lib/staff";

type Context = { params: Promise<{ id: string }> };
const author = { select: { id: true, firstName: true, lastName: true } } as const;

// Personalnotizen: Admins oder "Stammdaten bearbeiten" fuer genau diese Person.
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const target = await staffMember(a, (await context.params).id, "EDIT_PROFILE");
    return db.employeeNote.findMany({ where: { subjectId: target.userId }, include: { author }, orderBy: { createdAt: "desc" } });
  });
}

export async function POST(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const target = await staffMember(a, (await context.params).id, "EDIT_PROFILE");
    const { text } = await body(request, z.object({ text: z.string().trim().min(1).max(5000) }));
    const note = await db.employeeNote.create({ data: { subjectId: target.userId, authorId: a.userId, text }, include: { author } });
    return Response.json(note, { status: 201 });
  });
}
