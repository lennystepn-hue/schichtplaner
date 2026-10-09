"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Anzahl ungelesener Nachrichten. Eine gemeinsame Abfrage fuer alle
 * Navigationsleisten, damit der Zaehler ueberall gleich steht.
 */
export function useUnreadCount(): number {
  const { data } = useQuery<{ count: number }>({
    queryKey: ["messages", "unread-count"],
    queryFn: () => fetch("/api/messages/unread-count").then((r) => r.json()),
    refetchInterval: 30000,
  });
  return data?.count ?? 0;
}
