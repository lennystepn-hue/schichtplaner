import { z } from "zod";
import bcrypt from "bcryptjs";
import { api, body, serial, ApiError } from "@/lib/api";
export async function POST(request: Request) {
  return api(async () => {
    const data = await body(request, z.object({ token: z.string().uuid(), password: z.string().min(12).max(128).regex(/[A-Z]/, "Großbuchstabe fehlt.").regex(/[a-z]/, "Kleinbuchstabe fehlt.").regex(/[0-9]/, "Ziffer fehlt.") }));
    const hash = await bcrypt.hash(data.password, 12);
    return serial(async tx => {
      const m = await tx.organizationMember.findFirst({ where: { activationToken: data.token, activationExpiresAt: { gt: new Date() }, isActive: true, isActivated: false } });
      if (!m) throw new ApiError("Einladung ungültig oder abgelaufen.", 400);
      // Existing active users must not have their password reset by an invitation.
      const active = await tx.organizationMember.count({ where: { userId: m.userId, isActivated: true } });
      if (active) throw new ApiError("Dieses Benutzerkonto ist bereits aktiviert. Bitte die Administration kontaktieren.", 409);
      await tx.user.update({ where: { id: m.userId }, data: { passwordHash: hash } });
      await tx.organizationMember.update({ where: { id: m.id }, data: { isActivated: true, activationToken: null, activationExpiresAt: null } });
      return { success: true };
    });
  });
}
