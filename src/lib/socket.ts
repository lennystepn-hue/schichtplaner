"use client";

/**
 * Client-side Socket.io hook for real-time updates.
 *
 * Connects to the custom server's Socket.io endpoint at /api/ws,
 * automatically joins the user's organization room, and provides
 * subscribe/emit helpers with connection status tracking.
 *
 * Falls back to React Query polling when the socket is disconnected.
 */

import { useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { io, Socket } from "socket.io-client";
import { useCurrentMember } from "@/lib/hooks/use-current-member";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SocketStatus = "connected" | "disconnected" | "reconnecting";

// ---------------------------------------------------------------------------
// Singleton socket instance (shared across all hook consumers)
// ---------------------------------------------------------------------------

let socket: Socket | null = null;
let currentStatus: SocketStatus = "disconnected";
const statusListeners = new Set<() => void>();

function notifyStatusListeners() {
  statusListeners.forEach((cb) => cb());
}

function getOrCreateSocket(): Socket {
  if (socket) return socket;

  socket = io({
    path: "/api/ws",
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    autoConnect: false,
  });

  socket.on("connect", () => {
    currentStatus = "connected";
    notifyStatusListeners();
  });

  socket.on("disconnect", () => {
    currentStatus = "disconnected";
    notifyStatusListeners();
  });

  socket.io.on("reconnect_attempt", () => {
    currentStatus = "reconnecting";
    notifyStatusListeners();
  });

  socket.io.on("reconnect", () => {
    currentStatus = "connected";
    notifyStatusListeners();
  });

  return socket;
}

// ---------------------------------------------------------------------------
// useSyncExternalStore helpers for status
// ---------------------------------------------------------------------------

function subscribeStatus(cb: () => void) {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

function getStatusSnapshot(): SocketStatus {
  return currentStatus;
}

function getServerStatusSnapshot(): SocketStatus {
  return "disconnected";
}

// ---------------------------------------------------------------------------
// useSocket hook
// ---------------------------------------------------------------------------

export function useSocket() {
  const { data: member } = useCurrentMember();
  const orgId = member?.organizationId;
  const joinedOrgRef = useRef<string | null>(null);

  // Maintain singleton socket lifecycle
  useEffect(() => {
    const s = getOrCreateSocket();

    if (!s.connected) {
      s.connect();
    }

    return () => {
      // Don't disconnect on unmount - other components may still need it.
      // The socket will be cleaned up when the page unloads.
    };
  }, []);

  // Join org room when member data arrives (and re-join on reconnect)
  useEffect(() => {
    if (!orgId) return;

    const s = getOrCreateSocket();

    const joinOrg = () => {
      if (joinedOrgRef.current !== orgId) {
        s.emit("join:org", orgId);
        joinedOrgRef.current = orgId;
      }
    };

    // Join immediately if already connected
    if (s.connected) {
      joinOrg();
    }

    // Re-join on every reconnect
    s.on("connect", joinOrg);

    return () => {
      s.off("connect", joinOrg);
    };
  }, [orgId]);

  // Subscribe to a specific event
  const subscribe = useCallback(
    (event: string, handler: (data: unknown) => void) => {
      const s = getOrCreateSocket();
      s.on(event, handler);
      return () => {
        s.off(event, handler);
      };
    },
    []
  );

  // Emit an event to the server
  const emit = useCallback((event: string, data?: unknown) => {
    const s = getOrCreateSocket();
    if (s.connected) {
      s.emit(event, data);
    }
  }, []);

  // Join a schedule room (for per-schedule events like live mode)
  const joinSchedule = useCallback((scheduleId: string) => {
    const s = getOrCreateSocket();
    if (s.connected) {
      s.emit("join:schedule", scheduleId);
    }
  }, []);

  // Leave a schedule room
  const leaveSchedule = useCallback((scheduleId: string) => {
    const s = getOrCreateSocket();
    if (s.connected) {
      s.emit("leave:schedule", scheduleId);
    }
  }, []);

  const status = useSyncExternalStore(
    subscribeStatus,
    getStatusSnapshot,
    getServerStatusSnapshot
  );

  return {
    status,
    subscribe,
    emit,
    joinSchedule,
    leaveSchedule,
    isConnected: status === "connected",
  };
}

// ---------------------------------------------------------------------------
// useSocketEvent — convenience hook for subscribing to a single event
// ---------------------------------------------------------------------------

export function useSocketEvent(event: string, handler: (data: unknown) => void) {
  const { subscribe } = useSocket();
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; }, [handler]);

  useEffect(() => {
    const unsubscribe = subscribe(event, (data: unknown) => {
      handlerRef.current(data);
    });
    return unsubscribe;
  }, [event, subscribe]);
}

// ---------------------------------------------------------------------------
// useSocketStatus — lightweight hook for just the connection status
// ---------------------------------------------------------------------------

export function useSocketStatus(): SocketStatus {
  return useSyncExternalStore(
    subscribeStatus,
    getStatusSnapshot,
    getServerStatusSnapshot
  );
}
