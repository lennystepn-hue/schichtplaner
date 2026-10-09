import { DivisionList } from "@/components/divisions/division-list";
import { Locations } from "@/components/workforce/locations";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";

export default async function DivisionsPage() {
  // Arbeitsbereiche und ihre Mitglieder verwaltet die Administration.
  const member = await getCurrentMember();
  return <div className="space-y-10"><Locations />{member && isAdminOrAbove(member.role) && <DivisionList />}</div>;
}
