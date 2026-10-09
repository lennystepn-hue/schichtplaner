import { useQuery } from "@tanstack/react-query";
import type { AccessSummary } from "@/lib/access-shared";

export type CurrentMember = {
  id: string;
  role: "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE";
  organizationId: string;
  organizationName: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    profileImage: string | null;
    locale: string;
  };
  /** Aktuelle Rechte - nur fuer Navigation und Schaltflaechen, geprueft wird serverseitig. */
  access: AccessSummary;
};

export function useCurrentMember() {
  return useQuery<CurrentMember>({
    queryKey: ["current-member"],
    queryFn: async () => {
      const res = await fetch("/api/me");
      if (!res.ok) throw new Error("Failed to fetch member");
      return res.json();
    },
  });
}
