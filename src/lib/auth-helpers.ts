import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function getCurrentMember() {
  const session = await auth();
  if (!session?.user?.id) return null;

  return db.organizationMember.findFirst({
    where: { userId: session.user.id, isActive: true, isActivated: true, organization: { deletedAt: null } },
    orderBy: { joinedAt: "asc" },
    include: { organization: true, user: true },
  });
}

export function isAdminOrAbove(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

export function isManagerOrAbove(role: string) {
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}
