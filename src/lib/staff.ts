import { ApiError } from "./errors";
import { db } from "./db";
import { canStaff, type Access } from "./access";
import type { StaffRightKey } from "./access-shared";

/**
 * Mitglied derselben Organisation, auf dessen Personaldaten die angemeldete
 * Person mit diesem Recht zugreifen darf (Admins immer, jede Person auf sich
 * selbst nur, wenn allowSelf gesetzt ist). Sonst 404 - ohne Recht bleibt
 * verborgen, ob es die Person gibt.
 */
export async function staffMember(a: Access, memberId: string, right: StaffRightKey, allowSelf = false) {
  const target = await db.organizationMember.findFirst({ where: { id: memberId, organizationId: a.orgId } });
  if (!target) throw new ApiError("Nicht gefunden.", 404);
  if (allowSelf && target.userId === a.userId) return target;
  if (!canStaff(a, right, target.userId)) throw new ApiError("Nicht gefunden.", 404);
  return target;
}
