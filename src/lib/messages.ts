import { db } from "./db";
import { can, canSee, type Access } from "./access";

type Recipient = { userId: string; isRead: boolean; isDeleted: boolean; user?: { id: string; firstName: string; lastName: string; profileImage?: string | null } };

/**
 * Empfaengerliste fuer die Ausgabe: nur Personen, die die betrachtende Person
 * auch sonst sehen darf; der Rest erscheint nur als Anzahl.
 */
export function recipientsFor<T extends Recipient>(recipients: T[], people: Set<string> | null, viewerId: string) {
  const visible = recipients.filter((r) => r.userId === viewerId || canSee(people, r.userId));
  return { recipients: visible, hiddenRecipients: recipients.length - visible.length };
}

/** Darf die Person eine Nachricht zu dieser Schicht schreiben? Nur zu Schichten, die sie sehen darf. */
export async function shiftVisibleForMessage(a: Access, shiftId: string): Promise<boolean> {
  const shift = await db.shift.findFirst({
    where: { id: shiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } },
    select: { schedule: { select: { branchId: true, isPublic: true } }, bookings: { where: { userId: a.userId }, select: { id: true } } },
  });
  if (!shift) return false;
  const branchId = shift.schedule.branchId;
  const planner = can(a, "VIEW_SCHEDULE", branchId) && (a.isAdmin || a.role === "MANAGER");
  return planner || (shift.schedule.isPublic && (shift.bookings.length > 0 || can(a, "REQUEST_SHIFTS", branchId)));
}
