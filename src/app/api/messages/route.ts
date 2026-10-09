import { NextRequest } from "next/server";
import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { canSee, requireAccess, visiblePeople } from "@/lib/access";
import { recipientsFor, shiftVisibleForMessage } from "@/lib/messages";
import { emitToUsers } from "@/lib/emit";

const sender = { select: { id: true, firstName: true, lastName: true, profileImage: true } } as const;

// GET /api/messages?folder=inbox|sent|trash
export async function GET(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    const folder = request.nextUrl.searchParams.get("folder") || "inbox";
    if (folder === "sent") {
      const [messages, people] = await Promise.all([
        db.message.findMany({
          where: { organizationId: a.orgId, senderId: a.userId },
          include: { sender, recipients: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
          orderBy: { createdAt: "desc" },
        }),
        visiblePeople(a),
      ]);
      return { messages: messages.map((m) => ({ ...m, ...recipientsFor(m.recipients, people, a.userId) })) };
    }
    const deleted = folder === "trash";
    const messages = await db.message.findMany({
      where: { organizationId: a.orgId, recipients: { some: { userId: a.userId, isDeleted: deleted } } },
      include: { sender, recipients: { where: { userId: a.userId }, select: { isRead: true, isDeleted: true } } },
      orderBy: { createdAt: "desc" },
    });
    if (deleted) return { messages };
    const unreadCount = await db.messageRecipient.count({ where: { userId: a.userId, isRead: false, isDeleted: false, message: { organizationId: a.orgId } } });
    return { messages, unreadCount };
  });
}

const sendSchema = z.object({
  shiftId: z.string().optional(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  recipientIds: z.array(z.string().min(1)).min(1).max(500),
});

// POST /api/messages - nur an Personen, die die angemeldete Person sehen darf
export async function POST(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, sendSchema);
    if (data.shiftId && !await shiftVisibleForMessage(a, data.shiftId)) throw new ApiError("Schicht nicht gefunden.", 404);
    const ids = [...new Set(data.recipientIds)].filter((id) => id !== a.userId);
    const people = await visiblePeople(a);
    if (ids.some((id) => !canSee(people, id))) throw new ApiError("Du kannst diesen Personen nicht schreiben.", 403);
    const valid = await db.organizationMember.findMany({ where: { organizationId: a.orgId, userId: { in: ids }, isActive: true }, select: { userId: true } });
    if (!valid.length) throw new ApiError("No valid recipients found");
    const message = await db.message.create({
      data: {
        organizationId: a.orgId, senderId: a.userId, shiftId: data.shiftId, subject: data.subject, body: data.body,
        recipients: { create: valid.map((r) => ({ userId: r.userId })) },
      },
      include: { sender, recipients: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
    });
    // Nur die Empfaenger erfahren davon - ohne Betreff, ohne Empfaengerliste.
    emitToUsers(valid.map((r) => r.userId), "message:new");
    return Response.json({ message }, { status: 201 });
  });
}
