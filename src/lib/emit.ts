/**
 * Echtzeit-Signale aus API-Routen.
 *
 * Ereignisse tragen keine Inhalte (keine Namen, Betreffzeilen oder
 * Empfaengerlisten). Sie sagen nur "hier hat sich etwas geaendert"; die
 * Oberflaeche laedt daraufhin ueber die API nach, und dort gelten die
 * Berechtigungen. Die Raeume vergibt ausschliesslich der Server
 * (src/lib/realtime.ts).
 */
import type { Server as SocketIOServer } from "socket.io";

function getIO(): SocketIOServer | null {
  return ((globalThis as Record<string, unknown>).__socketIO as SocketIOServer | undefined) ?? null;
}

export const rooms = {
  user: (userId: string) => "user:" + userId,
  admins: (orgId: string) => "admins:" + orgId,
  branch: (branchId: string) => "branch:" + branchId,
  schedule: (scheduleId: string) => "schedule:" + scheduleId,
};

/** Aenderung an einem Standortplan (ohne Standort: nur Admins) plus betroffene Personen. */
export function emitToBranch(orgId: string, branchId: string | null, event: string, affectedUserIds: string[] = []): void {
  const io = getIO();
  if (!io) return;
  io.to([rooms.admins(orgId), ...(branchId ? [rooms.branch(branchId)] : []), ...affectedUserIds.map(rooms.user)]).emit(event, {});
}

export function emitToUsers(userIds: string[], event: string): void {
  const io = getIO();
  if (!io || !userIds.length) return;
  io.to(userIds.map(rooms.user)).emit(event, {});
}

/** Live-Modus: nur an Verbindungen, die den Plan ansehen duerfen. */
export function emitToSchedule(scheduleId: string, event: string): void {
  const io = getIO();
  if (!io) return;
  io.to(rooms.schedule(scheduleId)).emit(event, { scheduleId });
}

/**
 * Rechte haben sich geaendert (Freigabe, Rolle, Deaktivierung): offene
 * Verbindungen der Personen sofort neu bewerten, nicht erst beim naechsten
 * Rundgang.
 */
export async function refreshRealtime(userIds?: string[]): Promise<void> {
  const refresh = (globalThis as Record<string, unknown>).__akroRefreshRealtime as ((ids?: string[]) => Promise<void>) | undefined;
  if (refresh) await refresh(userIds);
}
