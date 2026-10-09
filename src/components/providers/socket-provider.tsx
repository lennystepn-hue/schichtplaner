"use client";

/**
 * SocketProvider initializes the WebSocket connection and sets up
 * automatic React Query cache invalidation for real-time events.
 *
 * When connected, server-emitted events invalidate the relevant query keys
 * so the UI updates without manual refetching.
 *
 * When disconnected, React Query's refetchInterval kicks in as a fallback.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket, useSocketStatus } from "@/lib/socket";

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useSocket();
  const status = useSocketStatus();
  const queryClient = useQueryClient();

  // Invalidate relevant queries when server pushes events
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      subscribe("schedule:updated", () => {
        queryClient.invalidateQueries({ queryKey: ["schedule"] });
        queryClient.invalidateQueries({ queryKey: ["shifts"] });
        queryClient.invalidateQueries({ queryKey: ["branch-month"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      })
    );

    unsubs.push(
      subscribe("booking:changed", () => {
        queryClient.invalidateQueries({ queryKey: ["schedule"] });
        queryClient.invalidateQueries({ queryKey: ["shifts"] });
        queryClient.invalidateQueries({ queryKey: ["bookings"] });
        queryClient.invalidateQueries({ queryKey: ["branch-month"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["requests"] });
        queryClient.invalidateQueries({ queryKey: ["mod-requests"] });
      })
    );

    unsubs.push(
      subscribe("message:new", () => {
        queryClient.invalidateQueries({ queryKey: ["messages"] });
      })
    );

    unsubs.push(
      subscribe("time:watch", () => {
        queryClient.invalidateQueries({ queryKey: ["time"] });
        queryClient.invalidateQueries({ queryKey: ["watch"] });
      })
    );

    unsubs.push(
      subscribe("ai:result", () => {
        queryClient.invalidateQueries({ queryKey: ["ai"] });
      })
    );

    unsubs.push(
      subscribe("live:started", () => {
        queryClient.invalidateQueries({ queryKey: ["schedule"] });
      })
    );

    unsubs.push(
      subscribe("live:stopped", () => {
        queryClient.invalidateQueries({ queryKey: ["schedule"] });
      })
    );

    unsubs.push(
      subscribe("live:booking", () => {
        queryClient.invalidateQueries({ queryKey: ["schedule"] });
        queryClient.invalidateQueries({ queryKey: ["shifts"] });
      })
    );

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [subscribe, queryClient]);

  // Polling fallback: when disconnected, set a global refetchInterval
  // on the query client defaults so all queries poll periodically.
  useEffect(() => {
    if (status !== "connected") {
      queryClient.setDefaultOptions({
        queries: {
          refetchInterval: 15000, // 15s polling fallback
        },
      });
    } else {
      queryClient.setDefaultOptions({
        queries: {
          refetchInterval: false, // disable polling when socket is active
        },
      });
    }
  }, [status, queryClient]);

  return <>{children}</>;
}
