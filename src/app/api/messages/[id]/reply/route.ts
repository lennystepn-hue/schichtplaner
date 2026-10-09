import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { canSee, requireAccess, visiblePeople } from "@/lib/access";
import { emitToUsers } from "@/lib/emit";

/**
 * Antwort: an den Absender und - wer selbst Absender war - an alle
 * urspruenglichen Empfaenger. Andere Empfaenger erreicht eine Antwort nur,
 * wenn die antwortende Person ihnen auch sonst schreiben darf.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const parent = await db.message.findFirst({
      where: { id, organizationId: a.orgId, OR: [{ senderId: a.userId }, { recipients: { some: { userId: a.userId } } }] },
      include: { recipients: { select: { userId: true } } },
    });
    if (!parent) throw new ApiError("Parent message not found", 404);
    const { body: text } = await body(request, z.object({ body: z.string().trim().min(1).max(10000) }));
    const people = parent.senderId === a.userId ? null : await visiblePeople(a);
    const candidates = new Set<string>([parent.senderId, ...parent.recipients.map((r) => r.userId).filter((userId) => canSee(people, userId))]);
    candidates.delete(a.userId);
    const active = await db.organizationMember.findMany({ where: { organizationId: a.orgId, isActive: true, userId: { in: [...candidates] } }, select: { userId: true } });
    if (!active.length) throw new ApiError("Keine erreichbaren Empfänger.", 400);
    const reply = await db.message.create({
      data: {
        organizationId: a.orgId, senderId: a.userId, parentId: id,
        subject: parent.subject.startsWith("Re: ") ? parent.subject : `Re: ${parent.subject}`, body: text,
        recipients: { create: active.map((r) => ({ userId: r.userId })) },
      },
      include: { sender: { select: { id: true, firstName: true, lastName: true, profileImage: true } } },
    });
    emitToUsers(active.map((r) => r.userId), "message:new");
    return Response.json({ message: reply }, { status: 201 });
  });
}
