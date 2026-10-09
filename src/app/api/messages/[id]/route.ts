import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, visiblePeople } from "@/lib/access";
import { recipientsFor } from "@/lib/messages";

type Context = { params: Promise<{ id: string }> };
const person = { select: { id: true, firstName: true, lastName: true, profileImage: true } } as const;

// GET /api/messages/[id] - Nachricht mit Antworten; als gelesen markieren
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const involved = { OR: [{ senderId: a.userId }, { recipients: { some: { userId: a.userId } } }] };
    const message = await db.message.findFirst({
      where: { id, organizationId: a.orgId, ...involved },
      include: {
        sender: person,
        recipients: { include: { user: person } },
        // Im Verlauf nur Antworten, an denen die Person selbst beteiligt ist.
        replies: { where: involved, include: { sender: person }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!message) throw new ApiError("Not found", 404);
    await db.messageRecipient.updateMany({ where: { messageId: id, userId: a.userId }, data: { isRead: true } });
    return { message: { ...message, ...recipientsFor(message.recipients, await visiblePeople(a), a.userId) } };
  });
}

const patchSchema = z.object({ isRead: z.boolean().optional(), isDeleted: z.boolean().optional() });

// PATCH /api/messages/[id] - gelesen/ungelesen, Papierkorb
export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, patchSchema);
    const updated = await db.messageRecipient.updateMany({ where: { messageId: id, userId: a.userId, message: { organizationId: a.orgId } }, data });
    if (!updated.count) throw new ApiError("Not found", 404);
    return { success: true };
  });
}

// DELETE /api/messages/[id] - Absender loescht die Nachricht, Empfaenger ihre Kopie
export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const message = await db.message.findFirst({ where: { id, organizationId: a.orgId, OR: [{ senderId: a.userId }, { recipients: { some: { userId: a.userId } } }] } });
    if (!message) throw new ApiError("Not found", 404);
    if (message.senderId === a.userId) await db.message.delete({ where: { id } });
    else await db.messageRecipient.deleteMany({ where: { messageId: id, userId: a.userId } });
    return { success: true };
  });
}
