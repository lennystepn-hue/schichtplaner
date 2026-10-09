/**
 * Welche Echtzeit-Raeume eine Verbindung betreten darf - berechnet aus den
 * aktuellen Rechten in der Datenbank. Wird vom Server (server.ts) bei der
 * Verbindung, bei jedem Client-Ereignis, nach Rechteaenderungen und in
 * regelmaessigen Abstaenden aufgerufen.
 */
import { db } from "./db";
import { isAdminRole, normalizeBranchRights } from "./access-shared";
import { rooms } from "./emit";

export type RealtimeSession = { userId: string; orgId: string };

/** Erlaubte feste Raeume; null bedeutet: kein Zugriff mehr (Verbindung trennen). */
export async function allowedRooms(session: RealtimeSession): Promise<Set<string> | null> {
  const member = await db.organizationMember.findFirst({
    where: { userId: session.userId, organizationId: session.orgId, isActive: true, isActivated: true, organization: { deletedAt: null } },
    select: { id: true, role: true },
  });
  if (!member) return null;
  const allowed = new Set([rooms.user(session.userId)]);
  if (isAdminRole(member.role)) {
    allowed.add(rooms.admins(session.orgId));
    return allowed;
  }
  const grants = await db.branchAccess.findMany({ where: { memberId: member.id, organizationId: session.orgId }, select: { branchId: true, rights: true } });
  for (const g of grants) if (normalizeBranchRights(g.rights, member.role).length) allowed.add(rooms.branch(g.branchId));
  return allowed;
}

/** Darf die Verbindung den Live-Raum dieses Plans betreten? */
export async function canJoinSchedule(session: RealtimeSession, scheduleId: string): Promise<boolean> {
  const member = await db.organizationMember.findFirst({
    where: { userId: session.userId, organizationId: session.orgId, isActive: true, isActivated: true },
    select: { id: true, role: true },
  });
  if (!member) return false;
  const schedule = await db.schedule.findFirst({ where: { id: scheduleId, organizationId: session.orgId, deletedAt: null }, select: { branchId: true, isPublic: true } });
  if (!schedule) return false;
  if (isAdminRole(member.role)) return true;
  if (!schedule.branchId) return false;
  const grant = await db.branchAccess.findUnique({ where: { memberId_branchId: { memberId: member.id, branchId: schedule.branchId } }, select: { rights: true } });
  const rights = normalizeBranchRights(grant?.rights ?? [], member.role);
  // Entwuerfe nur fuer die Planung, veroeffentlichte Plaene auch fuer Freigaben zum Anfragen.
  if (rights.includes("VIEW_SCHEDULE") && (member.role === "MANAGER" || schedule.isPublic)) return true;
  return schedule.isPublic && rights.includes("REQUEST_SHIFTS");
}
