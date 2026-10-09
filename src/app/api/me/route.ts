import { api } from "@/lib/api";
import { requireAccess, summary } from "@/lib/access";

export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    const m = a.member;
    return {
      id: m.id,
      role: m.role,
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      user: { id: m.user.id, firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email, profileImage: m.user.profileImage, locale: m.user.locale },
      access: summary(a),
    };
  });
}
